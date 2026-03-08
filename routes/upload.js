const express = require('express');
const { param } = require('express-validator');
const router = express.Router();

// Import controllers
const uploadController = require('../controllers/uploadController');

// Import middleware
const { protect } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { validate } = require('../middleware/validator');

/**
 * @route   POST /api/upload/pdf
 * @desc    Upload and process PDF
 * @access  Private
 */
router.post(
  '/pdf',
  protect,
  upload.single('pdf'),
  uploadController.uploadPDF
);

/**
 * @route   GET /api/upload/status/:id
 * @desc    Get upload processing status
 * @access  Private
 */
router.get(
  '/status/:id',
  protect,
  [
    param('id').isMongoId().withMessage('Invalid upload ID')
  ],
  validate,
  uploadController.getUploadStatus
);

/**
 * @route   GET /api/uploads
 * @desc    Get all user uploads
 * @access  Private
 */
router.get('/', protect, uploadController.getUserUploads);

/**
 * @route   GET /api/upload/:id
 * @desc    Get single upload by ID
 * @access  Private
 */
router.get(
  '/:id',
  protect,
  [
    param('id').isMongoId().withMessage('Invalid upload ID')
  ],
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
  protect,
  [
    param('id').isMongoId().withMessage('Invalid upload ID')
  ],
  validate,
  uploadController.deleteUpload
);

module.exports = router;