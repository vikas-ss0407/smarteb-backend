const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Ensure these are functions
router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.get('/:userId', authController.getUserById);
module.exports = router;
