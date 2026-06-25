/**
 * @desc    Update user privileges (toggle ON/OFF premium access)
 * @route   PUT /api/admin/users/:userId/privileges
 * @access  Private (Admin only)
 */
exports.updateUserPrivileges = async (req, res) => {
  try {
    const { userId } = req.params;
    const { featuresUnlocked } = req.body;
    
    const user = await User.findById(userId)
      .select('-password -resetPasswordToken -resetPasswordExpire');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Update admin override
    user.adminOverrides.featuresUnlocked = featuresUnlocked === true || featuresUnlocked === 'true';
    
    await user.save();
    
    // Get user's notes stats
    const notes = await Note.find({ user: userId });
    
    const totalDownloads = notes.reduce((sum, note) => sum + (note.downloads || 0), 0);
    const totalStreams = notes.reduce((sum, note) => sum + (note.plays || 0), 0);
    const totalSummaries = notes.length;
    
    res.status(200).json({
      success: true,
      message: featuresUnlocked ? 'Premium access granted' : 'Premium access revoked',
      user: {
        ...user.toObject(),
        totalDownloads,
        totalStreams,
        totalSummaries
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
