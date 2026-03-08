const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// Import logger
const logger = require('../utils/logger');

/**
 * @route   GET /api/health
 * @desc    Health check endpoint
 * @access  Public
 */
router.get('/', (req, res) => {
  const healthcheck = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: Date.now(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV,
    services: {
      gemini: 'pending', // Will be updated when used
      xtts: 'pending'    // Will be updated when used
    }
  };

  try {
    res.status(200).json({
      success: true,
      data: healthcheck
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    healthcheck.message = error;
    res.status(503).json({
      success: false,
      data: healthcheck
    });
  }
});

/**
 * @route   GET /api/health/detailed
 * @desc    Detailed health check with service status
 * @access  Public
 */
router.get('/detailed', async (req, res) => {
  const startTime = Date.now();
  
  // Check database
  const dbStatus = mongoose.connection.readyState === 1;
  
  // Check memory usage
  const memoryUsage = process.memoryUsage();
  
  const healthData = {
    status: dbStatus ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    responseTime: `${Date.now() - startTime}ms`,
    database: {
      status: dbStatus ? 'connected' : 'disconnected',
      name: mongoose.connection.name,
      host: mongoose.connection.host
    },
    system: {
      memory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`
      },
      cpu: process.cpuUsage(),
      platform: process.platform,
      nodeVersion: process.version
    }
  };

  res.status(dbStatus ? 200 : 503).json({
    success: dbStatus,
    data: healthData
  });
});

/**
 * @route   GET /api/health/ping
 * @desc    Simple ping endpoint
 * @access  Public
 */
router.get('/ping', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'pong',
    timestamp: Date.now()
  });
});

module.exports = router;