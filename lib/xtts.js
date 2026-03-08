const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Text-to-Speech service wrapper using HuggingFace Inference API
 * Switched to Microsoft SpeechT5 (actively maintained)
 */
class TTSService {
  constructor() {
    // Switch to Microsoft SpeechT5 - confirmed working
    this.apiUrl = process.env.TTS_API_URL || 'https://api-inference.huggingface.co/models/microsoft/speecht5_tts';
    this.apiKey = process.env.HUGGINGFACE_API_KEY;
    this.maxRetries = 3;
    this.retryDelay = 2000;
    this.timeout = 60000;
  }

  /**
   * Generate audio from text
   * @param {string} text - Text to convert to speech
   * @param {Object} options - Audio generation options
   */
  async generateAudio(text, options = {}) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info(`Generating audio (attempt ${attempt}/${this.maxRetries})...`);

        if (!this.apiKey) {
          throw new Error('HUGGINGFACE_API_KEY is not defined');
        }

        // SpeechT5 has a smaller token limit
        const processedText = this.preprocessText(text, 1000); // Limit to 1000 chars
        
        // SpeechT5 requires speaker embeddings
        // Using a default speaker embedding (you can make this configurable)
        const payload = {
          inputs: processedText,
          parameters: {
            ...options,
            // You can add speaker_embeddings here if needed
          }
        };

        logger.debug(`Sending request to: ${this.apiUrl}`);
        logger.debug(`Payload preview: ${JSON.stringify(payload).substring(0, 200)}`);

        const response = await axios({
          method: 'post',
          url: this.apiUrl,
          data: payload,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer',
          timeout: this.timeout,
          validateStatus: (status) => status === 200
        });

        // Check if response is audio
        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.includes('audio')) {
          // Try to parse error message
          try {
            const errorText = Buffer.from(response.data).toString('utf8');
            const error = JSON.parse(errorText);
            throw new Error(error.error || 'Failed to generate audio');
          } catch (e) {
            throw new Error('Invalid response from TTS service');
          }
        }

        logger.info(`Audio generated successfully (${response.data.length} bytes)`);
        
        return response.data;
      } catch (error) {
        lastError = error;
        logger.error(`Audio generation attempt ${attempt} failed:`, error.message);

        // Check if model is loading
        if (error.response?.status === 503) {
          const estimatedTime = error.response?.data?.estimated_time || 20;
          logger.info(`Model is loading, waiting ${estimatedTime} seconds...`);
          await this.sleep(estimatedTime * 1000);
        } else if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          logger.info(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`Failed to generate audio after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Preprocess text for TTS with configurable max length
   */
  preprocessText(text, maxLength = 1000) {
    if (!text) return '';
    
    // Clean text
    let cleaned = text
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s.,!?;:'"()-]/g, '')
      .trim();

    if (cleaned.length > maxLength) {
      logger.warn(`Text too long (${cleaned.length} chars), truncating to ${maxLength}`);
      cleaned = cleaned.substring(0, maxLength);
    }

    return cleaned;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
module.exports = new TTSService();
