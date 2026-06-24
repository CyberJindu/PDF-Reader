const pdf = require('pdf-parse');
const fs = require('fs');
const logger = require('../utils/logger');

/**
 * PDF processing utility
 * Handles text extraction from PDF files
 */
class PDFProcessor {
  constructor() {
    this.maxFileSize = process.env.MAX_FILE_SIZE || 50 * 1024 * 1024; // 50MB default
    console.log(`📄 [PDFProcessor] Initialized with maxFileSize: ${this.maxFileSize}`);
  }

  /**
   * Extract text from PDF file
   * @param {string} filePath - Path to PDF file
   * @param {Object} options - Extraction options
   */
  async extractText(filePath, options = {}) {
    console.log(`📊 Memory before: ${process.memoryUsage().heapUsed / 1024 / 1024} MB`);
    console.log(`📄 [extractText] Called with filePath: ${filePath}`);
    console.log(`📄 [extractText] Options:`, options);
    
    try {
      logger.info(`Extracting text from PDF: ${filePath}`);
      console.log(`📊 [extractText] Starting extraction process...`);

      // Check file size
      console.log(`📏 [extractText] Checking file size...`);
      const stats = fs.statSync(filePath);
      console.log(`📏 [extractText] File size: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
      
      if (stats.size > this.maxFileSize) {
        console.log(`❌ [extractText] File size exceeds limit: ${stats.size} > ${this.maxFileSize}`);
        throw new Error(`File size exceeds limit: ${stats.size} bytes`);
      }
      console.log(`✅ [extractText] File size check passed`);

      // Read PDF file
      console.log(`📖 [extractText] Reading PDF file...`);
      const dataBuffer = fs.readFileSync(filePath);
      console.log(`✅ [extractText] File read successfully, buffer size: ${dataBuffer.length} bytes`);

      // Parse PDF with options
      console.log(`🔍 [extractText] Parsing PDF with pdf-parse...`);
      console.log(`📊 [extractText] Options:`, { 
        max: options.maxPages || 0, 
        version: 'v2.0.550' 
      });
      
      const pdfData = await pdf(dataBuffer, {
        max: options.maxPages || 0, // 0 = no limit
        pagerender: this.customPageRenderer(options),
        version: 'v2.0.550'
      });
      
      console.log(`✅ [extractText] PDF parsed successfully`);
      console.log(`📊 [extractText] PDF data:`, {
        numpages: pdfData.numpages,
        textLength: pdfData.text ? pdfData.text.length : 0,
        info: pdfData.info ? 'Present' : 'Missing',
        metadata: pdfData.metadata ? 'Present' : 'Missing',
        version: pdfData.version
      });

      // Process extracted text
      console.log(`🧹 [extractText] Processing extracted text...`);
      const processedText = this.processText(pdfData.text, options);
      console.log(`✅ [extractText] Text processed, length: ${processedText.length} characters`);

      // Extract metadata
      console.log(`📊 [extractText] Extracting metadata...`);
      const metadata = {
        pages: pdfData.numpages,
        info: pdfData.info,
        metadata: pdfData.metadata,
        version: pdfData.version,
        fileSize: stats.size,
        characterCount: processedText.length,
        wordCount: this.countWords(processedText)
      };
      console.log(`✅ [extractText] Metadata extracted:`, {
        pages: metadata.pages,
        wordCount: metadata.wordCount,
        characterCount: metadata.characterCount
      });

      logger.info(`Text extraction complete: ${metadata.pages} pages, ${metadata.wordCount} words`);
      console.log(`✅ [extractText] Returning result`);

      return {
        text: processedText,
        ...metadata
      };
    } catch (error) {
      console.log(`❌ [extractText] ERROR: ${error.message}`);
      console.log(`📚 [extractText] Stack trace:`, error.stack);
      logger.error('PDF text extraction error:', error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
    console.log(`📊 Memory after: ${process.memoryUsage().heapUsed / 1024 / 1024} MB`);
  }

  /**
   * Custom page renderer for better text extraction
   */
  customPageRenderer(options) {
    return (pageData) => {
      try {
        // You can add custom rendering logic here
        // For example, extract images, tables, etc.
        return pageData.getTextContent().then((textContent) => {
          let lastY, text = '';
          
          for (const item of textContent.items) {
            if (lastY == item.transform[5] || !lastY) {
              text += item.str;
            } else {
              text += '\n' + item.str;
            }
            lastY = item.transform[5];
          }
          
          return text;
        });
      } catch (error) {
        logger.error('Page rendering error:', error);
        return '';
      }
    };
  }

  /**
   * Process and clean extracted text
   */
  processText(text, options = {}) {
    console.log(`🧹 [processText] Processing text, length: ${text ? text.length : 0}`);
    if (!text) {
      console.log(`⚠️ [processText] Empty text provided`);
      return '';
    }

    let processed = text;

    // Remove excessive whitespace
    processed = processed.replace(/\s+/g, ' ');
    console.log(`📊 [processText] After whitespace removal: ${processed.length} chars`);

    // Remove page numbers and headers/footers if enabled
    if (options.removePageNumbers) {
      processed = processed.replace(/\n\s*\d+\s*\n/g, '\n');
      console.log(`📊 [processText] After page number removal: ${processed.length} chars`);
    }

    // Fix hyphenated words
    if (options.fixHyphens) {
      processed = processed.replace(/(\w+)-\s+(\w+)/g, '$1$2');
      console.log(`📊 [processText] After hyphen fix: ${processed.length} chars`);
    }

    // Remove special characters if enabled
    if (options.removeSpecialChars) {
      processed = processed.replace(/[^\w\s.,!?;:'"()\-]/g, '');
      console.log(`📊 [processText] After special char removal: ${processed.length} chars`);
    }

    // Normalize line breaks
    processed = processed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Trim
    processed = processed.trim();
    console.log(`✅ [processText] Final text length: ${processed.length} chars`);

    return processed;
  }

  /**
   * Extract text from specific pages
   */
  async extractPages(filePath, pages) {
    console.log(`📄 [extractPages] Called for file: ${filePath}, pages:`, pages);
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer, {
        pagerender: (pageData) => {
          if (pages.includes(pageData.pageIndex + 1)) {
            return pageData.getTextContent();
          }
          return '';
        }
      });

      console.log(`✅ [extractPages] Extracted text length: ${pdfData.text.length}`);
      return pdfData.text;
    } catch (error) {
      console.log(`❌ [extractPages] ERROR:`, error.message);
      logger.error('Extract pages error:', error);
      throw error;
    }
  }

  /**
   * Extract metadata only (faster)
   */
  async extractMetadata(filePath) {
    console.log(`📄 [extractMetadata] Called for file: ${filePath}`);
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer, {
        pagerender: () => '' // Don't extract text
      });

      const metadata = {
        pages: pdfData.numpages,
        info: pdfData.info,
        metadata: pdfData.metadata,
        version: pdfData.version
      };
      console.log(`✅ [extractMetadata] Metadata extracted:`, metadata);
      return metadata;
    } catch (error) {
      console.log(`❌ [extractMetadata] ERROR:`, error.message);
      logger.error('Extract metadata error:', error);
      throw error;
    }
  }

  /**
   * Count words in text
   */
  countWords(text) {
    if (!text) return 0;
    const count = text.split(/\s+/).filter(word => word.length > 0).length;
    console.log(`📊 [countWords] Word count: ${count}`);
    return count;
  }

  /**
   * Check if PDF is readable/scannable
   */
  async isReadable(filePath) {
    console.log(`🔍 [isReadable] Checking file: ${filePath}`);
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer, {
        max: 5 // Check first 5 pages
      });

      const text = pdfData.text;
      const wordCount = this.countWords(text);
      const readable = wordCount > 50;
      console.log(`📊 [isReadable] Word count: ${wordCount}, Readable: ${readable}`);
      return readable;
    } catch (error) {
      console.log(`❌ [isReadable] ERROR:`, error.message);
      logger.error('Readability check error:', error);
      return false;
    }
  }

  /**
   * Validate PDF file
   */
  validatePDF(filePath) {
    console.log(`🔍 [validatePDF] Validating file: ${filePath}`);
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.log(`❌ [validatePDF] File not found`);
        return { valid: false, error: 'File not found' };
      }
      console.log(`✅ [validatePDF] File exists`);

      // Check file extension
      if (!filePath.toLowerCase().endsWith('.pdf')) {
        console.log(`❌ [validatePDF] Not a PDF file`);
        return { valid: false, error: 'Not a PDF file' };
      }
      console.log(`✅ [validatePDF] File extension is PDF`);

      // Check file size
      const stats = fs.statSync(filePath);
      console.log(`📏 [validatePDF] File size: ${stats.size} bytes`);
      
      if (stats.size > this.maxFileSize) {
        console.log(`❌ [validatePDF] File size exceeds limit`);
        return { 
          valid: false, 
          error: `File size exceeds ${this.maxFileSize / (1024 * 1024)}MB limit` 
        };
      }

      if (stats.size === 0) {
        console.log(`❌ [validatePDF] File is empty`);
        return { valid: false, error: 'File is empty' };
      }

      console.log(`✅ [validatePDF] File validation passed`);
      return { valid: true };
    } catch (error) {
      console.log(`❌ [validatePDF] Validation error:`, error.message);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Extract sections/chapters from PDF
   * (Basic implementation - can be enhanced)
   */
  extractSections(text) {
    console.log(`📊 [extractSections] Extracting sections from text, length: ${text ? text.length : 0}`);
    const sections = [];
    const lines = text.split('\n');
    
    let currentSection = { title: 'Introduction', content: [] };
    
    for (const line of lines) {
      // Check if line looks like a section header
      if (this.isSectionHeader(line)) {
        if (currentSection.content.length > 0) {
          sections.push({
            ...currentSection,
            content: currentSection.content.join('\n')
          });
        }
        currentSection = { title: line.trim(), content: [] };
      } else {
        currentSection.content.push(line);
      }
    }
    
    // Add last section
    if (currentSection.content.length > 0) {
      sections.push({
        ...currentSection,
        content: currentSection.content.join('\n')
      });
    }
    
    console.log(`✅ [extractSections] Found ${sections.length} sections`);
    return sections;
  }

  /**
   * Check if line is likely a section header
   */
  isSectionHeader(line) {
    line = line.trim();
    
    // Check if all caps and short
    if (line === line.toUpperCase() && line.length < 100 && line.length > 3) {
      return true;
    }
    
    // Check if has chapter/section markers
    if (/^(chapter|section|part|lesson)\s+\d+/i.test(line)) {
      return true;
    }
    
    // Check if numbered (1., 1.1, etc.)
    if (/^\d+\.\d*\s+[A-Z]/.test(line)) {
      return true;
    }
    
    return false;
  }
}

// Export singleton instance
console.log(`📤 [PDFProcessor] Exporting singleton instance`);
module.exports = new PDFProcessor();
