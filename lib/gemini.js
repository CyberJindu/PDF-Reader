const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

/**
 * Google Gemini AI wrapper
 * Uses Gemini 2.5 Flash model for summarization
 */
class GeminiService {
  constructor() {
    this.genAI = null;
    this.model = null;
    this.maxRetries = 3;
    this.retryDelay = 1000;
    this.initialize();
  }

  /**
   * Initialize Gemini AI
   */
  initialize() {
    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not defined');
      }

      this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.model = this.genAI.getGenerativeModel({ 
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192, // Approximately 1400 words
        }
      });

      logger.info('Gemini AI initialized successfully');
    } catch (error) {
      logger.error('Gemini initialization error:', error);
      throw error;
    }
  }

  /**
   * Generate summary from text with word limit
   * @param {string} text - Input text to summarize
   * @param {number} maxWords - Maximum words in summary (default: 1400)
   */
  async generateSummary(text, maxWords = 1400) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info(`Generating summary (attempt ${attempt}/${this.maxRetries})...`);

        const prompt = this.buildSummaryPrompt(text, maxWords);
        
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        const summary = response.text();

        // Validate summary
        if (!summary || summary.length < 50) {
          throw new Error('Generated summary is too short');
        }

        // Check word count
        const wordCount = summary.split(/\s+/).length;
        if (wordCount > maxWords) {
          logger.warn(`Summary exceeded word limit: ${wordCount}/${maxWords}`);
        }

        logger.info(`Summary generated successfully: ${wordCount} words`);
        
        return summary;
      } catch (error) {
        lastError = error;
        logger.error(`Summary generation attempt ${attempt} failed:`, error.message);
        
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          logger.info(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`Failed to generate summary after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Build summary prompt
   */
  buildSummaryPrompt(text, maxWords) {
    // Truncate input text if too long (Gemini has token limits)
    const maxInputLength = 30000;
    const truncatedText = text.length > maxInputLength 
      ? text.substring(0, maxInputLength) + '...' 
      : text;

    return `
You are an expert study assistant. Your task is to create a comprehensive yet concise summary of the following academic/textbook content.

**Instructions:**
1. Create a summary that is **maximum ${maxWords} words**.
2. Focus on key concepts, main ideas, and important details.
3. Organize the summary in a clear, logical structure.
4. Use bullet points or sections if it helps with clarity.
5. Preserve technical terms and important definitions.
6. Make it easy to understand and listen to as audio.

**Content to summarize:**
${truncatedText}

**Summary:**
`;
  }

  /**
   * Generate study notes from text
   * @param {string} text - Input text
   * @param {string} format - Notes format (bullets, outline, qa)
   */
  async generateStudyNotes(text, format = 'bullets') {
    try {
      const formats = {
        bullets: 'Create bullet-point study notes',
        outline: 'Create an outline with main topics and subtopics',
        qa: 'Create a Q&A format with important questions and answers'
      };

      const prompt = `
${formats[format] || formats.bullets} from the following text.
Focus on key concepts, definitions, and important details.
Make it easy to review and study from.

Text:
${text.substring(0, 20000)}

Study Notes:
`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      logger.error('Study notes generation error:', error);
      throw error;
    }
  }

  /**
   * Extract keywords from text
   */
  async extractKeywords(text) {
    try {
      const prompt = `
Extract the most important keywords and key phrases from the following text.
Return them as a JSON array of strings, maximum 20 keywords.
Make them specific and relevant to the content.

Text:
${text.substring(0, 10000)}

Keywords (JSON array):
`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response();
      const text = response.text();
      
      // Try to parse JSON from response
      try {
        const jsonMatch = text.match(/\[.*\]/s);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        // If JSON parsing fails, return array from split
        return text.split('\n').filter(k => k.trim()).map(k => k.replace(/^-\s*/, ''));
      }
      
      return [];
    } catch (error) {
      logger.error('Keyword extraction error:', error);
      return [];
    }
  }

  /**
   * Check if service is healthy
   */
  async healthCheck() {
    try {
      const testPrompt = 'Respond with "OK" if you can hear me.';
      const result = await this.model.generateContent(testPrompt);
      const response = await result.response;
      
      return {
        status: 'healthy',
        model: this.model.model,
        response: response.text().substring(0, 50)
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
module.exports = new GeminiService();