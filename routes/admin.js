const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protectAdmin } = require('../middleware/adminAuth');

// All routes require admin authentication
router.use(protectAdmin);

// Get all users
router.get('/users', adminController.getAllUsers);

// Get user details
router.get('/users/:userId', adminController.getUserDetails);

// Update user privileges (toggle ON/OFF premium access)
router.put('/users/:userId/privileges', adminController.updateUserPrivileges);

// Get user stats
router.get('/users/:userId/stats', adminController.getUserStats);

// Deactivate user
router.delete('/users/:userId/deactivate', adminController.deactivateUser);

module.exports = router;
