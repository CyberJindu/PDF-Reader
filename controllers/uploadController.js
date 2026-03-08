const Note = require('../models/Note');
const pdfProcessor = require('../lib/pdfProcessor');
const gemini = require('../lib/gemini');
const xtts = require('../lib/xtts');
const cloudinary = require('../lib/cloudinary');
const logger = require('../utils/logger');
const path = require('path');

// Track upload progress (in production, use Redis)
const uploadProgress = new Map();

/**
 * @desc    Upload and process PDF
 * @route   POST /api/upload/pdf
 * @access  Private
 */
exports.uploadPDF = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a PDF file'
      });
    }

    const userId = req.user.id;
    const file = req.file;
    
    // Initialize progress
    const uploadId = `${userId}_${Date.now()}`;
    uploadProgress.set(uploadId, {
      status: 'uploaded',
      progress: 10,
      message: 'File uploaded, starting processing...'
    });

    // Start processing asynchronously
    processPDF(file, userId, uploadId).catch(error => {
      logger.error('PDF processing error:', error);
      uploadProgress.set(uploadId, {
        status: 'error',
        progress: 0,
        message: error.message || 'Processing failed'
      });
    });

    res.status(202).json({
      success: true,
      message: 'PDF upload successful, processing started',
      uploadId,
      status: 'processing'
    });
  } catch (error) {
    logger.error('Upload error:', error);
    next(error);
  }
};

/**
 * @desc    Get upload processing status
 * @route   GET /api/upload/status/:id
 * @access  Private
 */
exports.getUploadStatus = async (req, res) => {
  const { id } = req.params;
  const status = uploadProgress.get(id);

  if (!status) {
    // Check if it's a completed upload (in database)
    const note = await Note.findOne({ uploadId: id });
    if (note) {
      return res.json({
        status: 'completed',
        progress: 100,
        message: 'Processing complete',
        noteId: note._id
      });
    }
    
    return res.status(404).json({
      success: false,
      message: 'Upload not found'
    });
  }

  res.json({
    success: true,
    ...status
  });
};

/**
 * @desc    Get all user uploads
 * @route   GET /api/uploads
 * @access  Private
 */
exports.getUserUploads = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const notes = await Note.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Note.countDocuments({ user: userId });

    res.json({
      success: true,
      data: notes,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Get user uploads error:', error);
    next(error);
  }
};

/**
 * @desc    Get single upload by ID
 * @route   GET /api/upload/:id
 * @access  Private
 */
exports.getUpload = async (req, res, next) => {
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

    res.json({
      success: true,
      data: note
    });
  } catch (error) {
    logger.error('Get upload error:', error);
    next(error);
  }
};

/**
 * @desc    Delete upload
 * @route   DELETE /api/upload/:id
 * @access  Private
 */
exports.deleteUpload = async (req, res, next) => {
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

    // Delete files from Cloudinary
    if (note.pdfUrl) {
      const pdfPublicId = note.pdfUrl.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(`pdlist/pdfs/${pdfPublicId}`, { resource_type: 'raw' });
    }

    if (note.audioUrl) {
      const audioPublicId = note.audioUrl.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(`pdlist/audio/${audioPublicId}`, { resource_type: 'video' });
    }

    // Delete from database
    await note.deleteOne();

    res.json({
      success: true,
      message: 'Note deleted successfully'
    });
  } catch (error) {
    logger.error('Delete upload error:', error);
    next(error);
  }
};

// Helper function to process PDF
async function processPDF(file, userId, uploadId) {
  try {
    // Update progress: Extracting text
    uploadProgress.set(uploadId, {
      status: 'processing',
      progress: 20,
      message: 'Extracting text from PDF...'
    });

    // Extract text from PDF
    const extractedText = await pdfProcessor.extractText(file.path);
    
    if (!extractedText || extractedText.length < 50) {
      throw new Error('Could not extract sufficient text from PDF');
    }

    // Update progress: Generating summary
    uploadProgress.set(uploadId, {
      status: 'summarizing',
      progress: 40,
      message: 'Generating AI summary (max 1400 words)...'
    });

    // Extract the actual text from the returned object
const extractedTextContent = extractedText.text || extractedText;
// Generate summary with Gemini (max 1400 words)
const summary = await gemini.generateSummary(extractedTextContent, 1400);

    // Update progress: Generating audio
    uploadProgress.set(uploadId, {
      status: 'generating-audio',
      progress: 70,
      message: 'Creating audio summary...'
    });

    // Generate audio with XTTS
    const audioBuffer = await xtts.generateAudio(summary);

    // Update progress: Uploading to Cloudinary
    uploadProgress.set(uploadId, {
      status: 'uploading',
      progress: 85,
      message: 'Saving your files...'
    });

    // Upload PDF to Cloudinary
    const pdfUpload = await cloudinary.uploader.upload(file.path, {
      folder: 'pdlist/pdfs',
      resource_type: 'raw',
      public_id: `${userId}_${Date.now()}_pdf`
    });

    // Upload audio to Cloudinary
    const audioUpload = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({
        folder: 'pdlist/audio',
        resource_type: 'video',
        public_id: `${userId}_${Date.now()}_audio`,
        format: 'mp3'
      }, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }).end(audioBuffer);
    });

    // Calculate audio duration (approx based on word count)
    const wordCount = summary.split(' ').length;
    const audioDuration = Math.ceil(wordCount / 150); // 150 words per minute average

    // Save to database
    const note = await Note.create({
      user: userId,
      uploadId,
      title: file.originalname.replace('.pdf', ''),
      summary,
      pages: extractedText.pages || Math.ceil(extractedText.length / 3000),
      tags: [], // Auto-tagging could be added later
      pdfUrl: pdfUpload.secure_url,
      audioUrl: audioUpload.secure_url,
      audioDuration: `${Math.floor(audioDuration / 60)}:${(audioDuration % 60).toString().padStart(2, '0')}`,
      metadata: {
        originalName: file.originalname,
        fileSize: file.size,
        wordCount: extractedText.split(' ').length,
        processingTime: Date.now()
      }
    });

    // Clean up temp file
    const fs = require('fs');
    fs.unlink(file.path, (err) => {
      if (err) logger.error('Error deleting temp file:', err);
    });

    // Update progress as completed
    uploadProgress.set(uploadId, {
      status: 'completed',
      progress: 100,
      message: 'Processing complete!',
      noteId: note._id
    });

    // Remove progress after 5 minutes
    setTimeout(() => {
      uploadProgress.delete(uploadId);
    }, 300000);

    logger.info(`PDF processed successfully for user ${userId}`);
  } catch (error) {
    logger.error('PDF processing error:', error);
    throw error;
  }

}
