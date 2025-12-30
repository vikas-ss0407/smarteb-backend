// Utility functions for bill calculations and reminders
// These calculations run on the server to ensure data integrity

const calculateDaysUntilDeadline = (deadlineDate) => {
  const now = new Date();
  const deadline = new Date(deadlineDate);
  const daysRemaining = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
  return daysRemaining;
};

const isOverdue = (deadlineDate) => {
  const now = new Date();
  const deadline = new Date(deadlineDate);
  return now > deadline;
};

const getReminderType = (daysUntilDeadline, isOverdue) => {
  if (isOverdue) return 'overdue';
  if (daysUntilDeadline <= 3 && daysUntilDeadline > 0) return 'urgent';
  if (daysUntilDeadline <= 7 && daysUntilDeadline > 3) return 'warning';
  if (daysUntilDeadline > 7) return 'notice';
  return 'none';
};

const calculateFine = () => {
  const FIXED_FINE = 100; // Flat fine amount
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

const generateReminderMessage = (reminderType, daysUntilDeadline, deadlineDate) => {
  const date = new Date(deadlineDate).toDateString();
  
  switch (reminderType) {
    case 'overdue':
      return `⚠️ OVERDUE: Your bill payment was due on ${date}. Please pay immediately to avoid further penalties.`;
    case 'urgent':
      return `🔴 URGENT: Only ${daysUntilDeadline} day(s) left to pay your bill! Deadline: ${date}`;
    case 'warning':
      return `🟡 REMINDER: Your bill is due in ${daysUntilDeadline} days. Deadline: ${date}`;
    case 'notice':
      return `ℹ️ Upcoming Bill: Your next payment is due on ${date} (${daysUntilDeadline} days remaining)`;
    default:
      return '';
  }
};

const getTotalAmountDue = (billAmount, fineDetails) => {
  if (fineDetails && fineDetails.totalFineWithTax) {
    return parseFloat((billAmount + fineDetails.totalFineWithTax).toFixed(2));
  }
  return parseFloat(billAmount.toFixed(2));
};

const formatCurrency = (amount) => {
  return `₹${parseFloat(amount).toFixed(2)}`;
};

// Calculate complete bill details including fines and reminders
const calculateBillDetails = (billAmount, deadlineDate) => {
  const daysUntilDeadline = calculateDaysUntilDeadline(deadlineDate);
  const overdueStatus = isOverdue(deadlineDate);
  const reminderType = getReminderType(daysUntilDeadline, overdueStatus);
  const fineDetails = overdueStatus ? calculateFine() : null;
  const totalAmountDue = getTotalAmountDue(billAmount, fineDetails);
  const reminderMessage = generateReminderMessage(reminderType, daysUntilDeadline, deadlineDate);

  return {
    billAmount: parseFloat(billAmount.toFixed(2)),
    deadlineDate,
    daysUntilDeadline,
    isOverdue: overdueStatus,
    reminderType,
    fineDetails,
    totalAmountDue,
    reminderMessage
  };
};

module.exports = {
  calculateDaysUntilDeadline,
  isOverdue,
  getReminderType,
  calculateFine,
  generateReminderMessage,
  getTotalAmountDue,
  formatCurrency,
  calculateBillDetails
};
