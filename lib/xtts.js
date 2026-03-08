const axios = require('axios');
const logger = require('../utils/logger');

/**
 * XTTS-v2 Text-to-Speech service wrapper
 * Uses HuggingFace inference API
 */
class XTTSService {
  constructor() {
    this.apiUrl = process.env.XTTS_API_URL || 'https://router.huggingface.co/hf-inference/models/coqui/XTTS-v2';
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
          throw new Error('HUGGINGFACE_API_KEY is not defined');
        }

        // Prepare text - split if too long
        const processedText = this.preprocessText(text);
        
        // Prepare request payload
        const payload = {
          inputs: processedText,
          parameters: {
            ...options,
            language: options.language || 'en',
            speaker_id: options.speakerId || 'default',
            speed: options.speed || 1.0
          }
        };

        // Make API request
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
   * Generate audio with speaker reference
   * @param {string} text - Text to convert
   * @param {Buffer} referenceAudio - Reference audio for voice cloning
   */
  async generateWithVoiceClone(text, referenceAudio) {
    try {
      logger.info('Generating audio with voice clone...');

      const formData = new FormData();
      formData.append('inputs', text);
      formData.append('reference_audio', new Blob([referenceAudio]), 'reference.wav');

      const response = await axios({
        method: 'post',
        url: this.apiUrl,
        data: formData,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'multipart/form-data'
        },
        responseType: 'arraybuffer',
        timeout: this.timeout
      });

      return response.data;
    } catch (error) {
      logger.error('Voice clone audio generation error:', error);
      throw error;
    }
  }

  /**
   * Preprocess text for TTS
   * Split long text into chunks if needed
   */
  preprocessText(text) {
    // Clean text
    let cleaned = text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s.,!?;:'"()-]/g, '') // Remove special characters
      .trim();

    // XTTS-v2 has a token limit, split if too long
    const maxLength = 5000; // Approximate character limit
    if (cleaned.length > maxLength) {
      logger.warn(`Text too long (${cleaned.length} chars), truncating to ${maxLength}`);
      cleaned = cleaned.substring(0, maxLength) + '...';
    }

    return cleaned;
  }

  /**
   * Get available voices/speakers
   */
  async getAvailableSpeakers() {
    try {
      // This is a mock - actual implementation would depend on XTTS API
      return [
        { id: 'default', name: 'Default Voice', gender: 'neutral' },
        { id: 'speaker_1', name: 'Female Speaker 1', gender: 'female' },
        { id: 'speaker_2', name: 'Male Speaker 1', gender: 'male' },
        { id: 'speaker_3', name: 'Female Speaker 2', gender: 'female' }
      ];
    } catch (error) {
      logger.error('Get speakers error:', error);
      return [];
    }
  }

  /**
   * Estimate audio duration from text
   * @param {string} text - Input text
   * @returns {number} Estimated duration in seconds
   */
  estimateDuration(text) {
    const wordCount = text.split(/\s+/).length;
    // Average speaking rate: 150 words per minute
    const minutes = wordCount / 150;
    return Math.ceil(minutes * 60);
  }

  /**
   * Check if service is healthy
   */
  async healthCheck() {
    try {
      // Simple test with short text
      const testText = 'This is a test of the text to speech system.';
      const startTime = Date.now();
      
      await this.generateAudio(testText);
      
      return {
        status: 'healthy',
        responseTime: Date.now() - startTime
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

module.exports = new XTTSService();
