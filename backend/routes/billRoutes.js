const express = require('express');
const router = express.Router();
const { getBillCalculation } = require('../controllers/billController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);
// POST /api/bills/calculate - Calculate bill details with fines and reminders
router.post('/calculate', getBillCalculation);

module.exports = router;
