const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/**
 * Hashing utilities for various purposes
 */
class HashUtils {
  constructor() {
    this.algorithm = 'aes-256-cbc';
    this.saltRounds = 12;
  }

  /**
   * Hash a string using bcrypt
   * @param {string} str - String to hash
   */
  async hashBcrypt(str) {
    return await bcrypt.hash(str, this.saltRounds);
  }

  /**
   * Compare string with bcrypt hash
   */
  async compareBcrypt(str, hash) {
    return await bcrypt.compare(str, hash);
  }

  /**
   * Create SHA-256 hash
   * @param {string} str - String to hash
   */
  hashSHA256(str) {
    return crypto
      .createHash('sha256')
      .update(str)
      .digest('hex');
  }

  /**
   * Create MD5 hash (for non-security purposes)
   */
  hashMD5(str) {
    return crypto
      .createHash('md5')
      .update(str)
      .digest('hex');
  }

  /**
   * Generate random token
   * @param {number} bytes - Number of bytes
   */
  generateToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Generate random numeric code
   * @param {number} length - Code length
   */
  generateNumericCode(length = 6) {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
  }

  /**
   * Generate API key
   */
  generateApiKey() {
    const prefix = 'pdlist_';
    const random = crypto.randomBytes(24).toString('hex');
    return prefix + random;
  }

  /**
   * Encrypt data
   * @param {string} text - Text to encrypt
   * @param {string} secret - Secret key
   */
  encrypt(text, secret) {
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      iv: iv.toString('hex'),
      encrypted
    };
  }

  /**
   * Decrypt data
   * @param {Object} encryptedData - { iv, encrypted }
   * @param {string} secret - Secret key
   */
  decrypt(encryptedData, secret) {
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = Buffer.from(encryptedData.iv, 'hex');
    
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Create HMAC signature
   */
  createHmac(data, secret) {
    return crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');
  }

  /**
   * Verify HMAC signature
   */
  verifyHmac(data, signature, secret) {
    const expectedSignature = this.createHmac(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Generate password reset token
   */
  generatePasswordResetToken() {
    const token = this.generateToken();
    const expiresAt = Date.now() + 3600000; // 1 hour
    
    return {
      token,
      expiresAt,
      hash: this.hashSHA256(token)
    };
  }

  /**
   * Generate email verification token
   */
  generateEmailVerificationToken() {
    return {
      token: this.generateToken(16),
      code: this.generateNumericCode(6),
      expiresAt: Date.now() + 86400000 // 24 hours
    };
  }

  /**
   * Hash file for integrity check
   */
  hashFile(fileBuffer) {
    return crypto
      .createHash('sha256')
      .update(fileBuffer)
      .digest('hex');
  }

  /**
   * Generate unique ID
   */
  generateId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
  }

  /**
   * Create short hash (for URLs, filenames)
   */
  shortHash(str, length = 8) {
    return this.hashMD5(str).substring(0, length);
  }

  /**
   * Secure compare (timing safe)
   */
  secureCompare(a, b) {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(a),
        Buffer.from(b)
      );
    } catch {
      return false;
    }
  }

  /**
   * Generate session token
   */
  generateSessionToken(userId, metadata = {}) {
    const payload = {
      userId,
      timestamp: Date.now(),
      random: crypto.randomBytes(8).toString('hex'),
      ...metadata
    };
    
    const stringified = JSON.stringify(payload);
    const signature = this.createHmac(stringified, process.env.JWT_SECRET);
    
    return {
      token: Buffer.from(stringified).toString('base64'),
      signature,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
    };
  }

  /**
   * Verify session token
   */
  verifySessionToken(token, signature) {
    try {
      const decoded = Buffer.from(token, 'base64').toString();
      const expectedSignature = this.createHmac(decoded, process.env.JWT_SECRET);
      
      if (!this.secureCompare(signature, expectedSignature)) {
        return null;
      }
      
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}

// Export singleton instance
module.exports = new HashUtils();