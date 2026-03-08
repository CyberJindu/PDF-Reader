const logger = require('./logger');

/**
 * Validation utilities
 */
class Validators {
  constructor() {
    this.emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
    this.urlRegex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
    this.phoneRegex = /^[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/;
  }

  /**
   * Validate email
   */
  isEmail(email) {
    return this.emailRegex.test(email);
  }

  /**
   * Validate URL
   */
  isUrl(url) {
    return this.urlRegex.test(url);
  }

  /**
   * Validate phone number
   */
  isPhone(phone) {
    return this.phoneRegex.test(phone);
  }

  /**
   * Validate password strength
   * Requirements:
   * - At least 8 characters
   * - At least one uppercase letter
   * - At least one lowercase letter
   * - At least one number
   * - At least one special character
   */
  isStrongPassword(password) {
    const checks = {
      minLength: password.length >= 8,
      hasUppercase: /[A-Z]/.test(password),
      hasLowercase: /[a-z]/.test(password),
      hasNumber: /\d/.test(password),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(password)
    };

    const isValid = Object.values(checks).every(Boolean);
    
    if (!isValid) {
      return {
        isValid: false,
        checks
      };
    }

    return { isValid: true };
  }

  /**
   * Validate MongoDB ObjectId
   */
  isObjectId(id) {
    return /^[0-9a-fA-F]{24}$/.test(id);
  }

  /**
   * Validate date
   */
  isDate(date) {
    if (date instanceof Date) {
      return !isNaN(date.getTime());
    }
    
    const parsed = new Date(date);
    return !isNaN(parsed.getTime());
  }

  /**
   * Validate file size
   */
  isValidFileSize(size, maxSize = 50 * 1024 * 1024) {
    return size <= maxSize;
  }

  /**
   * Validate file type
   */
  isValidFileType(mimeType, allowedTypes = ['application/pdf']) {
    return allowedTypes.includes(mimeType);
  }

  /**
   * Validate PDF (magic number check)
   */
  isPDF(buffer) {
    if (buffer.length < 4) return false;
    const header = buffer.toString('ascii', 0, 4);
    return header === '%PDF';
  }

  /**
   * Validate JSON
   */
  isJSON(str) {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate credit card (Luhn algorithm)
   */
  isCreditCard(number) {
    const sanitized = number.replace(/\D/g, '');
    
    if (sanitized.length < 13 || sanitized.length > 19) {
      return false;
    }

    let sum = 0;
    let alternate = false;

    for (let i = sanitized.length - 1; i >= 0; i--) {
      let digit = parseInt(sanitized.charAt(i), 10);

      if (alternate) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      alternate = !alternate;
    }

    return sum % 10 === 0;
  }

  /**
   * Validate IBAN
   */
  isIBAN(iban) {
    const sanitized = iban.replace(/\s/g, '').toUpperCase();
    
    // Basic format check
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(sanitized)) {
      return false;
    }

    // Rearrange and convert to number
    const rearranged = sanitized.substring(4) + sanitized.substring(0, 4);
    const numeric = rearranged.split('').map(char => {
      const code = char.charCodeAt(0);
      return code >= 65 ? (code - 55).toString() : char;
    }).join('');

    // Mod 97 check
    let remainder = 0;
    for (let i = 0; i < numeric.length; i++) {
      remainder = (remainder * 10 + parseInt(numeric.charAt(i))) % 97;
    }

    return remainder === 1;
  }

  /**
   * Validate HEX color
   */
  isHexColor(color) {
    return /^#?([0-9A-F]{3}|[0-9A-F]{6})$/i.test(color);
  }

  /**
   * Validate IP address
   */
  isIP(ip) {
    // IPv4
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    
    // IPv6 (simplified)
    const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }

  /**
   * Validate UUID
   */
  isUUID(uuid) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
  }

  /**
   * Validate JWT
   */
  isJWT(token) {
    return /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/.test(token);
  }

  /**
   * Validate base64
   */
  isBase64(str) {
    const base64Regex = /^(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/;
    return base64Regex.test(str);
  }

  /**
   * Validate ASCII
   */
  isASCII(str) {
    return /^[\x00-\x7F]*$/.test(str);
  }

  /**
   * Validate UTF-8
   */
  isUTF8(str) {
    try {
      decodeURIComponent(encodeURIComponent(str));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate input length
   */
  isValidLength(str, min = 1, max = Infinity) {
    const length = str.length;
    return length >= min && length <= max;
  }

  /**
   * Validate against XSS patterns
   */
  isXSSFree(str) {
    const xssPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/i,
      /javascript:/i,
      /onerror=/i,
      /onload=/i,
      /onclick=/i,
      /onmouseover=/i
    ];

    return !xssPatterns.some(pattern => pattern.test(str));
  }

  /**
   * Validate SQL injection patterns
   */
  isSQLInjectionFree(str) {
    const sqlPatterns = [
      /(\s|^)SELECT\s/i,
      /(\s|^)INSERT\s/i,
      /(\s|^)UPDATE\s/i,
      /(\s|^)DELETE\s/i,
      /(\s|^)DROP\s/i,
      /(\s|^)UNION\s/i,
      /--/,
      /;\s*$/
    ];

    return !sqlPatterns.some(pattern => pattern.test(str));
  }

  /**
   * Comprehensive input validation
   */
  validateInput(str, options = {}) {
    const {
      required = true,
      minLength = 1,
      maxLength = Infinity,
      checkXSS = true,
      checkSQL = true,
      customRegex = null
    } = options;

    const errors = [];

    if (required && (!str || str.trim().length === 0)) {
      errors.push('Input is required');
    }

    if (str) {
      if (!this.isValidLength(str, minLength, maxLength)) {
        errors.push(`Length must be between ${minLength} and ${maxLength} characters`);
      }

      if (checkXSS && !this.isXSSFree(str)) {
        errors.push('Input contains potentially malicious content');
      }

      if (checkSQL && !this.isSQLInjectionFree(str)) {
        errors.push('Input contains potentially malicious SQL patterns');
      }

      if (customRegex && !customRegex.test(str)) {
        errors.push('Input format is invalid');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

// Export singleton instance
module.exports = new Validators();