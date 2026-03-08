const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Protect routes - verify JWT token
 */
exports.protect = async (req, res, next) => {
  try {
    let token;

    // Check Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Check cookie (if using cookies)
    else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from token
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if user is active
      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account has been deactivated'
        });
      }

      // Update last active
      user.stats.lastActive = Date.now();
      await user.save();

      // Attach user to request
      req.user = user;
      next();
    } catch (error) {
      logger.error('Token verification error:', error);
      
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token'
        });
      }
      
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired'
        });
      }

      throw error;
    }
  } catch (error) {
    logger.error('Auth middleware error:', error);
    next(error);
  }
};

/**
 * Authorize roles
 * @param  {...string} roles - Allowed roles
 */
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role ${req.user.role} is not authorized to access this route`
      });
    }

    next();
  };
};

/**
 * Optional authentication - doesn't require token but attaches user if present
 */
exports.optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        
        if (user && user.isActive) {
          req.user = user;
        }
      } catch (error) {
        // Silent fail - just don't attach user
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Check subscription
 */
exports.checkSubscription = (requiredPlan = 'free') => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      // Admin bypass
      if (user.role === 'admin') {
        return next();
      }

      const planPriority = {
        'free': 1,
        'basic': 2,
        'premium': 3
      };

      const userPlan = user.subscription.plan;
      const requiredPriority = planPriority[requiredPlan] || 1;
      const userPriority = planPriority[userPlan] || 1;

      if (userPriority < requiredPriority) {
        return res.status(403).json({
          success: false,
          message: `This feature requires ${requiredPlan} subscription or higher`
        });
      }

      // Check if subscription is valid
      if (user.subscription.validUntil && user.subscription.validUntil < Date.now()) {
        return res.status(403).json({
          success: false,
          message: 'Subscription has expired'
        });
      }

      next();
    } catch (error) {
      logger.error('Subscription check error:', error);
      next(error);
    }
  };
};

/**
 * Rate limit based on user role/subscription
 */
exports.userRateLimit = (options = {}) => {
  const { windowMs = 15 * 60 * 1000, maxRequests = 100 } = options;

  // Store request counts (in production, use Redis)
  const requestCounts = new Map();

  return (req, res, next) => {
    const userId = req.user ? req.user.id : req.ip;
    const now = Date.now();

    // Clean up old entries
    if (requestCounts.size > 10000) {
      for (const [key, data] of requestCounts.entries()) {
        if (now - data.windowStart > windowMs) {
          requestCounts.delete(key);
        }
      }
    }

    // Get or create request data
    let requestData = requestCounts.get(userId);
    
    if (!requestData || now - requestData.windowStart > windowMs) {
      requestData = {
        windowStart: now,
        count: 1
      };
    } else {
      requestData.count += 1;
    }

    requestCounts.set(userId, requestData);

    // Check if over limit
    if (requestData.count > maxRequests) {
      const resetTime = new Date(requestData.windowStart + windowMs);
      return res.status(429).json({
        success: false,
        message: 'Too many requests',
        resetAt: resetTime
      });
    }

    next();
  };
};