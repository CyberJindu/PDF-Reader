const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../utils/logger');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create user-specific directory if needed
    const userDir = req.user ? path.join(uploadDir, req.user.id) : uploadDir;
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${uniqueSuffix}${ext}`);
  }
});

// File filter - only allow PDFs
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

// Multer upload instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: process.env.MAX_FILE_SIZE || 50 * 1024 * 1024, // 50MB default
    files: 1 // Only 1 file at a time
  }
});

/**
 * Handle multer errors
 */
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          message: `File too large. Maximum size is ${process.env.MAX_FILE_SIZE / (1024 * 1024)}MB`
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many files. Only one file allowed'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: 'Unexpected field name. Use "pdf" field'
        });
      default:
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`
        });
    }
  }
  next(err);
};

/**
 * Validate file before processing
 */
const validateFile = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }

  // Additional validation
  const file = req.file;
  
  // Check if file is actually a PDF (by magic numbers)
  const fd = fs.openSync(file.path, 'r');
  const buffer = Buffer.alloc(4);
  fs.readSync(fd, buffer, 0, 4, 0);
  fs.closeSync(fd);
  
  // PDF magic number: %PDF
  if (buffer.toString() !== '%PDF') {
    // Delete invalid file
    fs.unlink(file.path, (err) => {
      if (err) logger.error('Error deleting invalid file:', err);
    });
    
    return res.status(400).json({
      success: false,
      message: 'Invalid PDF file'
    });
  }

  next();
};

/**
 * Clean up failed uploads
 */
const cleanupFailedUpload = (err, req, res, next) => {
  // If there's a file and there was an error, delete it
  if (req.file && req.file.path) {
    fs.unlink(req.file.path, (unlinkErr) => {
      if (unlinkErr) {
        logger.error('Error cleaning up failed upload:', unlinkErr);
      }
    });
  }
  next(err);
};

/**
 * Progress tracking middleware
 */
const trackUploadProgress = (req, res, next) => {
  let progress = 0;
  
  req.on('data', (chunk) => {
    // Calculate approximate progress
    if (req.headers['content-length']) {
      progress += chunk.length;
      const percent = Math.round((progress / parseInt(req.headers['content-length'])) * 100);
      
      // Emit progress event (if using WebSockets)
      if (req.io) {
        req.io.emit('upload-progress', { progress: percent });
      }
    }
  });

  next();
};

/**
 * Check user upload limits
 */
const checkUploadLimits = async (req, res, next) => {
  try {
    if (!req.user) {
      return next();
    }

    const user = req.user;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's upload count from Note model
    const Note = require('../models/Note');
    const todayUploads = await Note.countDocuments({
      user: user._id,
      createdAt: { $gte: today }
    });

    const maxUploads = user.subscription.features.maxUploadsPerDay || 5;

    if (todayUploads >= maxUploads) {
      return res.status(429).json({
        success: false,
        message: `Daily upload limit reached (${maxUploads} per day)`
      });
    }

    next();
  } catch (error) {
    logger.error('Upload limit check error:', error);
    next(error);
  }
};

module.exports = {
  upload,
  handleMulterError,
  validateFile,
  cleanupFailedUpload,
  trackUploadProgress,
  checkUploadLimits
};