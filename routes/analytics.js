const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { protectAdmin } = require('../middleware/adminAuth');

// All routes require admin authentication
router.use(protectAdmin);

// Dashboard metrics (total users, downloads, summaries)
router.get('/dashboard', analyticsController.getDashboardMetrics);

// Usage trends for charts (daily/weekly/monthly)
router.get('/trends', analyticsController.getUsageTrends);

// Total audio streams
router.get('/audio-streams', analyticsController.getAudioStreams);

// Conversion rate (Premium vs General users)
router.get('/conversion-rate', analyticsController.getConversionRate);

module.exports = router;
