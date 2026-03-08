const axios = require('axios');
const logger = require('../utils/logger');

/**
 * XTTS-v2 Text-to-Speech service wrapper
 * Uses HuggingFace Inference Providers (new router API)
 */
class XTTSService {
  constructor() {
    // Use the new router endpoint with the correct path for TTS
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
          throw new Error('HUGGINGFACE_API_KEY is not defined in environment variables');
        }

        // Prepare text - split if too long
        const processedText = this.preprocessText(text);
        
        // NEW FORMAT for Inference Providers
        // The router expects OpenAI-compatible format for most endpoints
        const payload = {
          inputs: processedText,
          // Some TTS models use parameters object, others use flat structure
          ...(options.language && { language: options.language }),
          ...(options.speaker_id && { speaker_id: options.speaker_id }),
          ...(options.speed && { speed: options.speed })
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
            errorMessage = errorJson.error || errorMessage;
            
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
            throw new Error(error.error || 'Failed to generate audio - response was not audio');
          } catch (e) {
            throw new Error('Invalid response from TTS service: expected audio but got something else');
          }
        }

        logger.info(`Audio generated successfully (${response.data.length} bytes)`);
        
        return response.data;
      } catch (error) {
        lastError = error;
        logger.error(`Audio generation attempt ${attempt} failed:`, error.message);

        // Check if model is loading (503) or if it's a quota issue
        if (error.message.includes('503') || error.message.includes('loading')) {
          const waitTime = 20000; // 20 seconds for model loading
          logger.info(`Model is loading, waiting ${waitTime/1000} seconds...`);
          await this.sleep(waitTime);
        } 
        // Check if it's a 410 (still using wrong format)
        else if (error.message.includes('410')) {
          logger.error('Still using deprecated API format. Attempting alternative endpoint...');
          // Try alternative endpoint format
          if (attempt === 1) {
            this.apiUrl = 'https://router.huggingface.co/hf-inference/v1/audio/speech';
            logger.info(`Trying alternative endpoint: ${this.apiUrl}`);
          }
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
   * Generate audio with speaker reference
   * @param {string} text - Text to convert
   * @param {Buffer} referenceAudio - Reference audio for voice cloning
   */
  async generateWithVoiceClone(text, referenceAudio) {
    try {
      logger.info('Generating audio with voice clone...');

      // For voice cloning, we need to use multipart form data
      const formData = new FormData();
      formData.append('inputs', text);
      
      // Create a blob from the reference audio
      const audioBlob = new Blob([referenceAudio], { type: 'audio/wav' });
      formData.append('audio', audioBlob, 'reference.wav');

      const response = await axios({
        method: 'post',
        url: this.apiUrl,
        data: formData,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'multipart/form-data'
        },
        responseType: 'arraybuffer',
        timeout: this.timeout,
        validateStatus: () => true
      });

      if (response.status !== 200) {
        throw new Error(`Voice clone failed with status ${response.status}`);
      }

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
    if (!text) return '';
    
    // Clean text
    let cleaned = text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s.,!?;:'"()-]/g, '') // Remove special characters
      .trim();

    // XTTS-v2 has a token limit, split if too long
    const maxLength = 5000; // Approximate character limit
    if (cleaned.length > maxLength) {
      logger.warn(`Text too long (${cleaned.length} chars), truncating to ${maxLength}`);
      cleaned = cleaned.substring(0, maxLength);
    }

    return cleaned;
  }

  /**
   * Get available voices/speakers
   */
  async getAvailableSpeakers() {
    try {
      // For XTTS-v2, we'd need to query the model info
      // This is a placeholder until we implement the actual API call
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
    if (!text) return 0;
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
      
      await this.generateAudio(testText, { maxDuration: 5 });
      
      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
        message: 'TTS service is operational'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        message: 'TTS service is not responding'
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
