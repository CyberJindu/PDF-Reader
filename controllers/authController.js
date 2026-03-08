const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

/**
 * @desc    Register a new user
 * @route   POST /api/auth/signup
 * @access  Public
 */
exports.signup = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    console.log('=== SIGNUP DEBUG ===');
    console.log('1. Signup attempt for email:', email);
    console.log('2. JWT Secret exists:', !!process.env.JWT_SECRET);
    console.log('3. JWT Secret length:', process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 0);

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log('4. User already exists');
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }
    console.log('4. User does not exist, creating new user');

    // Create new user
    const user = await User.create({
      name,
      email,
      password
    });
    console.log('5. User created with ID:', user._id);

    // Generate token
    console.log('6. Generating token...');
    const token = generateToken(user._id);
    console.log('7. Token generated successfully');
    console.log('8. Token preview:', token.substring(0, 30) + '...');
    console.log('9. Token length:', token.length);

    // Remove password from output
    user.password = undefined;

    console.log('10. Sending response to client');
    console.log('=== END SIGNUP DEBUG ===\n');

    res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      },
      token
    });
  } catch (error) {
    console.error('=== SIGNUP ERROR ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('=== END ERROR ===\n');
    
    logger.error('Signup error:', error);
    next(error);
  }
};

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    console.log('=== LOGIN DEBUG ===');
    console.log('1. Login attempt for email:', email);
    console.log('2. Request body received:', { email: email ? 'provided' : 'missing', password: password ? 'provided' : 'missing' });
    console.log('3. JWT Secret exists:', !!process.env.JWT_SECRET);
    console.log('4. JWT Secret length:', process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 0);
    console.log('5. JWT_EXPIRE value:', process.env.JWT_EXPIRE || '7d (default)');

    // Check if user exists
    console.log('6. Searching for user in database...');
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      console.log('7. User NOT found in database');
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    console.log('7. User found in database:', user.email);
    console.log('8. User ID:', user._id);

    // Check password
    console.log('9. Comparing passwords...');
    const isPasswordMatch = await user.comparePassword(password);
    console.log('10. Password match result:', isPasswordMatch);
    
    if (!isPasswordMatch) {
      console.log('11. Password does NOT match');
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    console.log('11. Password matches successfully');

    // Generate token
    console.log('12. Generating JWT token...');
    const token = generateToken(user._id);
    console.log('13. Token generated successfully');
    console.log('14. Token preview (first 30 chars):', token.substring(0, 30) + '...');
    console.log('15. Full token length:', token.length);
    console.log('16. Token format check - has 3 parts:', token.split('.').length === 3);

    // Remove password from output
    user.password = undefined;

    // Update last login
    user.lastLogin = Date.now();
    await user.save();
    console.log('17. Last login updated');

    console.log('18. Sending successful response to client');
    console.log('19. Response data structure:', {
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      },
      token: token ? 'included' : 'missing'
    });
    console.log('=== END LOGIN DEBUG ===\n');

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      },
      token
    });
  } catch (error) {
    console.error('=== LOGIN ERROR ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error details:', JSON.stringify(error, null, 2));
    console.error('=== END ERROR ===\n');
    
    logger.error('Login error:', error);
    next(error);
  }
};

/**
 * @desc    Forgot password - send reset email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    console.log('=== FORGOT PASSWORD DEBUG ===');
    console.log('Email:', email);

    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found');
      return res.status(404).json({
        success: false,
        message: 'No user found with this email'
      });
    }

    // Generate reset token
    const resetToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET + user.password,
      { expiresIn: '1h' }
    );

    // Save reset token to user
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpire = Date.now() + 3600000; // 1 hour
    await user.save();

    console.log('Reset token generated and saved');

    // In production, send email here
    // For development, return token
    if (process.env.NODE_ENV === 'development') {
      return res.status(200).json({
        success: true,
        message: 'Password reset email sent',
        resetToken // Only in development
      });
    }

    res.status(200).json({
      success: true,
      message: 'Password reset email sent'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    logger.error('Forgot password error:', error);
    next(error);
  }
};

/**
 * @desc    Reset password with token
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    console.log('=== RESET PASSWORD DEBUG ===');

    // Find user with valid token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      console.log('Invalid or expired reset token');
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Update password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    console.log('Password reset successful for user:', user.email);

    res.status(200).json({
      success: true,
      message: 'Password reset successful'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    logger.error('Reset password error:', error);
    next(error);
  }
};

/**
 * @desc    Change user password
 * @route   POST /api/auth/change-password
 * @access  Private
 */
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    console.log('=== CHANGE PASSWORD DEBUG ===');
    console.log('User ID:', userId);

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check current password
    const isPasswordMatch = await user.comparePassword(currentPassword);
    if (!isPasswordMatch) {
      console.log('Current password incorrect');
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    console.log('Password changed successfully');

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    logger.error('Change password error:', error);
    next(error);
  }
};

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    logger.error('Get me error:', error);
    next(error);
  }
};

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 */
exports.logout = (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
};
