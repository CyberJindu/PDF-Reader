const Note = require('../models/Note');
const User = require('../models/User');
const pdfProcessor = require('../lib/pdfProcessor');
const gemini = require('../lib/gemini');
const xtts = require('../lib/xtts');
const cloudinary = require('../lib/cloudinary');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');
const { extractTextFromPDF } = require('../lib/ocrProcessor'); 

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

    // Delete files from Cloudinary using the service methods
    if (note.pdfUrl && note.pdfPublicId) {
      try {
        // Use the service's deleteFile method for PDF (raw resource type)
        await cloudinary.deleteFile(note.pdfPublicId, 'raw');
        logger.info(`PDF deleted: ${note.pdfPublicId}`);
      } catch (pdfError) {
        logger.error('Error deleting PDF from Cloudinary:', pdfError);
        // Continue with deletion even if Cloudinary delete fails
      }
    }

    if (note.audioUrl && note.audioPublicId) {
      try {
        // Use the service's deleteFile method for audio (video resource type)
        await cloudinary.deleteFile(note.audioPublicId, 'video');
        logger.info(`Audio deleted: ${note.audioPublicId}`);
      } catch (audioError) {
        logger.error('Error deleting audio from Cloudinary:', audioError);
        // Continue with deletion even if Cloudinary delete fails
      }
    }

    // Delete from database
    await note.deleteOne();

    // Update user stats - decrement totalSummaries
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
  let extractedText = '';
  let extractionMethod = 'text-based';
  let totalPages = 1;

  try {
    // STEP 1: Try to extract text from PDF
    uploadProgress.set(uploadId, {
      status: 'processing',
      progress: 20,
      message: 'Extracting text from PDF...'
    });

    // First attempt: Try regular text extraction
    try {
      const extractedData = await pdfProcessor.extractText(file.path);
      extractedText = extractedData.text || '';
      totalPages = extractedData.pages || 1;
      
      if (extractedText && extractedText.length >= 50) {
        logger.info(`✅ Text-based extraction successful: ${extractedText.length} characters`);
        extractionMethod = 'text-based';
      } else {
        throw new Error('Insufficient text extracted, attempting OCR');
      }
    } catch (textExtractionError) {
      logger.warn('Text extraction failed or insufficient, switching to OCR:', textExtractionError.message);
      
      // STEP 2: Fallback to OCR for image-based PDFs
      uploadProgress.set(uploadId, {
        status: 'ocr-processing',
        progress: 30,
        message: '📷 Processing scanned PDF with OCR... (this may take a moment)'
      });

      try {
        const ocrResult = await extractTextFromPDF(file.path, {
          onProgress: (progress, message) => {
            uploadProgress.set(uploadId, {
              status: 'ocr-processing',
              progress: 30 + (progress * 0.5), // Scale 30% to 80%
              message: `📷 ${message}`
            });
          },
          maxRetries: 3,
          timeout: 60000,
          parallelPages: 3,
          language: 'eng'
        });
        extractedText = ocrResult.text || '';
        totalPages = ocrResult.pages || 1;
        
        if (!extractedText || extractedText.length < 50) {
          throw new Error('OCR extraction failed to produce sufficient text');
        }
        
        extractionMethod = 'ocr-based';
        logger.info(`✅ OCR extraction successful: ${extractedText.length} characters from ${totalPages} pages`);
      } catch (ocrError) {
        logger.error('OCR extraction failed:', ocrError);
        throw new Error(`Could not extract text from PDF. ${ocrError.message}`);
      }
    }

    // Check if we have enough text after all extraction attempts
    if (!extractedText || extractedText.length < 50) {
      throw new Error('Could not extract sufficient text from PDF (minimum 50 characters required)');
    }

    // Update progress with extraction method info
    uploadProgress.set(uploadId, {
      status: 'processing',
      progress: 40,
      message: `✅ ${extractionMethod === 'ocr-based' ? 'OCR' : 'Text'} extraction complete, generating summary...`
    });

    logger.info(`Extracted ${extractedText.length} characters from PDF using ${extractionMethod}`);

    // STEP 3: Generate AI summary
    uploadProgress.set(uploadId, {
      status: 'summarizing',
      progress: 50,
      message: '🤖 Generating AI summary (max 1400 words)...'
    });

    const summary = await gemini.generateSummary(extractedText, 1400);
    logger.info(`Generated summary of ${summary.length} characters`);

    // STEP 4: Generate audio
    uploadProgress.set(uploadId, {
      status: 'generating-audio',
      progress: 70,
      message: '🎵 Creating audio summary...'
    });

    const audioBuffer = await xtts.generateAudio(summary);

    // STEP 5: Upload to Cloudinary
    uploadProgress.set(uploadId, {
      status: 'uploading',
      progress: 85,
      message: '☁️ Saving your files to cloud...'
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

    // Calculate audio duration
    const wordCount = summary.split(/\s+/).length;
    const audioDurationSeconds = Math.ceil(wordCount / 150);
    const minutes = Math.floor(audioDurationSeconds / 60);
    const seconds = audioDurationSeconds % 60;

    // DEBUG: Log all values before creating note
    console.log('=== NOTE CREATION DEBUG ===');
    console.log('User ID:', userId);
    console.log('Upload ID:', uploadId);
    console.log('Title:', file.originalname.replace('.pdf', ''));
    console.log('Extraction Method:', extractionMethod);
    console.log('Pages:', totalPages);
    console.log('Summary length:', summary.length);
    console.log('PDF URL:', pdfUpload.secure_url || pdfUpload.url);
    console.log('Audio URL:', audioUpload.secure_url || audioUpload.url);
    console.log('Audio Duration:', `${minutes}:${seconds.toString().padStart(2, '0')}`);
    console.log('Word Count:', wordCount);
    console.log('===========================');

    // Get URLs
    const pdfUrl = pdfUpload.secure_url || pdfUpload.url;
    const audioUrl = audioUpload.secure_url || audioUpload.url;

    if (!pdfUrl) {
      throw new Error('PDF URL is missing from Cloudinary response');
    }
    if (!audioUrl) {
      throw new Error('Audio URL is missing from Cloudinary response');
    }

    // Get public IDs
    const pdfPublicId = pdfUpload.public_id || 
      (pdfUrl.split('/').pop().split('.')[0]);
    const audioPublicId = audioUpload.public_id || 
      (audioUrl.split('/').pop().split('.')[0]);

    // STEP 6: Save to database
    const note = await Note.create({
      user: userId,
      uploadId,
      title: file.originalname.replace('.pdf', ''),
      summary: summary,
      pages: totalPages,
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
        language: 'en',
        extractionMethod: extractionMethod, // Added to track how text was extracted
        totalPages: totalPages
      },
      source: 'upload'
    });

    console.log('✅ Note created successfully with ID:', note._id);

    // STEP 7: Update user stats
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

    // STEP 8: Clean up temp file
    fs.unlink(file.path, (err) => {
      if (err) logger.error('Error deleting temp file:', err);
    });

    // STEP 9: Mark as completed
    uploadProgress.set(uploadId, {
      status: 'completed',
      progress: 100,
      message: `✅ Processing complete! (${extractionMethod === 'ocr-based' ? 'OCR' : 'Text'} extraction)`,
      noteId: note._id
    });

    // Remove progress after 5 minutes
    setTimeout(() => {
      uploadProgress.delete(uploadId);
    }, 300000);

    logger.info(`PDF processed successfully for user ${userId} using ${extractionMethod}`);
    
  } catch (error) {
    logger.error('PDF processing error:', error);
    
    // Clean up temp file if it exists
    try {
      if (file && file.path && fs.existsSync(file.path)) {
        fs.unlink(file.path, (err) => {
          if (err) logger.error('Error deleting temp file:', err);
        });
      }
    } catch (cleanupError) {
      logger.error('Error during cleanup:', cleanupError);
    }
    
    // Update progress with error
    uploadProgress.set(uploadId, {
      status: 'error',
      progress: 0,
      message: error.message || 'Processing failed'
    });
    
    throw error;
  }
}
