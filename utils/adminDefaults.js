const Admin = require('../models/Admin');
const bcrypt = require('bcryptjs');

/**
 * Create default admin account if none exists
 * Run this function when the server starts
 */
async function createDefaultAdmin() {
  try {
    // Check if any admin exists
    const adminCount = await Admin.countDocuments();
    
    if (adminCount === 0) {
      console.log('No admin found. Creating default admin account...');
      
      // Create default admin
      const defaultAdmin = new Admin({
        email: 'admin@pdlisa.com',
        password: 'Admin123!', // Default password - CHANGE THIS AFTER FIRST LOGIN!
        role: 'super_admin',
        isActive: true
      });
      
      await defaultAdmin.save();
      
      console.log('========================================');
      console.log('✅ Default admin account created!');
      console.log('📧 Email: admin@pdlisa.com');
      console.log('🔑 Password: Admin123!');
      console.log('⚠️  PLEASE CHANGE THIS PASSWORD AFTER FIRST LOGIN!');
      console.log('========================================');
    } else {
      console.log(`✅ Admin account exists (${adminCount} admin(s))`);
    }
  } catch (error) {
    console.error('Error creating default admin:', error.message);
  }
}

/**
 * Reset admin password (for emergency use)
 * @param {string} email - Admin email
 * @param {string} newPassword - New password
 */
async function resetAdminPassword(email, newPassword) {
  try {
    const admin = await Admin.findOne({ email });
    
    if (!admin) {
      console.log(`Admin with email ${email} not found`);
      return false;
    }
    
    const salt = await bcrypt.genSalt(12);
    admin.password = await bcrypt.hash(newPassword, salt);
    await admin.save();
    
    console.log(`✅ Password reset for ${email}`);
    return true;
  } catch (error) {
    console.error('Error resetting admin password:', error.message);
    return false;
  }
}

/**
 * Get all admins (for debugging)
 */
async function getAllAdmins() {
  try {
    const admins = await Admin.find().select('-password');
    console.log('Admins:', admins.map(a => ({ email: a.email, role: a.role })));
    return admins;
  } catch (error) {
    console.error('Error fetching admins:', error.message);
    return [];
  }
}

module.exports = {
  createDefaultAdmin,
  resetAdminPassword,
  getAllAdmins
};
