const { calculateBillDetails } = require('../utils/billCalculations');

// Calculate bill details including fines and reminders
const getBillCalculation = async (req, res) => {
  try {
    const { billAmount, deadlineDate } = req.body;

    // Validate input
    if (!billAmount || !deadlineDate) {
      return res.status(400).json({
        success: false,
        message: 'Bill amount and deadline date are required'
      });
    }

    if (isNaN(billAmount) || billAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bill amount'
      });
    }

    // Calculate bill details
    const billDetails = calculateBillDetails(parseFloat(billAmount), deadlineDate);

    res.status(200).json({
      success: true,
      data: billDetails
    });
  } catch (error) {
    console.error('Error calculating bill:', error);
    res.status(500).json({
      success: false,
      message: 'Error calculating bill details',
      error: error.message
    });
  }
};

module.exports = {
  getBillCalculation
};
