const Note = require('../models/Note');
const logger = require('../utils/logger');

/**
 * @desc    Get all user notes
 * @route   GET /api/notes
 * @access  Private
 */
exports.getAllNotes = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sort = '-createdAt', filter = 'all', page = 1, limit = 12 } = req.query;

    let query = { user: userId };
    
    // Apply filters
    if (filter === 'favorites') {
      query.isFavorite = true;
    } else if (filter === 'recent') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      query.createdAt = { $gte: sevenDaysAgo };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const notes = await Note.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Note.countDocuments(query);

    res.json({
      success: true,
      data: notes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error('Get all notes error:', error);
    next(error);
  }
};

/**
 * @desc    Get single note by ID
 * @route   GET /api/notes/:id
 * @access  Private
 */
exports.getNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const note = await Note.findOne({ _id: id, user: userId });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }

    // Increment play count (for analytics)
    note.plays = (note.plays || 0) + 1;
    await note.save();

    res.json({
      success: true,
      data: note
    });
  } catch (error) {
    logger.error('Get note error:', error);
    next(error);
  }
};

/**
 * @desc    Update note
 * @route   PATCH /api/notes/:id
 * @access  Private
 */
exports.updateNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    // Allowed updates
    const allowedUpdates = ['title', 'tags', 'summary', 'isFavorite'];
    const updateKeys = Object.keys(updates);
    
    // Filter only allowed updates
    const validUpdates = {};
    updateKeys.forEach(key => {
      if (allowedUpdates.includes(key)) {
        validUpdates[key] = updates[key];
      }
    });

    if (Object.keys(validUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid updates provided'
      });
    }

    const note = await Note.findOneAndUpdate(
      { _id: id, user: userId },
      validUpdates,
      { new: true, runValidators: true }
    );

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }

    res.json({
      success: true,
      message: 'Note updated successfully',
      data: note
    });
  } catch (error) {
    logger.error('Update note error:', error);
    next(error);
  }
};

/**
 * @desc    Delete note
 * @route   DELETE /api/notes/:id
 * @access  Private
 */
exports.deleteNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const note = await Note.findOne({ _id: id, user: userId });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }

    // Delete from Cloudinary (handled in uploadController delete)
    // Here we just remove from database

    await note.deleteOne();

    res.json({
      success: true,
      message: 'Note deleted successfully'
    });
  } catch (error) {
    logger.error('Delete note error:', error);
    next(error);
  }
};

/**
 * @desc    Toggle favorite status
 * @route   POST /api/notes/:id/favorite
 * @access  Private
 */
exports.toggleFavorite = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const note = await Note.findOne({ _id: id, user: userId });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }

    note.isFavorite = !note.isFavorite;
    await note.save();

    res.json({
      success: true,
      message: note.isFavorite ? 'Added to favorites' : 'Removed from favorites',
      isFavorite: note.isFavorite
    });
  } catch (error) {
    logger.error('Toggle favorite error:', error);
    next(error);
  }
};

/**
 * @desc    Search notes
 * @route   GET /api/notes/search/:query
 * @access  Private
 */
exports.searchNotes = async (req, res, next) => {
  try {
    const { query } = req.params;
    const userId = req.user.id;

    const notes = await Note.find({
      user: userId,
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { summary: { $regex: query, $options: 'i' } },
        { tags: { $in: [new RegExp(query, 'i')] } }
      ]
    }).sort('-createdAt').limit(20);

    res.json({
      success: true,
      data: notes,
      count: notes.length
    });
  } catch (error) {
    logger.error('Search notes error:', error);
    next(error);
  }
};

/**
 * @desc    Get notes by tag
 * @route   GET /api/notes/tag/:tag
 * @access  Private
 */
exports.getNotesByTag = async (req, res, next) => {
  try {
    const { tag } = req.params;
    const userId = req.user.id;

    const notes = await Note.find({
      user: userId,
      tags: { $in: [tag] }
    }).sort('-createdAt');

    res.json({
      success: true,
      data: notes,
      count: notes.length
    });
  } catch (error) {
    logger.error('Get notes by tag error:', error);
    next(error);
  }
};

/**
 * @desc    Get all unique tags for user
 * @route   GET /api/notes/tags/all
 * @access  Private
 */
exports.getAllTags = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const notes = await Note.find({ user: userId }).select('tags');
    
    // Extract unique tags
    const tags = [...new Set(notes.flatMap(note => note.tags))].sort();

    res.json({
      success: true,
      data: tags
    });
  } catch (error) {
    logger.error('Get all tags error:', error);
    next(error);
  }
};