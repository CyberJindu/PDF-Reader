const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../utils/logger');

console.log('📁 [Upload Middleware] Initializing...');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../uploads');
console.log(`📁 [Upload Middleware] Upload directory: ${uploadDir}`);

if (!fs.existsSync(uploadDir)) {
  console.log(`📁 [Upload Middleware] Creating upload directory: ${uploadDir}`);
  fs.mkdirSync(uploadDir, { recursive: true });
} else {
  console.log(`✅ [Upload Middleware] Upload directory exists`);
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log(`📁 [Storage] Destination called for file: ${file.originalname}`);
    // Create user-specific directory if needed
    const userDir = req.user ? path.join(uploadDir, req.user.id) : uploadDir;
    console.log(`📁 [Storage] User directory: ${userDir}`);
    
    if (!fs.existsSync(userDir)) {
      console.log(`📁 [Storage] Creating user directory: ${userDir}`);
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${uniqueSuffix}${ext}`;
    console.log(`📄 [Storage] Generated filename: ${filename}`);
    cb(null, filename);
  }
});

// File filter - only allow PDFs
const fileFilter = (req, file, cb) => {
  console.log(`🔍 [FileFilter] Checking file: ${file.originalname}, MIME: ${file.mimetype}`);
  const allowedTypes = ['application/pdf'];
  
  if (allowedTypes.includes(file.mimetype)) {
    console.log(`✅ [FileFilter] File accepted: ${file.originalname}`);
    cb(null, true);
  } else {
    console.log(`❌ [FileFilter] File rejected: ${file.originalname} (${file.mimetype})`);
    cb(new Error('Only PDF files are allowed'), false);
  }
};

// Multer upload instance
console.log(`⚙️ [Upload Middleware] Creating multer instance...`);
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: process.env.MAX_FILE_SIZE || 50 * 1024 * 1024, // 50MB default
    files: 1 // Only 1 file at a time
  }
});
console.log(`✅ [Upload Middleware] Multer instance created`);

/**
 * Handle multer errors
 */
const handleMulterError = (err, req, res, next) => {
  console.log(`⚠️ [handleMulterError] Error:`, err.message);
  
  if (err instanceof multer.MulterError) {
    console.log(`📊 [handleMulterError] Multer error code: ${err.code}`);
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        console.log(`❌ [handleMulterError] File too large`);
        return res.status(400).json({
          success: false,
          message: `File too large. Maximum size is ${process.env.MAX_FILE_SIZE / (1024 * 1024)}MB`
        });
      case 'LIMIT_FILE_COUNT':
        console.log(`❌ [handleMulterError] Too many files`);
        return res.status(400).json({
          success: false,
          message: 'Too many files. Only one file allowed'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        console.log(`❌ [handleMulterError] Unexpected field`);
        return res.status(400).json({
          success: false,
          message: 'Unexpected field name. Use "pdf" field'
        });
      default:
        console.log(`❌ [handleMulterError] Unknown multer error`);
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`
        });
    }
  }
  console.log(`⚠️ [handleMulterError] Non-multer error, passing to next`);
  next(err);
};

/**
 * Validate file before processing
 */
const validateFile = (req, res, next) => {
  console.log(`🔍 [validateFile] Validating file...`);
  
  if (!req.file) {
    console.log(`❌ [validateFile] No file uploaded`);
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }

  console.log(`📄 [validateFile] File: ${req.file.originalname}, Path: ${req.file.path}`);

  // Additional validation
  const file = req.file;
  
  try {
    // Check if file is actually a PDF (by magic numbers)
    console.log(`🔍 [validateFile] Checking PDF magic number...`);
    const fd = fs.openSync(file.path, 'r');
    const buffer = Buffer.alloc(4);
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    
    const magicNumber = buffer.toString();
    console.log(`📊 [validateFile] Magic number: ${magicNumber}`);
    
    // PDF magic number: %PDF
    if (magicNumber !== '%PDF') {
      console.log(`❌ [validateFile] Invalid PDF magic number: ${magicNumber}`);
      // Delete invalid file
      fs.unlink(file.path, (err) => {
        if (err) {
          console.log(`⚠️ [validateFile] Error deleting invalid file:`, err);
          logger.error('Error deleting invalid file:', err);
        } else {
          console.log(`🗑️ [validateFile] Invalid file deleted`);
        }
      });
      
      return res.status(400).json({
        success: false,
        message: 'Invalid PDF file'
      });
    }
    
    console.log(`✅ [validateFile] File validated as PDF`);
    next();
  } catch (error) {
    console.log(`❌ [validateFile] Validation error:`, error.message);
    // Clean up file on error
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
        console.log(`🗑️ [validateFile] File cleaned up after validation error`);
      }
    } catch (cleanupError) {
      console.log(`⚠️ [validateFile] Cleanup error:`, cleanupError);
    }
    next(error);
  }
};

/**
 * Clean up failed uploads
 */
const cleanupFailedUpload = (err, req, res, next) => {
  console.log(`🧹 [cleanupFailedUpload] Cleaning up failed upload...`);
  
  // If there's a file and there was an error, delete it
  if (req.file && req.file.path) {
    console.log(`🗑️ [cleanupFailedUpload] Deleting file: ${req.file.path}`);
    fs.unlink(req.file.path, (unlinkErr) => {
      if (unlinkErr) {
        console.log(`⚠️ [cleanupFailedUpload] Error deleting file:`, unlinkErr);
        logger.error('Error cleaning up failed upload:', unlinkErr);
      } else {
        console.log(`✅ [cleanupFailedUpload] File deleted`);
      }
    });
  } else {
    console.log(`ℹ️ [cleanupFailedUpload] No file to clean up`);
  }
  next(err);
};

/**
 * Progress tracking middleware
 */
const trackUploadProgress = (req, res, next) => {
  console.log(`📊 [trackUploadProgress] Setting up progress tracking...`);
  let progress = 0;
  const contentLength = req.headers['content-length'];
  
  if (contentLength) {
    console.log(`📊 [trackUploadProgress] Content-Length: ${contentLength} bytes`);
  } else {
    console.log(`⚠️ [trackUploadProgress] No Content-Length header`);
  }
  
  req.on('data', (chunk) => {
    // Calculate approximate progress
    if (contentLength) {
      progress += chunk.length;
      const percent = Math.round((progress / parseInt(contentLength)) * 100);
      
      // Log every 10% progress
      if (percent % 10 === 0 && progress > 0) {
        console.log(`📊 [trackUploadProgress] Upload progress: ${percent}%`);
      }
      
      // Emit progress event (if using WebSockets)
      if (req.io) {
        req.io.emit('upload-progress', { progress: percent });
      }
    }
  });

  req.on('end', () => {
    console.log(`✅ [trackUploadProgress] Upload completed`);
  });

  req.on('error', (error) => {
    console.log(`❌ [trackUploadProgress] Upload error:`, error.message);
  });

  next();
};

/**
 * Check user upload limits
 */
const checkUploadLimits = async (req, res, next) => {
  console.log(`📊 [checkUploadLimits] Checking upload limits...`);
  
  try {
    if (!req.user) {
      console.log(`ℹ️ [checkUploadLimits] No user, skipping limit check`);
      return next();
    }

    console.log(`👤 [checkUploadLimits] User ID: ${req.user.id}`);
    const user = req.user;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's upload count from Note model
    const Note = require('../models/Note');
    const todayUploads = await Note.countDocuments({
      user: user._id,
      createdAt: { $gte: today }
    });

    const maxUploads = user.subscription?.features?.maxUploadsPerDay || 5;
    console.log(`📊 [checkUploadLimits] Today's uploads: ${todayUploads}, Max: ${maxUploads}`);

    if (todayUploads >= maxUploads) {
      console.log(`❌ [checkUploadLimits] Upload limit exceeded`);
      return res.status(429).json({
        success: false,
        message: `Daily upload limit reached (${maxUploads} per day)`
      });
    }

    console.log(`✅ [checkUploadLimits] Upload limit check passed`);
    next();
  } catch (error) {
    console.log(`❌ [checkUploadLimits] Error:`, error.message);
    logger.error('Upload limit check error:', error);
    next(error);
  }
};

console.log(`✅ [Upload Middleware] All middleware exported`);

module.exports = {
  upload,
  handleMulterError,
  validateFile,
  cleanupFailedUpload,
  trackUploadProgress,
  checkUploadLimits
};
