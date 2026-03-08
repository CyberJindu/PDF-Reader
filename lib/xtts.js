const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Text-to-Speech service wrapper using HuggingFace Inference Providers (Router API)
 * Uses Microsoft SpeechT5 (actively maintained and works with new router)
 */
class TTSService {
  constructor() {
    // Use the new router endpoint with correct format for Inference Providers
    this.apiUrl = process.env.TTS_API_URL || 'https://router.huggingface.co/hf-inference/models/microsoft/speecht5_tts';
    this.apiKey = process.env.HUGGINGFACE_API_KEY;
    this.maxRetries = 3;
    this.retryDelay = 2000;
    this.timeout = 60000; // 60 seconds for audio generation
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
          throw new Error('HUGGINGFACE_API_KEY is not defined in environment variables');
        }

        // SpeechT5 has a smaller token limit
        const processedText = this.preprocessText(text, 1000);
        
        // NEW FORMAT for HuggingFace Inference Providers (router API)
        // The router expects a specific payload structure
        const payload = {
          inputs: processedText,
          parameters: {
            ...options,
            // SpeechT5 specific parameters
            ...(options.language && { language: options.language }),
            ...(options.speaker_id && { speaker_id: options.speaker_id }),
            ...(options.speed && { speed: options.speed })
          }
        };

        logger.debug(`Sending request to: ${this.apiUrl}`);
        logger.debug(`Payload preview: ${JSON.stringify(payload).substring(0, 200)}`);

        // Make API request to the new router endpoint
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
          // Don't validate status here - we'll handle it manually
          validateStatus: () => true
        });

        // Handle different response status codes
        if (response.status !== 200) {
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorText = Buffer.from(response.data).toString('utf8');
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorJson.message || errorMessage;
            
            // Log the full error for debugging
            logger.error('API Error Response:', errorJson);
          } catch (e) {
            // If can't parse JSON, use raw text
            errorMessage = response.data ? response.data.toString() : errorMessage;
          }
          
          throw new Error(`HuggingFace API error (${response.status}): ${errorMessage}`);
        }

        // Check if response is audio
        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.includes('audio')) {
          // Try to parse error message from successful response
          try {
            const errorText = Buffer.from(response.data).toString('utf8');
            const error = JSON.parse(errorText);
            throw new Error(error.error || error.message || 'Failed to generate audio - response was not audio');
          } catch (e) {
            throw new Error('Invalid response from TTS service: expected audio but got something else');
          }
        }

        logger.info(`Audio generated successfully (${response.data.length} bytes)`);
        
        return response.data;
      } catch (error) {
        lastError = error;
        logger.error(`Audio generation attempt ${attempt} failed:`, error.message);

        // Check if model is loading (503)
        if (error.message.includes('503') || error.message.includes('loading')) {
          const waitTime = 20000; // 20 seconds for model loading
          logger.info(`Model is loading, waiting ${waitTime/1000} seconds...`);
          await this.sleep(waitTime);
        } 
        else if (attempt < this.maxRetries) {
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
    if (!text || typeof text !== 'string') {
      logger.warn('Invalid text provided to TTS, using empty string');
      return '';
    }
    
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
