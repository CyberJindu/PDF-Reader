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
    this.timeout = 120000; // Increased to 120 seconds for longer audio
    this.maxChunkLength = 4000; // Maximum characters per chunk

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
   * Split text into chunks for processing
   */
  splitTextIntoChunks(text, maxChunkLength) {
    const chunks = [];
    let remainingText = text;
    
    while (remainingText.length > 0) {
      // Find a good breaking point (end of sentence or paragraph)
      let chunkEnd = Math.min(remainingText.length, maxChunkLength);
      
      if (chunkEnd < remainingText.length) {
        // Look for sentence endings (., !, ?) followed by space
        const lastSentenceEnd = remainingText.substring(0, chunkEnd).search(/[.!?]\s[^.!?]*$/);
        if (lastSentenceEnd > 0) {
          chunkEnd = lastSentenceEnd + 1; // Include the punctuation
        } else {
          // Look for paragraph breaks
          const lastParagraphBreak = remainingText.substring(0, chunkEnd).lastIndexOf('\n\n');
          if (lastParagraphBreak > 0) {
            chunkEnd = lastParagraphBreak;
          } else {
            // Look for comma or other natural pause
            const lastComma = remainingText.substring(0, chunkEnd).lastIndexOf(', ');
            if (lastComma > chunkEnd * 0.7) { // Only use if it's near the end
              chunkEnd = lastComma + 1;
            }
          }
        }
      }
      
      const chunk = remainingText.substring(0, chunkEnd).trim();
      if (chunk) {
        chunks.push(chunk);
      }
      
      remainingText = remainingText.substring(chunkEnd).trim();
    }
    
    return chunks;
  }

  /**
   * Combine multiple audio buffers into one
   */
  combineAudioBuffers(buffers) {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const combinedBuffer = Buffer.concat(buffers, totalLength);
    return combinedBuffer;
  }

  /**
   * Generate audio from text using self-hosted TTS server
   * Handles long text by splitting into chunks and combining results
   */
  async generateAudio(text, options = {}) {
    if (!this.serverUrl) {
      throw new Error('TTS server URL not configured. Set TTS_SERVER_URL.');
    }
    if (!this.apiKey) {
      throw new Error('TTS server API key not configured. Set TTS_SERVER_API_KEY.');
    }

    // Clean the text first
    const cleanedText = this.cleanText(text);
    
    // Split text into chunks if needed
    const chunks = this.splitTextIntoChunks(cleanedText, this.maxChunkLength);
    
    if (chunks.length === 1) {
      // Single chunk - process normally
      logger.info(`Generating audio for single chunk (${cleanedText.length} chars)...`);
      return await this.generateAudioChunk(cleanedText, options);
    } else {
      // Multiple chunks - process each and combine
      logger.info(`📚 Splitting text into ${chunks.length} chunks for processing...`);
      
      const audioBuffers = [];
      let totalProcessed = 0;
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        logger.info(`Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)...`);
        
        try {
          const audioBuffer = await this.generateAudioChunk(chunk, {
            ...options,
            // Use slightly different voice parameters for each chunk to maintain natural flow
            speed: options.speed || 1.0,
          });
          
          audioBuffers.push(audioBuffer);
          totalProcessed += chunk.length;
          
          logger.info(`✅ Chunk ${i + 1}/${chunks.length} processed (${audioBuffer.length} bytes)`);
        } catch (chunkError) {
          logger.error(`❌ Failed to process chunk ${i + 1}:`, chunkError.message);
          throw new Error(`TTS failed at chunk ${i + 1}/${chunks.length}: ${chunkError.message}`);
        }
      }
      
      // Combine all audio buffers
      const combinedAudio = this.combineAudioBuffers(audioBuffers);
      logger.info(`✅ Combined ${chunks.length} chunks into single audio (${combinedAudio.length} bytes)`);
      
      return combinedAudio;
    }
  }

  /**
   * Generate audio for a single text chunk
   */
  async generateAudioChunk(text, options = {}) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info(`Generating audio chunk (attempt ${attempt}/${this.maxRetries})...`);

        // Clean the text but don't truncate - we already split into chunks
        const processedText = this.cleanText(text);

        // OpenAI-compatible payload
        const payload = {
          model: options.model || "tts-1",
          input: processedText,
          voice: options.voice || "alloy",
          speed: options.speed || 1.0,
          ...options
        };

        logger.debug(`Sending to TTS server: ${this.serverUrl}/v1/audio/speech`);

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

        return response.data;

      } catch (error) {
        lastError = error;
        
        if (error.code === 'ECONNREFUSED') {
          logger.error(`❌ Cannot connect to TTS server at ${this.serverUrl}`);
        } else if (error.code === 'ENOTFOUND') {
          logger.error(`❌ Cannot resolve TTS server URL: ${this.serverUrl}`);
        } else if (error.response) {
          logger.error(`❌ TTS server error: ${error.response.status}`);
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
   * Clean text for TTS without truncation
   */
  cleanText(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
    // Clean but don't truncate
    let cleaned = text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s.,!?;:'"()-]/g, '') // Remove special characters
      .trim();

    return cleaned;
  }

  /**
   * Preprocess text for TTS (legacy method - kept for compatibility)
   */
  preprocessText(text, maxLength = 4000) {
    logger.warn('⚠️ preprocessText is deprecated. Using generateAudio which handles long text automatically.');
    return this.cleanText(text);
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
