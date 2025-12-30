const mongoose = require('mongoose');

const consumerSchema = new mongoose.Schema({
  consumerNumber: { type: String, required: true, unique: true },
  meterSerialNumber: { type: String, required: true },
  name: { type: String, required: true },
  address: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  tariffPlan: { type: String, enum: ['Domestic', 'Commercial', 'Industrial'], required: true },
  currentReading: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
  lastPaidAmount: { type: Number, default: 0 },

  // Bill Cycle & Deadline
  billCycleDays: { type: Number, default: 30, enum: [30, 45] }, // 30 or 45 days cycle
  lastBillDate: { type: Date, default: null },
  nextPaymentDeadline: { type: Date, default: null },
  
  // Payment Status
  paymentStatus: { type: String, enum: ['Paid', 'Pending', 'Overdue'], default: 'Pending' },
  lastPaymentDate: { type: Date, default: null },
  
  // Fine & Penalty
  fineAmount: { type: Number, default: 0 },
  cgstOnFine: { type: Number, default: 0 }, // 9% CGST
  sgstOnFine: { type: Number, default: 0 }, // 9% SGST (combined = 18% GST)
  totalFineWithTax: { type: Number, default: 0 },
  fineAppliedDate: { type: Date, default: null },
  isFineApplied: { type: Boolean, default: false },
  
  // Reminder Tracking
  reminderSent7Days: { type: Boolean, default: false },
  reminderSent3Days: { type: Boolean, default: false },
  overdueReminderSent: { type: Boolean, default: false },

  readings: [
    {
      date: { type: Date, required: true },
      units: { type: Number, required: true },
      aiExtractedReading: { type: Number },
      manualReading: { type: Number }
    }
  ]
});

const Consumer = mongoose.model('Consumer', consumerSchema);

module.exports = Consumer;
