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
 * Check premium access (admin toggle only)
 */
exports.requirePremium = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Admin bypass
    if (user.role === 'admin') {
      return next();
    }

    // Check admin toggle
    if (!user.hasPremiumAccess()) {
      return res.status(403).json({
        success: false,
        message: 'This feature requires a premium subscription',
        code: 'PREMIUM_REQUIRED'
      });
    }

    next();
  } catch (error) {
    logger.error('Premium check error:', error);
    next(error);
  }
};

/**
 * Check if free user has already played audio once
 */
exports.checkAudioPlayLimit = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Admins and premium users bypass
    if (user.role === 'admin' || user.hasPremiumAccess()) {
      return next();
    }

    // Free user — check if they already played audio
    if (user.previewAccess.audioPlayedOnce) {
      return res.status(403).json({
        success: false,
        message: 'You have used your free audio play. Please subscribe to listen again.',
        code: 'PREMIUM_REQUIRED'
      });
    }

    // First play — allow and mark
    user.previewAccess.audioPlayedOnce = true;
    await user.save();

    next();
  } catch (error) {
    logger.error('Audio play limit check error:', error);
    next(error);
  }
};
