const cloudinary = require('cloudinary').v2;
const logger = require('../utils/logger');

/**
 * Cloudinary configuration and utilities
 */
class CloudinaryService {
  constructor() {
    this.initialize();
  }

  /**
   * Initialize Cloudinary
   */
  initialize() {
    try {
      // Check for required environment variables
      if (!process.env.CLOUDINARY_CLOUD_NAME) {
        throw new Error('CLOUDINARY_CLOUD_NAME is not defined');
      }
      if (!process.env.CLOUDINARY_API_KEY) {
        throw new Error('CLOUDINARY_API_KEY is not defined');
      }
      if (!process.env.CLOUDINARY_API_SECRET) {
        throw new Error('CLOUDINARY_API_SECRET is not defined');
      }

      // Configure Cloudinary
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true
      });

      logger.info('Cloudinary initialized successfully');
    } catch (error) {
      logger.error('Cloudinary initialization error:', error);
      throw error;
    }
  }

  /**
   * Upload file to Cloudinary
   * @param {string} filePath - Path to file
   * @param {Object} options - Upload options
   */
  async uploadFile(filePath, options = {}) {
    try {
      const defaultOptions = {
        folder: 'pdlist/uploads',
        resource_type: 'auto',
        use_filename: true,
        unique_filename: true,
        overwrite: false
      };

      const uploadOptions = { ...defaultOptions, ...options };

      const result = await cloudinary.uploader.upload(filePath, uploadOptions);
      
      logger.info(`File uploaded successfully: ${result.public_id}`);
      
      return {
        publicId: result.public_id,
        url: result.secure_url,
        format: result.format,
        size: result.bytes,
        createdAt: result.created_at
      };
    } catch (error) {
      logger.error('Cloudinary upload error:', error);
      throw error;
    }
  }

  /**
   * Upload PDF file
   */
  async uploadPDF(filePath, userId) {
    return this.uploadFile(filePath, {
      folder: `pdlist/users/${userId}/pdfs`,
      resource_type: 'raw',
      tags: ['pdf', `user_${userId}`]
    });
  }

  /**
   * Upload audio file
   */
  async uploadAudio(audioBuffer, userId, fileName) {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `pdlist/users/${userId}/audio`,
          resource_type: 'video', // 'video' for audio files
          public_id: fileName,
          format: 'mp3',
          tags: ['audio', `user_${userId}`]
        },
        (error, result) => {
          if (error) {
            logger.error('Audio upload error:', error);
            reject(error);
          } else {
            logger.info(`Audio uploaded successfully: ${result.public_id}`);
            resolve({
              publicId: result.public_id,
              url: result.secure_url,
              format: result.format,
              size: result.bytes,
              duration: result.duration,
              createdAt: result.created_at
            });
          }
        }
      );

      uploadStream.end(audioBuffer);
    });
  }

  /**
   * Delete file from Cloudinary
   */
  async deleteFile(publicId, resourceType = 'image') {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType
      });

      if (result.result === 'ok') {
        logger.info(`File deleted successfully: ${publicId}`);
      } else {
        logger.warn(`File deletion returned: ${result.result}`);
      }

      return result;
    } catch (error) {
      logger.error('Cloudinary delete error:', error);
      throw error;
    }
  }

  /**
   * Get file details
   */
  async getFileInfo(publicId) {
    try {
      const result = await cloudinary.api.resource(publicId, {
        resource_type: 'image' // or 'raw', 'video'
      });

      return result;
    } catch (error) {
      logger.error('Get file info error:', error);
      throw error;
    }
  }

  /**
   * Generate optimized URL
   */
  getOptimizedUrl(publicId, options = {}) {
    const transformation = options.transformation || {};
    return cloudinary.url(publicId, {
      secure: true,
      ...transformation
    });
  }

  /**
   * Generate audio player URL with optimizations
   */
  getAudioUrl(publicId) {
    return cloudinary.url(publicId, {
      secure: true,
      resource_type: 'video',
      format: 'mp3'
    });
  }

  /**
   * Create a signed URL (for private files)
   */
  getSignedUrl(publicId, options = {}) {
    const expiresAt = options.expiresAt || Math.floor(Date.now() / 1000) + 3600; // 1 hour
    
    return cloudinary.utils.private_download_url(publicId, options.format || 'mp3', {
      expires_at: expiresAt,
      resource_type: options.resourceType || 'video',
      attachment: options.attachment || false
    });
  }

  /**
   * List user's files
   */
  async listUserFiles(userId, options = {}) {
    try {
      const result = await cloudinary.api.resources({
        type: 'upload',
        prefix: `pdlist/users/${userId}/`,
        resource_type: options.resourceType || 'image',
        max_results: options.limit || 100,
        next_cursor: options.cursor
      });

      return {
        resources: result.resources,
        nextCursor: result.next_cursor
      };
    } catch (error) {
      logger.error('List files error:', error);
      throw error;
    }
  }

  /**
   * Check if service is healthy
   */
  async healthCheck() {
    try {
      const result = await cloudinary.api.ping();
      return {
        status: 'healthy',
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        message: result.message
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Get storage usage for user
   */
  async getUserStorageUsage(userId) {
    try {
      const result = await cloudinary.api.resources_by_tag(`user_${userId}`, {
        resource_type: 'all',
        max_results: 500
      });

      const totalBytes = result.resources.reduce((sum, resource) => sum + resource.bytes, 0);
      
      return {
        totalBytes,
        totalMB: (totalBytes / (1024 * 1024)).toFixed(2),
        fileCount: result.resources.length
      };
    } catch (error) {
      logger.error('Get storage usage error:', error);
      return {
        totalBytes: 0,
        totalMB: '0',
        fileCount: 0
      };
    }
  }
}

// Export singleton instance with cloudinary attached for direct access
module.exports = new CloudinaryService();
module.exports.cloudinary = cloudinary;