const express = require('express');
const { param, body } = require('express-validator');
const router = express.Router();

// Import controller
const notesController = require('../controllers/notesController');

// Import middleware
const { protect, requirePremium, checkAudioPlayLimit } = require('../middleware/auth');
const { validate } = require('../middleware/validator');

/**
 * @route   GET /api/notes
 * @desc    Get all user notes (summaries)
 * @access  Private
 */
router.get('/', protect, notesController.getAllNotes);

/**
 * @route   GET /api/notes/tags/all
 * @desc    Get all unique tags for user
 * @access  Private
 */
router.get('/tags/all', protect, notesController.getAllTags);

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

/**
 * @route   GET /api/notes/tag/:tag
 * @desc    Get notes by tag
 * @access  Private
 */
router.get('/tag/:tag', protect, notesController.getNotesByTag);

/**
 * @route   GET /api/notes/:id
 * @desc    Get single note by ID (full summary — premium only)
 * @access  Private
 */
router.get(
  '/:id',
  protect,
  requirePremium,
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
 * @route   POST /api/notes/:id/play
 * @desc    Track audio play (free: once, premium: unlimited)
 * @access  Private
 */
router.post('/:id/play', protect, checkAudioPlayLimit, notesController.incrementPlay);

/**
 * @route   POST /api/notes/:id/download
 * @desc    Track download (premium only)
 * @access  Private
 */
router.post('/:id/download', protect, requirePremium, notesController.incrementDownload);

module.exports = router;
