const express = require('express');
const { body } = require('express-validator');
const jwt = require('jsonwebtoken'); // Add this import
const router = express.Router();

// Import controllers
const authController = require('../controllers/authController');

// Import middleware
const { validate } = require('../middleware/validator');
const { protect } = require('../middleware/auth');

/**
 * @route   POST /api/auth/signup
 * @desc    Register a new user
 * @access  Public
 */
router.post(
  '/signup',
  [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').isEmail().withMessage('Please provide a valid email').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  validate,
  authController.signup
);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Please provide a valid email').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required')
  ],
  validate,
  authController.login
);

/**
 * @route   GET /api/auth/test-jwt
 * @desc    Test JWT generation and verification
 * @access  Public
 */
router.get('/test-jwt', (req, res) => {
  console.log('=== JWT TEST ENDPOINT HIT ===');
  try {
    // Check if JWT_SECRET exists
    if (!process.env.JWT_SECRET) {
      console.log('JWT_SECRET is MISSING');
      return res.status(500).json({
        success: false,
        message: 'JWT_SECRET is not defined in environment variables',
        env_check: {
          jwt_secret_exists: false,
          node_env: process.env.NODE_ENV
        }
      });
    }

    console.log('JWT_SECRET exists with length:', process.env.JWT_SECRET.length);
    
    // Test JWT generation
    const testToken = jwt.sign(
      { id: 'test-user-id', test: true }, 
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    console.log('Test token generated successfully');
    console.log('Token preview:', testToken.substring(0, 30) + '...');
    console.log('Token parts:', testToken.split('.').length);

    // Test JWT verification
    const decoded = jwt.verify(testToken, process.env.JWT_SECRET);
    console.log('Token verified successfully');
    console.log('Decoded payload:', decoded);

    res.json({
      success: true,
      message: 'JWT is working correctly',
      debug_info: {
        jwt_secret: {
          exists: true,
          length: process.env.JWT_SECRET.length,
          preview: process.env.JWT_SECRET.substring(0, 3) + '...' + process.env.JWT_SECRET.slice(-3)
        },
        node_env: process.env.NODE_ENV,
        token: {
          preview: testToken.substring(0, 30) + '...',
          length: testToken.length,
          parts: testToken.split('.').length
        },
        decoded: decoded
      }
    });
  } catch (error) {
    console.error('JWT test failed:', error);
    res.status(500).json({
      success: false,
      message: 'JWT test failed',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      env_check: {
        jwt_secret_exists: !!process.env.JWT_SECRET,
        jwt_secret_length: process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 0,
        node_env: process.env.NODE_ENV
      }
    });
  }
});

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Send password reset email
 * @access  Public
 */
router.post(
  '/forgot-password',
  [
    body('email').isEmail().withMessage('Please provide a valid email').normalizeEmail()
  ],
  validate,
  authController.forgotPassword
);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Token is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  validate,
  authController.resetPassword
);

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.post(
  '/change-password',
  protect,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
  ],
  validate,
  authController.changePassword
);

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me', protect, authController.getMe);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', protect, authController.logout);

module.exports = router;
