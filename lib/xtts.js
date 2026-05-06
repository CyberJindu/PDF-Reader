const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Text-to-Speech service wrapper for self-hosted OpenSpeech-TTS server
 */
class TTSService {
  constructor() {
    this.serverUrl = process.env.TTS_SERVER_URL;
    this.apiKey = process.env.TTS_SERVER_API_KEY;
    
    this.maxRetries = 5;              // Increased from 3 to 5
    this.retryDelay = 5000;           // Increased from 2000ms to 5000ms
    this.chunkDelay = 10000;          // NEW: 10 second wait between chunks
    this.timeout = 120000;
    this.maxChunkLength = 4000;

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
    
    if (this.serverUrl && this.apiKey) {
      setTimeout(() => {
        this.testConnection().catch(error => {
          logger.warn('⚠️ Initial TTS connection test failed:', error.message);
        });
      }, 1000);
    }
  }

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
        return true;
      } else {
        logger.warn(`⚠️ TTS server returned status ${response.status}`);
        return false;
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        logger.warn(`⚠️ Cannot connect to TTS server at ${this.serverUrl}`);
      } else if (error.response) {
        logger.warn(`⚠️ TTS server error: ${error.response.status}`);
      } else {
        logger.warn(`⚠️ TTS connection test failed: ${error.message}`);
      }
      return false;
    }
  }

  splitTextIntoChunks(text, maxChunkLength) {
    const chunks = [];
    let remainingText = text;
    
    while (remainingText.length > 0) {
      let chunkEnd = Math.min(remainingText.length, maxChunkLength);
      
      if (chunkEnd < remainingText.length) {
        const lastSentenceEnd = remainingText.substring(0, chunkEnd).search(/[.!?]\s[^.!?]*$/);
        if (lastSentenceEnd > 0) {
          chunkEnd = lastSentenceEnd + 1;
        } else {
          const lastParagraphBreak = remainingText.substring(0, chunkEnd).lastIndexOf('\n\n');
          if (lastParagraphBreak > 0) {
            chunkEnd = lastParagraphBreak;
          } else {
            const lastComma = remainingText.substring(0, chunkEnd).lastIndexOf(', ');
            if (lastComma > chunkEnd * 0.7) {
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

  combineAudioBuffers(buffers) {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    return Buffer.concat(buffers, totalLength);
  }

  async generateAudio(text, options = {}) {
    if (!this.serverUrl) {
      throw new Error('TTS server URL not configured. Set TTS_SERVER_URL.');
    }
    if (!this.apiKey) {
      throw new Error('TTS server API key not configured. Set TTS_SERVER_API_KEY.');
    }

    const cleanedText = this.cleanText(text);
    const chunks = this.splitTextIntoChunks(cleanedText, this.maxChunkLength);
    
    if (chunks.length === 1) {
      logger.info(`Generating audio for single chunk (${cleanedText.length} chars)...`);
      return await this.generateAudioChunk(cleanedText, options);
    } else {
      logger.info(`📚 Splitting text into ${chunks.length} chunks for processing...`);
      
      const audioBuffers = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        logger.info(`Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)...`);
        
        try {
          const audioBuffer = await this.generateAudioChunk(chunk, {
            ...options,
            speed: options.speed || 1.0,
          });
          
          audioBuffers.push(audioBuffer);
          
          logger.info(`✅ Chunk ${i + 1}/${chunks.length} processed (${audioBuffer.length} bytes)`);
          
          // 🔥 NEW: Wait between chunks to avoid rate limiting
          if (i < chunks.length - 1) {
            logger.info(`⏸️ Waiting ${this.chunkDelay / 1000}s before next chunk to avoid rate limit...`);
            await this.sleep(this.chunkDelay);
          }
        } catch (chunkError) {
          logger.error(`❌ Failed to process chunk ${i + 1}:`, chunkError.message);
          throw new Error(`TTS failed at chunk ${i + 1}/${chunks.length}: ${chunkError.message}`);
        }
      }
      
      const combinedAudio = this.combineAudioBuffers(audioBuffers);
      logger.info(`✅ Combined ${chunks.length} chunks into single audio (${combinedAudio.length} bytes)`);
      
      return combinedAudio;
    }
  }

  async generateAudioChunk(text, options = {}) {
    let lastError;
    
    // 🔥 Exponential backoff delays: 5s, 10s, 20s, 40s, 80s
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info(`Generating audio chunk (attempt ${attempt}/${this.maxRetries})...`);

        const processedText = this.cleanText(text);

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
        
        if (error.response?.status === 429) {
          logger.warn(`⚠️ Rate limited (429). TTS server is busy.`);
        } else if (error.code === 'ECONNREFUSED') {
          logger.error(`❌ Cannot connect to TTS server at ${this.serverUrl}`);
        } else if (error.response) {
          logger.error(`❌ TTS server error: ${error.response.status}`);
        } else {
          logger.error(`❌ TTS attempt ${attempt} failed:`, error.message);
        }

        if (attempt < this.maxRetries) {
          // 🔥 Exponential backoff: 5s → 10s → 20s → 40s
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          logger.info(`⏳ Retrying in ${delay / 1000}s (attempt ${attempt + 1}/${this.maxRetries})...`);
          await this.sleep(delay);
        }
      }
    }
    
    throw new Error(`Failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  cleanText(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
    return text
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s.,!?;:'"()-]/g, '')
      .trim();
  }

  preprocessText(text, maxLength = 4000) {
    logger.warn('⚠️ preprocessText is deprecated. Using generateAudio which handles long text automatically.');
    return this.cleanText(text);
  }

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
