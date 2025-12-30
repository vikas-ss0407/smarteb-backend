const express = require('express');
const router = express.Router();
const consumerController = require('../controllers/consumerController');
const multer = require('multer');
const path = require('path');
const authMiddleware = require('../middleware/authMiddleware');

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `meter-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG and PNG images are allowed'), false);
    }
  }
});

// Protect all routes
router.use(authMiddleware);

// Bill summary and payment routes (specific routes before generic ones)
router.get('/fines/all', consumerController.getConsumersWithFines);
router.get('/bill-summary/:consumerNumber', consumerController.getBillSummary);
router.post('/mark-paid/:consumerNumber', consumerController.markPaymentAsPaid);

// General CRUD routes
router.post('/', consumerController.addConsumer);
router.get('/', consumerController.getConsumers);
router.get('/details/:consumerNumber', consumerController.getConsumerDetailsByNumber);
router.get('/:consumerNumber', consumerController.getConsumer);
router.delete('/:consumerNumber', consumerController.deleteConsumer);
router.put('/add-reading/:consumerNumber', consumerController.addReading);
router.put('/:consumerNumber', consumerController.updateConsumer);
router.put('/citizen/update-reading/:consumerNumber', consumerController.addCitizenReading);

// Special endpoints
router.post('/validate-meter-image', upload.single('image'), consumerController.validateMeterImage);

module.exports = router;
