const Note = require('../models/Note');
const User = require('../models/User');
const pdfProcessor = require('../lib/pdfProcessor');
const gemini = require('../lib/gemini');
const xtts = require('../lib/xtts');
const cloudinary = require('../lib/cloudinary');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');
// const { extractTextFromPDF } = require('../lib/ocrProcessor'); // ❌ REMOVED FOR TESTING

// Track upload progress (in production, use Redis)
const uploadProgress = new Map();

/**
 * @desc    Upload and process PDF
 * @route   POST /api/upload/pdf
 * @access  Private
 */
exports.uploadPDF = async (req, res, next) => {
  console.log('📤 [uploadPDF] Called');
  console.log('📄 [uploadPDF] File:', req.file ? req.file.originalname : 'No file');
  console.log('👤 [uploadPDF] User ID:', req.user ? req.user.id : 'No user');
  
  try {
    if (!req.file) {
      console.log('❌ [uploadPDF] No file uploaded');
      return res.status(400).json({
        success: false,
        message: 'Please upload a PDF file'
      });
    }

    const userId = req.user.id;
    const file = req.file;
    
    console.log(`📁 [uploadPDF] File path: ${file.path}`);
    console.log(`📏 [uploadPDF] File size: ${file.size} bytes`);
    
    // Initialize progress
    const uploadId = `${userId}_${Date.now()}`;
    console.log(`🆔 [uploadPDF] Generated uploadId: ${uploadId}`);
    
    uploadProgress.set(uploadId, {
      status: 'uploaded',
      progress: 10,
      message: 'File uploaded, starting processing...'
    });
    console.log(`✅ [uploadPDF] Progress initialized for ${uploadId}`);

    // Start processing asynchronously
    console.log(`🚀 [uploadPDF] Starting async processPDF for ${uploadId}`);
    processPDF(file, userId, uploadId).catch(error => {
      console.log(`❌ [uploadPDF] processPDF error for ${uploadId}:`, error.message);
      logger.error('PDF processing error:', error);
      uploadProgress.set(uploadId, {
        status: 'error',
        progress: 0,
        message: error.message || 'Processing failed'
      });
    });

    console.log(`✅ [uploadPDF] Returning 202 response for ${uploadId}`);
    res.status(202).json({
      success: true,
      message: 'PDF upload successful, processing started',
      uploadId,
      status: 'processing'
    });
  } catch (error) {
    console.log(`❌ [uploadPDF] Catch block error:`, error.message);
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
  console.log(`📊 [getUploadStatus] Called for ID: ${id}`);
  
  const status = uploadProgress.get(id);
  console.log(`📊 [getUploadStatus] Status from Map:`, status || 'Not found');

  if (!status) {
    console.log(`🔍 [getUploadStatus] Checking database for uploadId: ${id}`);
    const note = await Note.findOne({ uploadId: id });
    if (note) {
      console.log(`✅ [getUploadStatus] Found completed note: ${note._id}`);
      return res.json({
        status: 'completed',
        progress: 100,
        message: 'Processing complete',
        noteId: note._id
      });
    }
    
    console.log(`❌ [getUploadStatus] Upload not found in Map or DB for ID: ${id}`);
    return res.status(404).json({
      success: false,
      message: 'Upload not found'
    });
  }

  console.log(`✅ [getUploadStatus] Returning status for ${id}: ${status.status}`);
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
  console.log(`📋 [getUserUploads] Called for user: ${req.user.id}`);
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
    console.log(`✅ [getUserUploads] Found ${notes.length} notes (total: ${total})`);

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
    console.log(`❌ [getUserUploads] Error:`, error.message);
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
  console.log(`📄 [getUpload] Called for ID: ${req.params.id}`);
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const note = await Note.findOne({ _id: id, user: userId });

    if (!note) {
      console.log(`❌ [getUpload] Note not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }

    console.log(`✅ [getUpload] Found note: ${note._id}`);
    res.json({
      success: true,
      data: note
    });
  } catch (error) {
    console.log(`❌ [getUpload] Error:`, error.message);
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
  console.log(`🗑️ [deleteUpload] Called for ID: ${req.params.id}`);
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const note = await Note.findOne({ _id: id, user: userId });

    if (!note) {
      console.log(`❌ [deleteUpload] Note not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Note not found'
      });
    }

    console.log(`🗑️ [deleteUpload] Deleting note: ${note._id}`);

    // Delete files from Cloudinary using the service methods
    if (note.pdfUrl && note.pdfPublicId) {
      try {
        // Use the service's deleteFile method for PDF (raw resource type)
        await cloudinary.deleteFile(note.pdfPublicId, 'raw');
        console.log(`✅ [deleteUpload] PDF deleted: ${note.pdfPublicId}`);
        logger.info(`PDF deleted: ${note.pdfPublicId}`);
      } catch (pdfError) {
        console.log(`⚠️ [deleteUpload] Error deleting PDF:`, pdfError.message);
        logger.error('Error deleting PDF from Cloudinary:', pdfError);
        // Continue with deletion even if Cloudinary delete fails
      }
    }

    if (note.audioUrl && note.audioPublicId) {
      try {
        // Use the service's deleteFile method for audio (video resource type)
        await cloudinary.deleteFile(note.audioPublicId, 'video');
        console.log(`✅ [deleteUpload] Audio deleted: ${note.audioPublicId}`);
        logger.info(`Audio deleted: ${note.audioPublicId}`);
      } catch (audioError) {
        console.log(`⚠️ [deleteUpload] Error deleting audio:`, audioError.message);
        logger.error('Error deleting audio from Cloudinary:', audioError);
        // Continue with deletion even if Cloudinary delete fails
      }
    }

    // Delete from database
    await note.deleteOne();
    console.log(`✅ [deleteUpload] Note deleted from DB`);

    // Update user stats - decrement totalSummaries
    await User.findByIdAndUpdate(userId, {
      $inc: {
        'stats.totalSummaries': -1
      },
      $set: {
        'stats.lastActive': new Date()
      }
    });
    console.log(`✅ [deleteUpload] User stats updated`);

    res.json({
      success: true,
      message: 'Note and associated files deleted successfully'
    });
  } catch (error) {
    console.log(`❌ [deleteUpload] Error:`, error.message);
    logger.error('Delete upload error:', error);
    next(error);
  }
};

// Helper function to process PDF
async function processPDF(file, userId, uploadId) {
  console.log(`🔄 [processPDF] Starting for ${uploadId}`);
  console.log(`📄 [processPDF] File: ${file.originalname}, Path: ${file.path}`);
  
  let extractedText = '';
  let extractionMethod = 'text-based';
  let totalPages = 1;

  try {
    // STEP 1: Try to extract text from PDF
    console.log(`📝 [processPDF] Step 1: Extracting text from PDF`);
    uploadProgress.set(uploadId, {
      status: 'processing',
      progress: 20,
      message: 'Extracting text from PDF...'
    });

    // First attempt: Try regular text extraction
    try {
      console.log(`🔍 [processPDF] Attempting text-based extraction`);
      const extractedData = await pdfProcessor.extractText(file.path);
      extractedText = extractedData.text || '';
      totalPages = extractedData.pages || 1;
      console.log(`📊 [processPDF] Text extraction result: ${extractedText.length} chars, ${totalPages} pages`);
      
      if (extractedText && extractedText.length >= 50) {
        console.log(`✅ [processPDF] Text-based extraction successful`);
        logger.info(`✅ Text-based extraction successful: ${extractedText.length} characters`);
        extractionMethod = 'text-based';
      } else {
        console.log(`⚠️ [processPDF] Insufficient text (${extractedText.length} chars), skipping OCR (TEST MODE)`);
        throw new Error('Insufficient text extracted (OCR disabled for testing)');
      }
    } catch (textExtractionError) {
      console.log(`⚠️ [processPDF] Text extraction failed:`, textExtractionError.message);
      logger.warn('Text extraction failed or insufficient:', textExtractionError.message);
      
      // STEP 2: Skip OCR - TEST MODE
      console.log(`🚫 [processPDF] OCR is DISABLED for testing - throwing error to check if controller works`);
      throw new Error(`Text extraction failed: ${textExtractionError.message} (OCR temporarily disabled)`);
    }

    // Check if we have enough text after all extraction attempts
    if (!extractedText || extractedText.length < 50) {
      console.log(`❌ [processPDF] Final text insufficient: ${extractedText ? extractedText.length : 0} chars`);
      throw new Error('Could not extract sufficient text from PDF (minimum 50 characters required)');
    }

    console.log(`✅ [processPDF] Text extraction complete: ${extractedText.length} chars using ${extractionMethod}`);

    // Update progress with extraction method info
    uploadProgress.set(uploadId, {
      status: 'processing',
      progress: 40,
      message: `✅ ${extractionMethod === 'ocr-based' ? 'OCR' : 'Text'} extraction complete, generating summary...`
    });

    logger.info(`Extracted ${extractedText.length} characters from PDF using ${extractionMethod}`);

    // STEP 3: Generate AI summary
    console.log(`🤖 [processPDF] Step 3: Generating AI summary`);
    uploadProgress.set(uploadId, {
      status: 'summarizing',
      progress: 50,
      message: '🤖 Generating AI summary (max 1400 words)...'
    });

    const summary = await gemini.generateSummary(extractedText, 1400);
    console.log(`📊 [processPDF] Summary generated: ${summary.length} chars`);
    logger.info(`Generated summary of ${summary.length} characters`);

    // STEP 4: Generate audio
    console.log(`🎵 [processPDF] Step 4: Generating audio`);
    uploadProgress.set(uploadId, {
      status: 'generating-audio',
      progress: 70,
      message: '🎵 Creating audio summary...'
    });

    const audioBuffer = await xtts.generateAudio(summary);
    console.log(`📊 [processPDF] Audio generated: ${audioBuffer.length} bytes`);

    // STEP 5: Upload to Cloudinary
    console.log(`☁️ [processPDF] Step 5: Uploading to Cloudinary`);
    uploadProgress.set(uploadId, {
      status: 'uploading',
      progress: 85,
      message: '☁️ Saving your files to cloud...'
    });

    // Upload PDF to Cloudinary
    console.log(`📄 [processPDF] Uploading PDF to Cloudinary`);
    const pdfUpload = await cloudinary.uploadFile(file.path, {
      folder: `pdlist/users/${userId}/pdfs`,
      resource_type: 'raw',
      public_id: `${userId}_${Date.now()}_pdf`
    });
    console.log(`✅ [processPDF] PDF uploaded: ${pdfUpload.secure_url}`);

    // Upload audio to Cloudinary
    console.log(`🎵 [processPDF] Uploading audio to Cloudinary`);
    const audioUpload = await cloudinary.uploadAudio(
      audioBuffer, 
      userId, 
      `${userId}_${Date.now()}_audio`
    );
    console.log(`✅ [processPDF] Audio uploaded: ${audioUpload.secure_url}`);

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
      console.log(`❌ [processPDF] PDF URL missing`);
      throw new Error('PDF URL is missing from Cloudinary response');
    }
    if (!audioUrl) {
      console.log(`❌ [processPDF] Audio URL missing`);
      throw new Error('Audio URL is missing from Cloudinary response');
    }

    // Get public IDs
    const pdfPublicId = pdfUpload.public_id || 
      (pdfUrl.split('/').pop().split('.')[0]);
    const audioPublicId = audioUpload.public_id || 
      (audioUrl.split('/').pop().split('.')[0]);

    // STEP 6: Save to database
    console.log(`💾 [processPDF] Step 6: Saving to database`);
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
        extractionMethod: extractionMethod,
        totalPages: totalPages
      },
      source: 'upload'
    });

    console.log(`✅ [processPDF] Note created with ID: ${note._id}`);

    // STEP 7: Update user stats
    console.log(`📊 [processPDF] Step 7: Updating user stats`);
    await User.findByIdAndUpdate(userId, {
      $inc: {
        'stats.totalUploads': 1,
        'stats.totalSummaries': 1
      },
      $set: {
        'stats.lastActive': new Date()
      }
    });
    console.log(`✅ [processPDF] User stats updated`);

    // STEP 8: Clean up temp file
    console.log(`🗑️ [processPDF] Step 8: Cleaning up temp file: ${file.path}`);
    fs.unlink(file.path, (err) => {
      if (err) {
        console.log(`⚠️ [processPDF] Error deleting temp file:`, err);
        logger.error('Error deleting temp file:', err);
      } else {
        console.log(`✅ [processPDF] Temp file deleted`);
      }
    });

    // STEP 9: Mark as completed
    console.log(`✅ [processPDF] Step 9: Marking as completed`);
    uploadProgress.set(uploadId, {
      status: 'completed',
      progress: 100,
      message: `✅ Processing complete! (${extractionMethod === 'ocr-based' ? 'OCR' : 'Text'} extraction)`,
      noteId: note._id
    });

    // Remove progress after 5 minutes
    setTimeout(() => {
      console.log(`🗑️ [processPDF] Removing progress from Map for ${uploadId}`);
      uploadProgress.delete(uploadId);
    }, 300000);

    console.log(`✅ [processPDF] Processing completed successfully for ${uploadId}`);
    logger.info(`PDF processed successfully for user ${userId} using ${extractionMethod}`);
    
  } catch (error) {
    console.log(`❌ [processPDF] ERROR: ${error.message}`);
    console.log(`📚 [processPDF] Stack:`, error.stack);
    logger.error('PDF processing error:', error);
    
    // Clean up temp file if it exists
    try {
      if (file && file.path && fs.existsSync(file.path)) {
        console.log(`🗑️ [processPDF] Cleaning up temp file on error: ${file.path}`);
        fs.unlink(file.path, (err) => {
          if (err) console.log(`⚠️ [processPDF] Error deleting temp file:`, err);
        });
      }
    } catch (cleanupError) {
      console.log(`⚠️ [processPDF] Cleanup error:`, cleanupError);
      logger.error('Error during cleanup:', cleanupError);
    }
    
    // Update progress with error
    console.log(`❌ [processPDF] Setting error status for ${uploadId}`);
    uploadProgress.set(uploadId, {
      status: 'error',
      progress: 0,
      message: error.message || 'Processing failed'
    });
    
    throw error;
  }
}
