const express = require('express');
const { param } = require('express-validator');
const router = express.Router();

// Import controllers
const uploadController = require('../controllers/uploadController');

// Import middleware
const { protect } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { validate } = require('../middleware/validator');

console.log('🛤️ [Upload Route] Initializing routes...');

/**
 * @route   POST /api/upload/pdf
 * @desc    Upload and process PDF
 * @access  Private
 */
router.post(
  '/pdf',
  (req, res, next) => {
    console.log(`🛤️ [POST /api/upload/pdf] Request received`);
    console.log(`📄 [POST /api/upload/pdf] Content-Type: ${req.headers['content-type']}`);
    console.log(`📄 [POST /api/upload/pdf] User: ${req.user ? req.user.id : 'Not authenticated'}`);
    next();
  },
  protect,
  (req, res, next) => {
    console.log(`✅ [POST /api/upload/pdf] Authentication passed`);
    console.log(`👤 [POST /api/upload/pdf] User ID: ${req.user.id}`);
    next();
  },
  upload.single('pdf'),
  (req, res, next) => {
    if (req.file) {
      console.log(`✅ [POST /api/upload/pdf] File uploaded successfully`);
      console.log(`📄 [POST /api/upload/pdf] File: ${req.file.originalname}`);
      console.log(`📏 [POST /api/upload/pdf] Size: ${req.file.size} bytes`);
      console.log(`📁 [POST /api/upload/pdf] Path: ${req.file.path}`);
    } else {
      console.log(`⚠️ [POST /api/upload/pdf] No file uploaded`);
    }
    next();
  },
  uploadController.uploadPDF
);

/**
 * @route   GET /api/upload/status/:id
 * @desc    Get upload processing status
 * @access  Private
 */
router.get(
  '/status/:id',
  (req, res, next) => {
    console.log(`🛤️ [GET /api/upload/status/:id] Request received`);
    console.log(`🆔 [GET /api/upload/status/:id] ID: ${req.params.id}`);
    console.log(`👤 [GET /api/upload/status/:id] User: ${req.user ? req.user.id : 'Not authenticated'}`);
    next();
  },
  protect,
  (req, res, next) => {
    console.log(`✅ [GET /api/upload/status/:id] Authentication passed`);
    console.log(`👤 [GET /api/upload/status/:id] User ID: ${req.user.id}`);
    next();
  },
  [
    param('id').notEmpty().withMessage('Upload ID is required')
  ],
  (req, res, next) => {
    console.log(`✅ [GET /api/upload/status/:id] Validation passed`);
    console.log(`🔍 [GET /api/upload/status/:id] Looking for uploadId: ${req.params.id}`);
    next();
  },
  validate,
  (req, res, next) => {
    console.log(`✅ [GET /api/upload/status/:id] Validate middleware passed`);
    next();
  },
  uploadController.getUploadStatus
);

/**
 * @route   GET /api/uploads
 * @desc    Get all user uploads
 * @access  Private
 */
router.get(
  '/',
  (req, res, next) => {
    console.log(`🛤️ [GET /api/uploads] Request received`);
    console.log(`👤 [GET /api/uploads] User: ${req.user ? req.user.id : 'Not authenticated'}`);
    next();
  },
  protect,
  (req, res, next) => {
    console.log(`✅ [GET /api/uploads] Authentication passed`);
    console.log(`👤 [GET /api/uploads] User ID: ${req.user.id}`);
    next();
  },
  uploadController.getUserUploads
);

/**
 * @route   GET /api/upload/:id
 * @desc    Get single upload by ID
 * @access  Private
 */
router.get(
  '/:id',
  (req, res, next) => {
    console.log(`🛤️ [GET /api/upload/:id] Request received`);
    console.log(`🆔 [GET /api/upload/:id] ID: ${req.params.id}`);
    console.log(`👤 [GET /api/upload/:id] User: ${req.user ? req.user.id : 'Not authenticated'}`);
    next();
  },
  protect,
  (req, res, next) => {
    console.log(`✅ [GET /api/upload/:id] Authentication passed`);
    console.log(`👤 [GET /api/upload/:id] User ID: ${req.user.id}`);
    next();
  },
  [
    param('id').isMongoId().withMessage('Invalid note ID format')
  ],
  (req, res, next) => {
    console.log(`✅ [GET /api/upload/:id] Validation passed`);
    next();
  },
  validate,
  uploadController.getUpload
);

/**
 * @route   DELETE /api/upload/:id
 * @desc    Delete upload
 * @access  Private
 */
router.delete(
  '/:id',
  (req, res, next) => {
    console.log(`🛤️ [DELETE /api/upload/:id] Request received`);
    console.log(`🆔 [DELETE /api/upload/:id] ID: ${req.params.id}`);
    console.log(`👤 [DELETE /api/upload/:id] User: ${req.user ? req.user.id : 'Not authenticated'}`);
    next();
  },
  protect,
  (req, res, next) => {
    console.log(`✅ [DELETE /api/upload/:id] Authentication passed`);
    console.log(`👤 [DELETE /api/upload/:id] User ID: ${req.user.id}`);
    next();
  },
  [
    param('id').isMongoId().withMessage('Invalid note ID format')
  ],
  (req, res, next) => {
    console.log(`✅ [DELETE /api/upload/:id] Validation passed`);
    next();
  },
  validate,
  uploadController.deleteUpload
);

console.log(`✅ [Upload Route] All routes registered`);
console.log(`📋 [Upload Route] Routes available:`);
console.log(`   POST   /api/upload/pdf`);
console.log(`   GET    /api/upload/status/:id`);
console.log(`   GET    /api/uploads`);
console.log(`   GET    /api/upload/:id`);
console.log(`   DELETE /api/upload/:id`);

module.exports = router;
