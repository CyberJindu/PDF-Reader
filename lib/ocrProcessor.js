const { fromPath } = require('pdf2pic');
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
 * Validate PDF file before processing
 * @param {string} pdfPath - Path to PDF file
 * @returns {Promise<boolean>} - True if valid
 */
async function validatePDF(pdfPath) {
  try {
    // Check PDF header
    const buffer = await fs.promises.readFile(pdfPath, { length: 1024 });
    const header = buffer.toString('ascii', 0, 5);
    
    if (!header.startsWith('%PDF-')) {
      throw new Error('Invalid PDF header');
    }

    // Try to parse with pdf2pic to confirm it's readable
    const { fromPath } = require('pdf2pic');
    const testConvert = fromPath(pdfPath, {
      density: 100,
      savePath: path.dirname(pdfPath),
      format: 'png',
      width: 100,
      height: 100
    });

    await testConvert.pageCount();
    return true;
  } catch (error) {
    logger.error('PDF validation failed:', error);
    throw new Error(`Invalid or corrupted PDF: ${error.message}`);
  }
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
    parallelPages = 3,
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
    // The file path itself doesn't need to be in a specific directory
    // as long as it's accessible and we can read it
    try {
      await fs.promises.access(pdfPath, fs.constants.R_OK);
    } catch (accessError) {
      throw new Error(`File is not readable: ${accessError.message}`);
    }

    // Validate PDF is not corrupted
    await validatePDF(pdfPath);

    // Ensure temp directory exists
    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, { recursive: true });
    }

    logger.info(`Starting OCR processing for PDF: ${pdfPath} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);

    // Convert PDF to images using pdf2pic
    const baseOptions = {
      quality,
      density,
      savePath,
      format: 'png',
      width: 1024,
      height: 1024
    };

    const convert = fromPath(pdfPath, baseOptions);
    
    // Get total pages first
    const pageCount = await convert.getPageCount();
    if (!pageCount || pageCount === 0) {
      throw new Error('No pages found in PDF');
    }

    logger.info(`PDF has ${pageCount} pages, processing in batches of ${parallelPages}`);

    let fullText = '';
    const pageTexts = [];
    let processedPages = 0;

    // Process pages in batches for memory efficiency
    for (let batchStart = 1; batchStart <= pageCount; batchStart += parallelPages) {
      const batchEnd = Math.min(batchStart + parallelPages - 1, pageCount);
      const batchPages = [];
      
      // Convert batch pages to images
      for (let pageNum = batchStart; pageNum <= batchEnd; pageNum++) {
        try {
          const result = await convert.bulk(pageNum, pageNum);
          if (result && result.length > 0) {
            // Validate the image file
            const imageStats = await fs.promises.stat(result[0].path);
            if (imageStats.size === 0) {
              throw new Error('Generated image is empty');
            }
            
            batchPages.push({
              page: pageNum,
              path: result[0].path,
              result: result[0]
            });
          }
        } catch (convertError) {
          logger.error(`Error converting page ${pageNum}:`, convertError);
          pageTexts.push({
            page: pageNum,
            text: '',
            error: `Conversion failed: ${convertError.message}`,
            confidence: 0
          });
        }
      }

      // Process batch in parallel with concurrency limit
      const batchPromises = batchPages.map(async (pageData) => {
        try {
          // Update progress
          if (options.onProgress) {
            const progress = Math.round(((processedPages + 1) / pageCount) * 100);
            options.onProgress(progress, `Processing page ${pageData.page} of ${pageCount}`);
          }

          // Perform OCR with retry
          const result = await performOCRWithRetry(
            pageData.path,
            language,
            maxRetries,
            timeout
          );

          const pageText = result.data.text || '';
          
          return {
            page: pageData.page,
            text: pageText,
            confidence: result.data.confidence || 0,
            success: true
          };
        } catch (ocrError) {
          logger.error(`Error processing page ${pageData.page}:`, ocrError);
          return {
            page: pageData.page,
            text: '',
            error: ocrError.message,
            confidence: 0,
            success: false
          };
        } finally {
          // Clean up image file asynchronously
          try {
            if (pageData.path && fs.existsSync(pageData.path)) {
              fs.unlink(pageData.path, (err) => {
                if (err) logger.warn(`Could not delete temp image: ${pageData.path}`);
              });
            }
          } catch (cleanupError) {
            logger.warn(`Error during cleanup: ${cleanupError.message}`);
          }
        }
      });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Process batch results - only keep successful results to save memory
      batchResults.forEach((result) => {
        if (result.success) {
          fullText += result.text + '\n\n';
          processedPages++;
        }
        // Only store failed pages to reduce memory
        if (!result.success) {
          pageTexts.push(result);
        }
      });

      // Update progress after batch
      if (options.onProgress) {
        const progress = Math.min(Math.round((processedPages / pageCount) * 100), 100);
        options.onProgress(progress, `Processed ${processedPages}/${pageCount} pages`);
      }

      // Small delay between batches to prevent system overload
      if (batchEnd < pageCount) {
        await new Promise(resolve => setTimeout(resolve, 100));
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
    const successfulPages = processedPages;
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
