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
  }

  /**
   * Extract text from PDF file
   * @param {string} filePath - Path to PDF file
   * @param {Object} options - Extraction options
   */
  async extractText(filePath, options = {}) {
    try {
      logger.info(`Extracting text from PDF: ${filePath}`);

      // Check file size
      const stats = fs.statSync(filePath);
      if (stats.size > this.maxFileSize) {
        throw new Error(`File size exceeds limit: ${stats.size} bytes`);
      }

      // Read PDF file
      const dataBuffer = fs.readFileSync(filePath);

      // Parse PDF with options
      const pdfData = await pdf(dataBuffer, {
        max: options.maxPages || 0, // 0 = no limit
        pagerender: this.customPageRenderer(options),
        version: 'v2.0.550'
      });

      // Process extracted text
      const processedText = this.processText(pdfData.text, options);

      // Extract metadata
      const metadata = {
        pages: pdfData.numpages,
        info: pdfData.info,
        metadata: pdfData.metadata,
        version: pdfData.version,
        fileSize: stats.size,
        characterCount: processedText.length,
        wordCount: this.countWords(processedText)
      };

      logger.info(`Text extraction complete: ${metadata.pages} pages, ${metadata.wordCount} words`);

      return {
        text: processedText,
        ...metadata
      };
    } catch (error) {
      logger.error('PDF text extraction error:', error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
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
    if (!text) return '';

    let processed = text;

    // Remove excessive whitespace
    processed = processed.replace(/\s+/g, ' ');

    // Remove page numbers and headers/footers if enabled
    if (options.removePageNumbers) {
      processed = processed.replace(/\n\s*\d+\s*\n/g, '\n');
    }

    // Fix hyphenated words
    if (options.fixHyphens) {
      processed = processed.replace(/(\w+)-\s+(\w+)/g, '$1$2');
    }

    // Remove special characters if enabled
    if (options.removeSpecialChars) {
      processed = processed.replace(/[^\w\s.,!?;:'"()\-]/g, '');
    }

    // Normalize line breaks
    processed = processed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Trim
    processed = processed.trim();

    return processed;
  }

  /**
   * Extract text from specific pages
   */
  async extractPages(filePath, pages) {
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

      return pdfData.text;
    } catch (error) {
      logger.error('Extract pages error:', error);
      throw error;
    }
  }

  /**
   * Extract metadata only (faster)
   */
  async extractMetadata(filePath) {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer, {
        pagerender: () => '' // Don't extract text
      });

      return {
        pages: pdfData.numpages,
        info: pdfData.info,
        metadata: pdfData.metadata,
        version: pdfData.version
      };
    } catch (error) {
      logger.error('Extract metadata error:', error);
      throw error;
    }
  }

  /**
   * Count words in text
   */
  countWords(text) {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Check if PDF is readable/scannable
   */
  async isReadable(filePath) {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer, {
        max: 5 // Check first 5 pages
      });

      const text = pdfData.text;
      const wordCount = this.countWords(text);

      // If less than 50 words for first 5 pages, probably scanned image
      return wordCount > 50;
    } catch (error) {
      logger.error('Readability check error:', error);
      return false;
    }
  }

  /**
   * Validate PDF file
   */
  validatePDF(filePath) {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return { valid: false, error: 'File not found' };
      }

      // Check file extension
      if (!filePath.toLowerCase().endsWith('.pdf')) {
        return { valid: false, error: 'Not a PDF file' };
      }

      // Check file size
      const stats = fs.statSync(filePath);
      if (stats.size > this.maxFileSize) {
        return { 
          valid: false, 
          error: `File size exceeds ${this.maxFileSize / (1024 * 1024)}MB limit` 
        };
      }

      if (stats.size === 0) {
        return { valid: false, error: 'File is empty' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Extract sections/chapters from PDF
   * (Basic implementation - can be enhanced)
   */
  extractSections(text) {
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
module.exports = new PDFProcessor();