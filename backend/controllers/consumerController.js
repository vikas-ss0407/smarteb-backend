const Consumer = require('../models/consumer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// 60-day cycle: Day 1-15 reading, Day 16-30 payment, Day 31-60 idle, repeat
const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_LENGTH_DAYS = 60;
const CYCLE_REF_START = new Date(Date.UTC(2024, 0, 1)); // reference anchor

const startOfDay = (dt) => {
  const d = new Date(dt);
  d.setHours(0, 0, 0, 0);
  return d;
};

const getCycleWindows = (date) => {
  const target = startOfDay(date);
  const diffDays = Math.floor((target - CYCLE_REF_START) / DAY_MS);
  const cycleIndex = Math.floor(diffDays / CYCLE_LENGTH_DAYS);
  const cycleStart = new Date(CYCLE_REF_START.getTime() + cycleIndex * CYCLE_LENGTH_DAYS * DAY_MS);

  const readingStart = cycleStart;
  const readingEnd = new Date(cycleStart.getTime() + 14 * DAY_MS);
  const paymentStart = new Date(cycleStart.getTime() + 15 * DAY_MS);
  const paymentEnd = new Date(cycleStart.getTime() + 29 * DAY_MS);
  const idleEnd = new Date(cycleStart.getTime() + 59 * DAY_MS);

  return { cycleStart, readingStart, readingEnd, paymentStart, paymentEnd, idleEnd };
};

// Process meter image via AI service
exports.validateMeterImage = async (req, res) => {
  try {
    const { consumerNumber, user_reading } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ message: 'No image file uploaded' });
    }

    if (!consumerNumber) {
      return res.status(400).json({ message: 'Consumer number is required' });
    }

    // Create form data for AI service
    const formData = new FormData();
    
    // Use buffer from memory storage instead of file path
    formData.append('image', req.file.buffer, { filename: req.file.originalname });
    formData.append('user_reading', user_reading || '0');

    try {
      // Call AI service
      const aiResponse = await axios.post(
        'https://gridvision-ai-model.onrender.com/validate-meter',
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 30000
        }
      );

      if (aiResponse.data.status === 'VALID') {
        // Check if OCR extraction was successful
        const ocrReading = aiResponse.data.meter_reading;
        
        if (!ocrReading || ocrReading.trim() === '') {
          // OCR failed - user must enter manually
          return res.status(200).json({ 
            status: 'OCR_FAILED',
            meter_reading: null,
            message: 'Could not extract reading from image. Please enter manually.',
            image_valid: true,
            reason: 'No valid meter reading could be extracted. Image is valid but OCR failed to detect digits.'
          });
        }

        // Return only the AI-extracted reading for display
        // Frontend will handle validation and submission
        return res.json({
          status: 'VALID',
          meter_reading: ocrReading,
          message: `AI extracted reading: ${ocrReading} kWh`
        });
      } else {
        return res.status(400).json(aiResponse.data);
      }
    } catch (aiError) {
      console.error('AI Service error:', aiError.message);
      return res.status(500).json({ 
        message: 'Error communicating with AI service',
        details: aiError.message 
      });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
      

// Add new consumer
exports.addConsumer = async (req, res) => {
  try {
    const existing = await Consumer.findOne({ consumerNumber: req.body.consumerNumber });
    if (existing) return res.status(400).json({ message: 'Consumer already exists' });

    const consumer = new Consumer(req.body);
    await consumer.save();
    res.status(201).json(consumer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get all consumers
exports.getConsumers = async (req, res) => {
  try {
    const consumers = await Consumer.find();
    res.json(consumers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Delete consumer by consumerNumber
exports.deleteConsumer = async (req, res) => {
  try {
    const result = await Consumer.findOneAndDelete({ consumerNumber: req.params.consumerNumber });
    if (!result) return res.status(404).json({ message: 'Consumer not found' });
    res.json({ message: 'Consumer deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get consumer by number
exports.getConsumer = async (req, res) => {
  try {
    const consumer = await Consumer.findOne({ consumerNumber: req.params.consumerNumber });
    if (!consumer) return res.status(404).json({ message: 'Consumer not found' });
    
    // Auto-correct status if amount is 0 and status is Pending
    if (consumer.amount === 0 && consumer.paymentStatus === 'Pending') {
      consumer.paymentStatus = 'Paid';
      consumer.nextPaymentDeadline = null;
      await consumer.save();
    }
    
    res.json(consumer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Update reading & calculate amount
exports.addReading = async (req, res) => {
  const { consumerNumber } = req.params;
  const { unitsConsumed, readingDate, currentReading } = req.body;

  const parsedUnits = Number(unitsConsumed);
  if (!Number.isFinite(parsedUnits)) {
    return res.status(400).json({ message: 'Invalid unitsConsumed' });
  }

  const parsedDate = readingDate ? new Date(readingDate) : new Date();
  if (isNaN(parsedDate)) {
    return res.status(400).json({ message: 'Invalid reading date' });
  }

  // Enforce reading window (day 1-15 of the active 60-day cycle) unless admin override
  const { readingStart, readingEnd, paymentEnd } = getCycleWindows(parsedDate);
  const dayStart = startOfDay(parsedDate);
  const isAdminOverride = req.user?.role === 'admin' && req.body?.adminOverride;
  if (!isAdminOverride && (dayStart < readingStart || dayStart > readingEnd)) {
    return res.status(400).json({ message: 'Reading can only be logged during the 1-15 window of the active cycle.' });
  }

  try {
    const consumer = await Consumer.findOne({ consumerNumber });
    if (!consumer) return res.status(404).json({ message: 'Consumer not found' });

    const isAdminOverride = req.user?.role === 'admin' && req.body?.adminOverride;

    // Enforce single reading per 60-day cycle (day 1-15) unless admin override
    const { readingStart, readingEnd } = getCycleWindows(parsedDate);
    const lastBillDate = consumer.lastBillDate ? startOfDay(consumer.lastBillDate) : null;
    const hasReadingThisCycle = lastBillDate && lastBillDate >= readingStart && lastBillDate <= readingEnd;
    if (!isAdminOverride && hasReadingThisCycle) {
      return res.status(400).json({ message: 'Reading already submitted for this cycle (days 1-15). Only one reading allowed per cycle.' });
    }

    const previous = consumer.currentReading || 0;
    const newReading = Number.isFinite(currentReading) ? Number(currentReading) : previous + parsedUnits;

    // For admin override, trust supplied unitsConsumed if positive; otherwise fall back to diff (clamped at 0)
    let computedUnits;
    if (isAdminOverride && parsedUnits >= 0) {
      computedUnits = parsedUnits;
    } else {
      computedUnits = newReading - previous;
    }

    if (!isAdminOverride && newReading <= previous) {
      return res.status(400).json({ message: `Current reading must be greater than previous reading (${previous}).` });
    }

    if (computedUnits < 0) computedUnits = 0;

    const tariffRates = {
      domestic: 5,
      commercial: 10,
      industrial: 15,
    };

    const rate = tariffRates[consumer.tariffPlan.toLowerCase()];
    if (!rate) return res.status(400).json({ message: 'Invalid tariff plan' });

    consumer.currentReading = newReading;
    consumer.amount = computedUnits * rate;

    // Set bill window per 60-day cycle: payment deadline = day 30 of the cycle
    consumer.lastBillDate = parsedDate;
    consumer.nextPaymentDeadline = paymentEnd;
    consumer.paymentStatus = 'Pending';

    // Reset fines on new bill
    consumer.isFineApplied = false;
    consumer.fineAmount = 0;
    consumer.cgstOnFine = 0;
    consumer.sgstOnFine = 0;
    consumer.totalFineWithTax = 0;

    // Add reading entry to history
    if (!consumer.readings) consumer.readings = [];

    consumer.readings.push({
      date: parsedDate,
      units: computedUnits,
      manualReading: newReading
    });

    await consumer.save();

    res.json(consumer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateConsumer = async (req, res) => {
  try {
    const { consumerNumber } = req.params;
    const updatedData = req.body;

    const consumer = await Consumer.findOneAndUpdate(
      { consumerNumber },
      updatedData,
      { new: true, runValidators: true } // Return the updated document and validate the data
    );

    if (!consumer) return res.status(404).json({ message: 'Consumer not found' });

    res.json(consumer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


exports.getConsumerByNumber = async (req, res) => {
  try {
    const consumer = await Consumer.findOne({ consumerNumber: req.params.consumerNumber });
    if (!consumer) return res.status(404).json({ message: 'Consumer not found' });

    // Get the last reading from the readings array
    const lastReading = consumer.readings.length > 0 ? consumer.readings[consumer.readings.length - 1] : null;
    // Show the actual meter reading (manualReading) instead of last cycle's units
    const previousMeterReading = lastReading?.manualReading ?? consumer.currentReading ?? 0;

    res.json({
      name: consumer.name,
      meterSerialNumber: consumer.meterSerialNumber,
      previousReading: previousMeterReading,
      lastUnitsConsumed: lastReading ? lastReading.units : 0,
      tariffPlan: consumer.tariffPlan,
    });
  } catch (error) {
    console.error('Error fetching consumer details:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.addCitizenReading = async (req, res) => {
  const { consumerNumber } = req.params;
  const { unitsConsumed, readingDate, currentReading } = req.body;

  const parsedUnits = Number(unitsConsumed);
  if (!Number.isFinite(parsedUnits)) {
    return res.status(400).json({ message: 'Invalid unitsConsumed' });
  }

  const parsedDate = new Date(readingDate);
  if (isNaN(parsedDate)) {
    return res.status(400).json({ message: 'Invalid reading date' });
  }

  try {
    const consumer = await Consumer.findOne({ consumerNumber });
    if (!consumer) return res.status(404).json({ message: 'Consumer not found' });

    if (consumer.role !== 'citizen') {
      return res.status(403).json({ message: 'You are not authorized to update this reading' });
    }

    const previous = consumer.currentReading || 0;
    const newReading = Number.isFinite(currentReading) ? Number(currentReading) : previous + parsedUnits;
    const computedUnits = newReading - previous;

    if (newReading <= previous) {
      return res.status(400).json({ message: `Current reading must be greater than previous reading (${previous}).` });
    }

    const tariffRates = {
      domestic: 5,
      commercial: 10,
      industrial: 15,
    };

    const rate = tariffRates[consumer.tariffPlan.toLowerCase()];
    if (!rate) return res.status(400).json({ message: 'Invalid tariff plan' });

    consumer.currentReading = newReading;
    consumer.amount = computedUnits * rate;

    consumer.lastBillDate = parsedDate;
    consumer.nextPaymentDeadline = computePaymentDeadline(parsedDate);
    consumer.paymentStatus = 'Pending';

    consumer.isFineApplied = false;
    consumer.fineAmount = 0;
    consumer.cgstOnFine = 0;
    consumer.sgstOnFine = 0;
    consumer.totalFineWithTax = 0;

    if (!consumer.readings) consumer.readings = [];
    consumer.readings.push({
      date: parsedDate,
      units: computedUnits,
      manualReading: newReading
    });

    await consumer.save();

    res.json({ message: 'Reading updated successfully', consumer });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getConsumerDetailsByNumber = async (req, res) => {
  try {
    const consumer = await Consumer.findOne({ consumerNumber: req.params.consumerNumber });
    if (!consumer) return res.status(404).json({ message: 'Consumer not found' });

    const lastReading = consumer.readings.length > 0 ? consumer.readings[consumer.readings.length - 1] : null;

    res.json({
      name: consumer.name,
      meterSerialNumber: consumer.meterSerialNumber,
      amount: consumer.amount,
      lastReadingDate: lastReading ? lastReading.date : null,
      tariffPlan: consumer.tariffPlan,
    });
  } catch (error) {
    console.error('Error fetching consumer details:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Calculate fixed fine amount with GST/CGST
const calculateFine = () => {
  const FIXED_FINE = 100; // Flat ₹100 fine
  const CGST = 0.09; // 9% CGST
  const SGST = 0.09; // 9% SGST

  const fineAmount = FIXED_FINE;
  const cgstOnFine = fineAmount * CGST;
  const sgstOnFine = fineAmount * SGST;
  const totalFineWithTax = fineAmount + cgstOnFine + sgstOnFine;

  return {
    fineAmount: parseFloat(fineAmount.toFixed(2)),
    cgstOnFine: parseFloat(cgstOnFine.toFixed(2)),
    sgstOnFine: parseFloat(sgstOnFine.toFixed(2)),
    totalFineWithTax: parseFloat(totalFineWithTax.toFixed(2))
  };
};

// Apply fine to an overdue consumer and persist flags/amounts. Returns true when a fine is newly set.
const applyFineIfOverdue = (consumer) => {
  const deadline = consumer.nextPaymentDeadline ? new Date(consumer.nextPaymentDeadline) : null;
  if (!deadline) return false;

  const now = new Date();
  const isOverdue = now > deadline && consumer.paymentStatus !== 'Paid';
  if (!isOverdue || consumer.isFineApplied) return false;

  const fineDetails = calculateFine();
  consumer.fineAmount = fineDetails.fineAmount;
  consumer.cgstOnFine = fineDetails.cgstOnFine;
  consumer.sgstOnFine = fineDetails.sgstOnFine;
  consumer.totalFineWithTax = fineDetails.totalFineWithTax;
  consumer.isFineApplied = true;
  consumer.fineAppliedDate = now;
  consumer.paymentStatus = 'Overdue';
  return true;
};

// Get bill summary with deadline and reminder
exports.getBillSummary = async (req, res) => {
  try {
    const consumer = await Consumer.findOne({ consumerNumber: req.params.consumerNumber });
    if (!consumer) return res.status(404).json({ message: 'Consumer not found' });

    const now = new Date();
    const currentCycle = getCycleWindows(now);

    // Derive tariff rate and last units consumed for display
    const tariffRates = {
      domestic: 5,
      commercial: 10,
      industrial: 15,
    };
    const tariffRate = tariffRates[(consumer.tariffPlan || '').toLowerCase()] || 0;
    const lastUnitsConsumed = Array.isArray(consumer.readings) && consumer.readings.length > 0
      ? consumer.readings[consumer.readings.length - 1].units
      : null;

    let billDeadline = consumer.nextPaymentDeadline ? new Date(consumer.nextPaymentDeadline) : null;

    // Reading pending if we are in the reading window of the current 60-day cycle and no reading logged in this cycle
    let readingPending = false;
    if (now >= currentCycle.readingStart && now <= currentCycle.readingEnd) {
      const lastBillDate = consumer.lastBillDate ? startOfDay(consumer.lastBillDate) : null;
      const hasReadingThisCycle = lastBillDate && lastBillDate >= currentCycle.readingStart && lastBillDate <= currentCycle.readingEnd;
      readingPending = !hasReadingThisCycle;
    }

    // Derive cycle windows based on last bill (or current date if none)
    if (consumer.lastBillDate) {
      const { paymentEnd } = getCycleWindows(consumer.lastBillDate);
      billDeadline = paymentEnd;
      consumer.nextPaymentDeadline = paymentEnd;
      await consumer.save();
    }

    const daysUntilDeadline = billDeadline ? Math.ceil((billDeadline - now) / (1000 * 60 * 60 * 24)) : 0;
    const isOverdue = billDeadline && now > billDeadline && consumer.paymentStatus !== 'Paid';
    
    // If amount is 0 and status is not explicitly 'Paid', treat as paid (no pending bill)
    if (consumer.amount === 0 && consumer.paymentStatus === 'Pending') {
      consumer.paymentStatus = 'Paid';
      consumer.nextPaymentDeadline = null;
      await consumer.save();
    }
    
    // Apply fine if overdue and not already applied
    let totalBillAmount = consumer.amount;
    let fineDetails = {
      fineAmount: 0,
      cgstOnFine: 0,
      sgstOnFine: 0,
      totalFineWithTax: 0
    };

    if (isOverdue && !consumer.isFineApplied) {
      fineDetails = calculateFine();
      consumer.fineAmount = fineDetails.fineAmount;
      consumer.cgstOnFine = fineDetails.cgstOnFine;
      consumer.sgstOnFine = fineDetails.sgstOnFine;
      consumer.totalFineWithTax = fineDetails.totalFineWithTax;
      consumer.isFineApplied = true;
      consumer.fineAppliedDate = new Date();
      consumer.paymentStatus = 'Overdue';
      await consumer.save();
    } else if (consumer.isFineApplied) {
      fineDetails = {
        fineAmount: consumer.fineAmount,
        cgstOnFine: consumer.cgstOnFine,
        sgstOnFine: consumer.sgstOnFine,
        totalFineWithTax: consumer.totalFineWithTax
      };
    }

    if (isOverdue && consumer.isFineApplied) {
      totalBillAmount = consumer.amount + consumer.totalFineWithTax;
    }

    // Determine reminder message based on current phase
    let reminderMessage = '';
    let reminderType = 'none';

    const { readingStart, readingEnd, paymentStart, paymentEnd } = getCycleWindows(now);
    const inReadingWindowNow = now >= readingStart && now <= readingEnd;
    const inPaymentWindowNow = now >= paymentStart && now <= paymentEnd;

    if (inReadingWindowNow && readingPending) {
      const daysLeftForReading = Math.max(0, Math.ceil((readingEnd - now) / DAY_MS));
      reminderType = 'reading';
      reminderMessage = `Reading required: submit meter reading by ${readingEnd.toDateString()} (${daysLeftForReading} day(s) left).`;
    } else if (isOverdue) {
      reminderType = 'overdue';
      reminderMessage = `⚠️ OVERDUE: Your bill payment was due on ${billDeadline.toDateString()}. Please pay immediately to avoid further penalties.`;
    } else if (inPaymentWindowNow && daysUntilDeadline <= 3 && daysUntilDeadline > 0) {
      reminderType = 'urgent';
      reminderMessage = `🔴 URGENT: Only ${daysUntilDeadline} day(s) left to pay your bill! Deadline: ${billDeadline.toDateString()}`;
    } else if (inPaymentWindowNow && daysUntilDeadline <= 7 && daysUntilDeadline > 3) {
      reminderType = 'warning';
      reminderMessage = `🟡 REMINDER: Your bill is due in ${daysUntilDeadline} days. Deadline: ${billDeadline.toDateString()}`;
    } else if (inPaymentWindowNow && daysUntilDeadline > 7) {
      reminderType = 'notice';
      reminderMessage = `ℹ️ Upcoming Bill: Your next payment is due on ${billDeadline.toDateString()} (${daysUntilDeadline} days remaining)`;
    }

    res.json({
      consumerNumber: consumer.consumerNumber,
      name: consumer.name,
      address: consumer.address,
      phoneNumber: consumer.phoneNumber,
      meterSerialNumber: consumer.meterSerialNumber,
      tariffPlan: consumer.tariffPlan,
      
      // Bill Details
      billAmount: consumer.amount,
      currentReading: consumer.currentReading,
      lastUnitsConsumed: lastUnitsConsumed,
      tariffRate: tariffRate,
      paymentStatus: consumer.paymentStatus,
      lastPaymentDate: consumer.lastPaymentDate,
      lastPaidAmount: consumer.lastPaidAmount,
      
      // Deadline & Reminder
      billCycleDays: consumer.billCycleDays,
      nextPaymentDeadline: billDeadline,
      daysUntilDeadline: daysUntilDeadline,
      isOverdue: isOverdue,
      
      // Fine Details
      isFineApplied: consumer.isFineApplied,
      fineDetails: fineDetails,
      
      // Total Amount (Bill + Fine if applicable)
      totalAmountDue: parseFloat(totalBillAmount.toFixed(2)),
      
      // Reminder
      reminderMessage: reminderMessage,
      reminderType: reminderType,

      // Reading window info
      readingPending,
      readingWindowStart: currentCycle.readingStart,
      readingWindowEnd: currentCycle.readingEnd
    });
  } catch (error) {
    console.error('Error fetching bill summary:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Mark payment as paid
exports.markPaymentAsPaid = async (req, res) => {
  try {
    const consumer = await Consumer.findOne({ consumerNumber: req.params.consumerNumber });
    if (!consumer) return res.status(404).json({ message: 'Consumer not found' });

    consumer.paymentStatus = 'Paid';
    consumer.lastPaymentDate = new Date();
    const paidAmount = consumer.amount + (consumer.isFineApplied ? consumer.totalFineWithTax : 0);
    consumer.lastPaidAmount = parseFloat(paidAmount.toFixed(2));
    // Clear current bill amount once payment is completed
    consumer.amount = 0;
    
    // Reset fine and reminder flags for next cycle
    consumer.isFineApplied = false;
    consumer.fineAmount = 0;
    consumer.cgstOnFine = 0;
    consumer.sgstOnFine = 0;
    consumer.totalFineWithTax = 0;
    consumer.reminderSent7Days = false;
    consumer.reminderSent3Days = false;
    consumer.overdueReminderSent = false;
    
    // Await next reading before setting a fresh due date
    consumer.nextPaymentDeadline = null;
    
    await consumer.save();

    res.json({ 
      message: 'Payment marked as successful',
      consumer: consumer
    });
  } catch (error) {
    console.error('Error marking payment:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get all consumers with fines (for admin) and auto-apply fines when overdue
exports.getConsumersWithFines = async (req, res) => {
  try {
    const candidates = await Consumer.find({ paymentStatus: { $ne: 'Paid' } });
    const finedConsumers = [];

    for (const consumer of candidates) {
      const newlyFined = applyFineIfOverdue(consumer);
      if (newlyFined) {
        await consumer.save();
      }

      if (consumer.isFineApplied) {
        finedConsumers.push({
          consumerNumber: consumer.consumerNumber,
          name: consumer.name,
          address: consumer.address,
          phoneNumber: consumer.phoneNumber,
          meterSerialNumber: consumer.meterSerialNumber,
          tariffPlan: consumer.tariffPlan,
          amount: consumer.amount,
          fineAmount: consumer.fineAmount,
          cgstOnFine: consumer.cgstOnFine,
          sgstOnFine: consumer.sgstOnFine,
          totalFineWithTax: consumer.totalFineWithTax,
          fineAppliedDate: consumer.fineAppliedDate,
          paymentStatus: consumer.paymentStatus
        });
      }
    }

    res.json(finedConsumers);
  } catch (error) {
    console.error('Error fetching consumers with fines:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get all consumers who missed submitting readings in the last reading window
exports.getConsumersWithMissedReadings = async (req, res) => {
  try {
    const now = new Date();
    const { readingStart, readingEnd, idleEnd } = getCycleWindows(now);

    const consumers = await Consumer.find({});
    const missed = [];

    for (const consumer of consumers) {
      const lastBillDate = consumer.lastBillDate ? startOfDay(consumer.lastBillDate) : null;
      // Consider a reading recorded any time within the current cycle (day 1-60) as fulfilling the cycle
      const hasReadingThisCycle = lastBillDate && lastBillDate >= readingStart && lastBillDate <= idleEnd;
      const failedToUpload = now > readingEnd && !hasReadingThisCycle;

      if (failedToUpload) {
        missed.push({
          consumerNumber: consumer.consumerNumber,
          name: consumer.name,
          address: consumer.address,
          phoneNumber: consumer.phoneNumber,
          meterSerialNumber: consumer.meterSerialNumber,
          tariffPlan: consumer.tariffPlan,
          lastBillDate: consumer.lastBillDate,
          readingWindowStart: readingStart,
          readingWindowEnd: readingEnd
        });
      }
    }

    res.json(missed);
  } catch (error) {
    console.error('Error fetching consumers with missed readings:', error);
    res.status(500).json({ message: 'Server error' });
  }
};