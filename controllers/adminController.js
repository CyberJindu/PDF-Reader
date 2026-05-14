const User = require('../models/User');
const Note = require('../models/Note');

/**
 * @desc    Get all users
 * @route   GET /api/admin/users
 * @access  Private (Admin only)
 */
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ role: 'user' })
      .select('-password -resetPasswordToken -resetPasswordExpire')
      .sort({ createdAt: -1 });

    // Calculate additional stats for each user
    const usersWithStats = await Promise.all(users.map(async (user) => {
      // Get user's notes stats
      const notes = await Note.find({ user: user._id });
      
      const totalSummariesCount = notes.length;
      const totalDownloadsCount = notes.reduce((sum, note) => sum + (note.downloads || 0), 0);
      const totalStreamsCount = notes.reduce((sum, note) => sum + (note.plays || 0), 0);
      
      return {
        ...user.toObject(),
        totalSummaries: totalSummariesCount,
        totalDownloads: totalDownloadsCount,
        totalStreams: totalStreamsCount
      };
    }));

    res.status(200).json({
      success: true,
      count: usersWithStats.length,
      users: usersWithStats
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching users',
      error: error.message
    });
  }
};

/**
 * @desc    Get user details
 * @route   GET /api/admin/users/:userId
 * @access  Private (Admin only)
 */
exports.getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId)
      .select('-password -resetPasswordToken -resetPasswordExpire');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Get user's notes stats
    const notes = await Note.find({ user: userId });
    
    const totalDownloads = notes.reduce((sum, note) => sum + (note.downloads || 0), 0);
    const totalStreams = notes.reduce((sum, note) => sum + (note.plays || 0), 0);
    const totalSummaries = notes.length;
    
    res.status(200).json({
      success: true,
      user: {
        ...user.toObject(),
        totalDownloads,
        totalStreams,
        totalSummaries
      }
    });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching user details'
    });
  }
};

/**
 * @desc    Update user privileges (toggle ON/OFF all features)
 * @route   PUT /api/admin/users/:userId/privileges
 * @access  Private (Admin only)
 */
exports.updateUserPrivileges = async (req, res) => {
  try {
    const { userId } = req.params;
    const { featuresUnlocked } = req.body;
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Update admin overrides
    user.adminOverrides = {
      ...user.adminOverrides,
      featuresUnlocked: featuresUnlocked === true || featuresUnlocked === 'true'
    };
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: featuresUnlocked ? 'User features unlocked' : 'User features locked',
      user: {
        id: user._id,
        email: user.email,
        adminOverrides: user.adminOverrides
      }
    });
  } catch (error) {
    console.error('Update user privileges error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating user privileges'
    });
  }
};

/**
 * @desc    Get user stats
 * @route   GET /api/admin/users/:userId/stats
 * @access  Private (Admin only)
 */
exports.getUserStats = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const notes = await Note.find({ user: userId });
    
    const stats = {
      totalSummaries: notes.length,
      totalDownloads: notes.reduce((sum, note) => sum + (note.downloads || 0), 0),
      totalStreams: notes.reduce((sum, note) => sum + (note.plays || 0), 0),
      totalUploads: user.stats?.totalUploads || 0,
      totalAudioMinutes: user.stats?.totalAudioMinutes || 0,
      lastActive: user.stats?.lastActive || user.lastLogin,
      plan: user.subscription?.plan || 'free',
      isPremiumUnlocked: user.adminOverrides?.featuresUnlocked || false,
      dailyAudioPlays: user.dailyLimits?.audioPlaysToday || 0,
      dailyPreviews: user.dailyLimits?.summaryPreviewsToday || 0
    };
    
    res.status(200).json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching user stats'
    });
  }
};

/**
 * @desc    Toggle specific feature for user
 * @route   PATCH /api/admin/users/:userId/features
 * @access  Private (Admin only)
 */
exports.toggleUserFeature = async (req, res) => {
  try {
    const { userId } = req.params;
    const { feature, enabled } = req.body;
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Handle different features
    switch (feature) {
      case 'featuresUnlocked':
        user.adminOverrides.featuresUnlocked = enabled;
        break;
      case 'forcePremium':
        user.adminOverrides.forcePremium = enabled;
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid feature specified'
        });
    }
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: `Feature ${feature} ${enabled ? 'enabled' : 'disabled'}`,
      user: {
        id: user._id,
        email: user.email,
        adminOverrides: user.adminOverrides
      }
    });
  } catch (error) {
    console.error('Toggle user feature error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error toggling feature'
    });
  }
};

/**
 * @desc    Deactivate user
 * @route   DELETE /api/admin/users/:userId/deactivate
 * @access  Private (Admin only)
 */
exports.deactivateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    user.isActive = false;
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'User deactivated successfully'
    });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deactivating user'
    });
  }
};
