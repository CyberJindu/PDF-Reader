const PdfImage = require('pdf-image').PDFImage;
const tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Clean up extracted text
 * @param {string} text - Raw extracted text
 * @returns {string} - Cleaned text
 */
function cleanExtractedText(text) {
  return text
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    // Remove control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize line breaks
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove empty lines
    .split('\n')
    .filter(line => line.trim().length > 0)
    .join('\n')
    .trim();
}

/**
 * Fallback OCR using Tesseract with retry logic
 * @param {string} imagePath - Path to image file
 * @param {string} language - Language for OCR
 * @param {number} retries - Number of retry attempts
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} - OCR result
 */
async function performOCRWithRetry(imagePath, language, retries = 3, timeout = 30000) {
  let lastError = null;
  
  // Try specified language first, fallback to English
  const languages = [language, 'eng'];
  const uniqueLanguages = [...new Set(languages)];
  
  for (let lang of uniqueLanguages) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.debug(`OCR attempt ${attempt}/${retries} for ${path.basename(imagePath)} with language ${lang}`);
        
        // Validate image exists and is readable
        const stats = await fs.promises.stat(imagePath);
        if (stats.size === 0) {
          throw new Error('Image file is empty');
        }

        const result = await Promise.race([
          tesseract.recognize(imagePath, lang, {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                // Optional: log progress
              }
            }
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('OCR timeout')), timeout)
          )
        ]);
        
        // Check if result has meaningful text
        if (result.data.text && result.data.text.trim().length > 10) {
          return result;
        }
        
        throw new Error('OCR produced insufficient text');
      } catch (error) {
        lastError = error;
        logger.warn(`OCR attempt ${attempt} with language ${lang} failed: ${error.message}`);
        
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }
  
  throw new Error(`OCR failed after multiple attempts: ${lastError.message}`);
}

/**
 * Extract text from image-based PDF using OCR
 * @param {string} pdfPath - Path to the PDF file
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} - Extracted text and metadata
 */
async function extractTextFromPDF(pdfPath, options = {}) {
  const {
    quality = 100,
    density = 300,
    savePath = path.join(__dirname, '../temp/ocr'),
    language = 'eng',
    maxFileSize = 50 * 1024 * 1024,
    maxRetries = 3,
    timeout = 30000,
    allowedDirectories = []
  } = options;

  try {
    // Validate file exists
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }

    // Validate file size
    const stats = fs.statSync(pdfPath);
    if (stats.size > maxFileSize) {
      throw new Error(`PDF file size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds limit of ${(maxFileSize / 1024 / 1024).toFixed(0)}MB`);
    }

    // Validate path - just check if file exists and is readable
    try {
      await fs.promises.access(pdfPath, fs.constants.R_OK);
    } catch (accessError) {
      throw new Error(`File is not readable: ${accessError.message}`);
    }

    // Ensure temp directory exists
    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, { recursive: true });
    }

    logger.info(`Starting OCR processing for PDF: ${pdfPath} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);

    // Convert PDF to images using pdf-image
    const pdf = new PdfImage(pdfPath, {
      outputDir: savePath,
      convertOptions: {
        '-quality': quality,
        '-density': density,
        '-resize': '1024x1024',
        '-format': 'png'
      }
    });
    
    // Convert all pages to images - returns array of image paths
    const pageResults = await pdf.convertFile();
    
    if (!pageResults || pageResults.length === 0) {
      throw new Error('No pages found in PDF');
    }

    const pageCount = pageResults.length;
    logger.info(`PDF has ${pageCount} pages, processing ONE page at a time (memory-safe mode)`);

    let fullText = '';
    const pageTexts = [];
    let processedPages = 0;

    // Process pages ONE BY ONE (streaming approach)
    for (let i = 0; i < pageCount; i++) {
      const pagePath = pageResults[i];
      const pageNumber = i + 1;
      
      try {
        // Validate the image file
        const imageStats = await fs.promises.stat(pagePath);
        if (imageStats.size === 0) {
          throw new Error('Generated image is empty');
        }
        
        // Update progress
        if (options.onProgress) {
          const progress = Math.round(((i + 1) / pageCount) * 100);
          options.onProgress(progress, `Processing page ${pageNumber} of ${pageCount}`);
        }

        // Perform OCR with retry (ONE page at a time)
        const result = await performOCRWithRetry(
          pagePath,
          language,
          maxRetries,
          timeout
        );

        const pageText = result.data.text || '';
        
        // Store successful result
        pageTexts.push({
          page: pageNumber,
          text: pageText,
          confidence: result.data.confidence || 0,
          success: true
        });

        fullText += pageText + '\n\n';
        processedPages++;

        // Clean up image file immediately after processing
        try {
          if (pagePath && fs.existsSync(pagePath)) {
            fs.unlink(pagePath, (err) => {
              if (err) logger.warn(`Could not delete temp image: ${pagePath}`);
            });
          }
        } catch (cleanupError) {
          logger.warn(`Error during cleanup: ${cleanupError.message}`);
        }

        // Small delay between pages to prevent system overload
        if (i < pageCount - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Update progress after each page
        if (options.onProgress) {
          const progress = Math.min(Math.round(((i + 1) / pageCount) * 100), 100);
          options.onProgress(progress, `Processed ${i + 1}/${pageCount} pages`);
        }

      } catch (pageError) {
        logger.error(`Error processing page ${pageNumber}:`, pageError);
        pageTexts.push({
          page: pageNumber,
          text: '',
          error: pageError.message,
          confidence: 0,
          success: false
        });
        
        // Clean up image file even on error
        try {
          if (pagePath && fs.existsSync(pagePath)) {
            fs.unlink(pagePath, (err) => {
              if (err) logger.warn(`Could not delete temp image: ${pagePath}`);
            });
          }
        } catch (cleanupError) {
          logger.warn(`Error during cleanup: ${cleanupError.message}`);
        }
      }
    }

    // Clean up temp directory asynchronously
    setTimeout(() => {
      try {
        if (fs.existsSync(savePath)) {
          const files = fs.readdirSync(savePath);
          if (files.length === 0) {
            fs.rmdirSync(savePath);
          }
        }
      } catch (cleanupError) {
        logger.warn('Could not clean up OCR temp directory');
      }
    }, 1000);

    // Calculate statistics
    const successfulPages = pageTexts.filter(p => p.success).length;
    const avgConfidence = pageTexts.length > 0 
      ? pageTexts.reduce((sum, p) => sum + (p.confidence || 0), 0) / pageTexts.length
      : 0;

    // Clean up the text
    const cleanedText = cleanExtractedText(fullText);

    // Check if we got enough text
    if (cleanedText.length < 50 && successfulPages < pageCount * 0.5) {
      logger.warn(`Low text extraction quality: ${cleanedText.length} chars from ${successfulPages}/${pageCount} pages`);
    }

    logger.info(`OCR completed: ${successfulPages}/${pageCount} pages, ${cleanedText.length} characters`);

    return {
      text: cleanedText,
      pages: pageCount,
      pageTexts: pageTexts,
      averageConfidence: avgConfidence,
      method: 'ocr',
      wordCount: cleanedText.split(/\s+/).filter(w => w.length > 0).length,
      successfulPages: successfulPages,
      totalPages: pageCount
    };

  } catch (error) {
    logger.error('OCR extraction failed:', error);
    throw new Error(`OCR processing failed: ${error.message}`);
  }
}

module.exports = {
  extractTextFromPDF,
  cleanExtractedText
};
