const Note = require('../models/Note');
const User = require('../models/User');
const pdfProcessor = require('../lib/pdfProcessor');
const gemini = require('../lib/gemini');
const xtts = require('../lib/xtts');
const cloudinary = require('../lib/cloudinary');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

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

    if (note.pdfUrl && note.pdfPublicId) {
      try {
        await cloudinary.deleteFile(note.pdfPublicId, 'raw');
        logger.info(`PDF deleted: ${note.pdfPublicId}`);
      } catch (pdfError) {
        logger.error('Error deleting PDF from Cloudinary:', pdfError);
      }
    }

    if (note.audioUrl && note.audioPublicId) {
      try {
        await cloudinary.deleteFile(note.audioPublicId, 'video');
        logger.info(`Audio deleted: ${note.audioPublicId}`);
      } catch (audioError) {
        logger.error('Error deleting audio from Cloudinary:', audioError);
      }
    }

    await note.deleteOne();

    await User.findByIdAndUpdate(userId, {
      $inc: {
        'stats.totalSummaries': -1
      },
      $set: {
        'stats.lastActive': new Date()
      }
    });

    res.json({
      success: true,
      message: 'Note and associated files deleted successfully'
    });
  } catch (error) {
    logger.error('Delete upload error:', error);
    next(error);
  }
};

// Helper function to process PDF
async function processPDF(file, userId, uploadId) {
  try {
    // Step 1: Check if PDF is readable (text-based or image-based)
    uploadProgress.set(uploadId, {
      status: 'processing',
      progress: 15,
      message: 'Analyzing PDF type...'
    });

    const isReadable = await pdfProcessor.isReadable(file.path);
    let summary;
    let pages;
    let wordCount;
    let processingMethod;

    if (isReadable) {
      // TEXT-BASED PATH
      uploadProgress.set(uploadId, {
        status: 'processing',
        progress: 20,
        message: 'Extracting text from PDF...'
      });

      const extractedData = await pdfProcessor.extractText(file.path);
      const extractedText = extractedData.text || '';
      pages = extractedData.pages || 1;

      if (!extractedText || extractedText.length < 50) {
        throw new Error('Could not extract sufficient text from PDF');
      }

      logger.info(`Extracted ${extractedText.length} characters from text-based PDF`);

      uploadProgress.set(uploadId, {
        status: 'summarizing',
        progress: 40,
        message: 'Generating AI summary (max 1400 words)...'
      });

      summary = await gemini.generateSummary(extractedText, 1400);
      processingMethod = 'text';
    } else {
      // IMAGE-BASED PATH
      logger.info('PDF detected as image-based, using Gemini Vision...');

      uploadProgress.set(uploadId, {
        status: 'processing',
        progress: 20,
        message: 'Reading image-based PDF with AI...'
      });

      summary = await gemini.generateSummaryFromPDF(file.path, 1400);
      pages = 1; // Unknown pages for image-based
      processingMethod = 'vision';

      logger.info(`Summary generated from image-based PDF: ${summary.length} characters`);
    }

    wordCount = summary.split(/\s+/).length;

    // Update progress: Generating audio
    uploadProgress.set(uploadId, {
      status: 'generating-audio',
      progress: 70,
      message: 'Creating audio summary...'
    });

    // Generate audio with TTS
    const audioBuffer = await xtts.generateAudio(summary);

    // Update progress: Uploading to Cloudinary
    uploadProgress.set(uploadId, {
      status: 'uploading',
      progress: 85,
      message: 'Saving your files...'
    });

    // Upload PDF to Cloudinary
    const pdfUpload = await cloudinary.uploadFile(file.path, {
      folder: `pdlist/users/${userId}/pdfs`,
      resource_type: 'raw',
      public_id: `${userId}_${Date.now()}_pdf`
    });

    // Upload audio to Cloudinary
    const audioUpload = await cloudinary.uploadAudio(
      audioBuffer, 
      userId, 
      `${userId}_${Date.now()}_audio`
    );

    // Calculate audio duration (approx based on word count)
    const audioDurationSeconds = Math.ceil(wordCount / 150);
    const minutes = Math.floor(audioDurationSeconds / 60);
    const seconds = audioDurationSeconds % 60;

    // DEBUG
    console.log('=== NOTE CREATION DEBUG ===');
    console.log('User ID:', userId);
    console.log('Upload ID:', uploadId);
    console.log('Title:', file.originalname.replace('.pdf', ''));
    console.log('Summary length:', summary.length);
    console.log('Pages:', pages);
    console.log('Processing Method:', processingMethod);
    console.log('PDF URL:', pdfUpload.secure_url || pdfUpload.url);
    console.log('Audio URL:', audioUpload.secure_url || audioUpload.url);
    console.log('Audio Duration:', `${minutes}:${seconds.toString().padStart(2, '0')}`);
    console.log('Word Count:', wordCount);
    console.log('===========================');

    const pdfUrl = pdfUpload.secure_url || pdfUpload.url;
    const audioUrl = audioUpload.secure_url || audioUpload.url;

    if (!pdfUrl) {
      throw new Error('PDF URL is missing from Cloudinary response');
    }
    if (!audioUrl) {
      throw new Error('Audio URL is missing from Cloudinary response');
    }

    const pdfPublicId = pdfUpload.public_id || 
      (pdfUrl.split('/').pop().split('.')[0]);
    const audioPublicId = audioUpload.public_id || 
      (audioUrl.split('/').pop().split('.')[0]);

    // Save to database
    const note = await Note.create({
      user: userId,
      uploadId,
      title: file.originalname.replace('.pdf', ''),
      summary: summary,
      pages: pages,
      tags: [],
      category: 'uncategorized',
      isFavorite: false,
      isArchived: false,
      pdfUrl: pdfUrl,
      pdfPublicId: pdfPublicId,
      audioUrl: audioUrl,
      audioPublicId: audioPublicId,
      audioDuration: `${minutes}:${seconds.toString().padStart(2, '0')}`,
      audioSize: audioUpload.bytes || audioBuffer.length,
      plays: 0,
      downloads: 0,
      rating: 0,
      metadata: {
        originalName: file.originalname,
        fileSize: file.size,
        wordCount: wordCount,
        characterCount: summary.length,
        processingTime: Date.now(),
        modelUsed: 'gemini-2.5-flash',
        processingMethod: processingMethod,
        language: 'en'
      },
      source: 'upload'
    });

    console.log('✅ Note created successfully with ID:', note._id);

    await User.findByIdAndUpdate(userId, {
      $inc: {
        'stats.totalUploads': 1,
        'stats.totalSummaries': 1
      },
      $set: {
        'stats.lastActive': new Date()
      }
    });
    console.log('✅ User stats updated - totalSummaries incremented');

    // Clean up temp file
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

    logger.info(`PDF processed successfully for user ${userId} (${processingMethod})`);
  } catch (error) {
    logger.error('PDF processing error:', error);
    uploadProgress.set(uploadId, {
      status: 'error',
      progress: 0,
      message: error.message || 'Processing failed'
    });
    throw error;
  }
}
