const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

// Add colors to winston
winston.addColors(colors);

// Custom format for console
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Custom format for files (JSON)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.json()
);

// Determine log level based on environment
const level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';

// Create transports
const transports = [
  // Console transport
  new winston.transports.Console({
    format: consoleFormat
  }),
  
  // Error log file
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    format: fileFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }),
  
  // Combined log file
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    format: fileFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
  })
];

// Add HTTP logs in development
if (process.env.NODE_ENV === 'development') {
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'http.log'),
      level: 'http',
      format: fileFormat,
      maxsize: 5242880,
      maxFiles: 3
    })
  );
}

// Create logger
const logger = winston.createLogger({
  level,
  levels,
  transports,
  // Don't exit on error
  exitOnError: false
});

/**
 * Log HTTP requests (for Morgan replacement)
 */
logger.httpStream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

/**
 * Log with request context
 */
logger.withRequest = (req) => {
  const requestId = req.id || 'no-id';
  const userId = req.user ? req.user.id : 'anonymous';
  const ip = req.ip || req.connection.remoteAddress;
  const method = req.method;
  const url = req.originalUrl || req.url;

  return {
    info: (message, meta = {}) => {
      logger.info(message, {
        requestId,
        userId,
        ip,
        method,
        url,
        ...meta
      });
    },
    error: (message, meta = {}) => {
      logger.error(message, {
        requestId,
        userId,
        ip,
        method,
        url,
        ...meta
      });
    },
    warn: (message, meta = {}) => {
      logger.warn(message, {
        requestId,
        userId,
        ip,
        method,
        url,
        ...meta
      });
    },
    debug: (message, meta = {}) => {
      if (process.env.NODE_ENV === 'development') {
        logger.debug(message, {
          requestId,
          userId,
          ip,
          method,
          url,
          ...meta
        });
      }
    }
  };
};

/**
 * Performance logging
 */
logger.performance = (label, startTime, meta = {}) => {
  const duration = Date.now() - startTime;
  logger.info(`Performance [${label}]: ${duration}ms`, {
    type: 'performance',
    label,
    duration,
    ...meta
  });
};

/**
 * API call logging
 */
logger.apiCall = (service, method, duration, status, meta = {}) => {
  logger.http(`API Call [${service}] ${method} - ${status} (${duration}ms)`, {
    type: 'api_call',
    service,
    method,
    duration,
    status,
    ...meta
  });
};

/**
 * User action logging
 */
logger.userAction = (userId, action, meta = {}) => {
  logger.info(`User Action [${userId}]: ${action}`, {
    type: 'user_action',
    userId,
    action,
    ...meta
  });
};

/**
 * Database query logging (development only)
 */
if (process.env.NODE_ENV === 'development') {
  logger.db = (query, duration, meta = {}) => {
    logger.debug(`DB Query (${duration}ms): ${query}`, {
      type: 'database',
      query,
      duration,
      ...meta
    });
  };
}

/**
 * Get logs (for admin dashboard)
 */
logger.getLogs = async (options = {}) => {
  const { level = 'error', limit = 100, offset = 0 } = options;
  
  return new Promise((resolve, reject) => {
    const logFile = path.join(logDir, `${level}.log`);
    
    if (!fs.existsSync(logFile)) {
      return resolve([]);
    }

    fs.readFile(logFile, 'utf8', (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      const logs = data
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return { message: line };
          }
        })
        .reverse()
        .slice(offset, offset + limit);

      resolve(logs);
    });
  });
};

/**
 * Clear old logs
 */
logger.clearOldLogs = (daysToKeep = 7) => {
  const files = fs.readdirSync(logDir);
  const now = Date.now();
  
  files.forEach(file => {
    const filePath = path.join(logDir, file);
    const stats = fs.statSync(filePath);
    const ageInDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    
    if (ageInDays > daysToKeep) {
      fs.unlinkSync(filePath);
      logger.info(`Deleted old log file: ${file}`);
    }
  });
};

module.exports = logger;