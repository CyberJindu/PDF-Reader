const express = require('express');
const { param, body } = require('express-validator');
const router = express.Router();

// Import controllers
const notesController = require('../controllers/notesController');

// Import middleware
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validator');

/**
 * @route   GET /api/notes
 * @desc    Get all user notes (summaries)
 * @access  Private
 */
router.get('/', protect, notesController.getAllNotes);

/**
 * @route   GET /api/notes/:id
 * @desc    Get single note by ID
 * @access  Private
 */
router.get(
  '/:id',
  protect,
  [
    param('id').isMongoId().withMessage('Invalid note ID')
  ],
  validate,
  notesController.getNote
);

/**
 * @route   PATCH /api/notes/:id
 * @desc    Update note (title, tags, etc.)
 * @access  Private
 */
router.patch(
  '/:id',
  protect,
  [
    param('id').isMongoId().withMessage('Invalid note ID'),
    body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
    body('tags').optional().isArray().withMessage('Tags must be an array')
  ],
  validate,
  notesController.updateNote
);

/**
 * @route   DELETE /api/notes/:id
 * @desc    Delete note
 * @access  Private
 */
router.delete(
  '/:id',
  protect,
  [
    param('id').isMongoId().withMessage('Invalid note ID')
  ],
  validate,
  notesController.deleteNote
);

/**
 * @route   POST /api/notes/:id/favorite
 * @desc    Toggle favorite status
 * @access  Private
 */
router.post(
  '/:id/favorite',
  protect,
  [
    param('id').isMongoId().withMessage('Invalid note ID')
  ],
  validate,
  notesController.toggleFavorite
);

/**
 * @route   GET /api/notes/search/:query
 * @desc    Search notes
 * @access  Private
 */
router.get(
  '/search/:query',
  protect,
  [
    param('query').notEmpty().withMessage('Search query is required')
  ],
  validate,
  notesController.searchNotes
);

module.exports = router;