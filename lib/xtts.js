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

    // Log warnings but don't crash - make them warnings not errors
    if (!this.serverUrl) {
      logger.warn('⚠️ TTS_SERVER_URL environment variable is not set! TTS features will be disabled.');
    } else {
      logger.info(`✅ TTS_SERVER_URL configured: ${this.serverUrl}`);
    }
    
    if (!this.apiKey) {
      logger.warn('⚠️ TTS_SERVER_API_KEY environment variable is not set! TTS features will be disabled.');
    } else {
      logger.info('✅ TTS_SERVER_API_KEY configured');
    }
    
    // Test connection on startup if both URL and key are set (don't await - let it run in background)
    if (this.serverUrl && this.apiKey) {
      // Use setTimeout to run this asynchronously without blocking constructor
      setTimeout(() => {
        this.testConnection().catch(error => {
          logger.warn('⚠️ Initial TTS connection test failed:', error.message);
          logger.info('TTS will attempt to connect when needed during PDF processing');
        });
      }, 1000);
    }
  }

  /**
   * Test connection to self-hosted TTS server on startup
   */
  async testConnection() {
    try {
      logger.info('🔍 Testing connection to TTS server...');
      const startTime = Date.now();
      
      const response = await axios.get(`${this.serverUrl}/health`, {
        timeout: 5000,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.status === 200) {
        logger.info(`✅ Successfully connected to TTS server (${responseTime}ms)`);
        logger.info(`   Server: ${this.serverUrl}`);
        return true;
      } else {
        logger.warn(`⚠️ TTS server returned status ${response.status}`);
        return false;
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        logger.warn(`⚠️ Cannot connect to TTS server at ${this.serverUrl} - Connection refused`);
      } else if (error.code === 'ENOTFOUND') {
        logger.warn(`⚠️ Cannot resolve TTS server URL: ${this.serverUrl}`);
      } else if (error.response) {
        logger.warn(`⚠️ TTS server error: ${error.response.status} - ${error.response.statusText}`);
      } else {
        logger.warn(`⚠️ TTS connection test failed: ${error.message}`);
      }
      return false;
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

        logger.info(`✅ Audio generated successfully (${response.data.length} bytes) from self-hosted server`);
        return response.data;

      } catch (error) {
        lastError = error;
        
        // More descriptive error logging
        if (error.code === 'ECONNREFUSED') {
          logger.error(`❌ Cannot connect to TTS server at ${this.serverUrl} - Is the server running?`);
        } else if (error.code === 'ENOTFOUND') {
          logger.error(`❌ Cannot resolve TTS server URL: ${this.serverUrl}`);
        } else if (error.response) {
          logger.error(`❌ TTS server error: ${error.response.status} - ${error.response.statusText}`);
          // Try to get more details from response
          if (error.response.data) {
            try {
              const errorData = JSON.parse(error.response.data.toString());
              logger.error(`   Server message: ${errorData.error || 'Unknown error'}`);
            } catch (e) {
              // Ignore parsing errors
            }
          }
        } else {
          logger.error(`❌ TTS attempt ${attempt} failed:`, error.message);
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          logger.info(`⏳ Retrying in ${delay}ms...`);
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
      logger.warn(`📏 Text too long (${cleaned.length} chars), truncating to ${maxLength}`);
      cleaned = cleaned.substring(0, maxLength);
    }
    return cleaned;
  }

  /**
   * Test connection to self-hosted server (public method)
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.serverUrl}/health`, {
        timeout: 5000,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      return {
        status: 'healthy',
        server: 'self-hosted',
        url: this.serverUrl,
        responseTime: response.headers['x-response-time'] || 'unknown',
        data: response.data
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        server: 'self-hosted',
        url: this.serverUrl,
        error: error.message,
        code: error.code
      };
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new TTSService();
