const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Text-to-Speech service wrapper for self-hosted OpenSpeech-TTS server
 * No HuggingFace dependencies - pure self-hosted solution
 */
class TTSService {
  constructor() {
    // Your self-hosted server URL (set in Render environment variables)
    this.serverUrl = process.env.TTS_SERVER_URL;
    
    // The API key you created when setting up the TTS server
    this.apiKey = process.env.TTS_SERVER_API_KEY;
    
    this.maxRetries = 3;
    this.retryDelay = 2000;
    this.timeout = 60000;

    if (!this.serverUrl) {
      logger.error('TTS_SERVER_URL environment variable is not set!');
    }
    if (!this.apiKey) {
      logger.error('TTS_SERVER_API_KEY environment variable is not set!');
    }
  }

  /**
   * Generate audio from text using self-hosted TTS server
   */
  async generateAudio(text, options = {}) {
    if (!this.serverUrl) {
      throw new Error('TTS server URL not configured. Set TTS_SERVER_URL.');
    }
    if (!this.apiKey) {
      throw new Error('TTS server API key not configured. Set TTS_SERVER_API_KEY.');
    }

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info(`Generating audio (attempt ${attempt}/${this.maxRetries}) via self-hosted TTS...`);

        const processedText = this.preprocessText(text, 4000);

        // OpenAI-compatible payload - exactly what your server expects
        const payload = {
          model: options.model || "tts-1",
          input: processedText,
          voice: options.voice || "alloy",  // alloy, echo, fable, onyx, nova, shimmer
          speed: options.speed || 1.0,
          ...options
        };

        logger.debug(`Sending to self-hosted TTS: ${this.serverUrl}/v1/audio/speech`);

        const response = await axios({
          method: 'post',
          url: `${this.serverUrl}/v1/audio/speech`,
          data: payload,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer',
          timeout: this.timeout,
          validateStatus: (status) => status === 200
        });

        logger.info(`Audio generated successfully (${response.data.length} bytes) from self-hosted server`);
        return response.data;

      } catch (error) {
        lastError = error;
        logger.error(`TTS attempt ${attempt} failed:`, error.message);

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          logger.info(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }
    throw new Error(`Failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Preprocess text for TTS
   */
  preprocessText(text, maxLength = 4000) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
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
   * Test connection to self-hosted server
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.serverUrl}/health`, {
        timeout: 5000
      });
      return {
        status: 'healthy',
        server: 'self-hosted',
        response: response.data
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        server: 'self-hosted',
        error: error.message
      };
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new TTSService();
