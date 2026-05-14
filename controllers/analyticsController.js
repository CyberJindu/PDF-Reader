const User = require('../models/User');
const Note = require('../models/Note');
const Analytics = require('../models/Analytics');

/**
 * @desc    Get dashboard metrics
 * @route   GET /api/analytics/dashboard
 * @access  Private (Admin only)
 */
exports.getDashboardMetrics = async (req, res) => {
  try {
    const { timeRange = 'weekly' } = req.query;
    
    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch (timeRange) {
      case 'daily':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(now.getMonth() - 1);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }
    
    // Get total users
    const totalUsers = await User.countDocuments({ role: 'user' });
    
    // Get total downloads and summaries from notes - FIXED AGGREGATION
    const notesAgg = await Note.aggregate([
      {
        $group: {
          _id: null,
          totalDownloads: { $sum: '$downloads' },
          totalSummaries: { $sum: 1 },  // FIXED: $sum: 1 instead of $count: {}
          totalPlays: { $sum: '$plays' }  // ADDED: Get total audio streams from notes
        }
      }
    ]);
    
    const totalDownloads = notesAgg[0]?.totalDownloads || 0;
    const totalSummaries = notesAgg[0]?.totalSummaries || 0;
    const totalAudioStreamsFromNotes = notesAgg[0]?.totalPlays || 0;
    
    // Get total audio streams for time range from Analytics collection (if you want time-filtered)
    const audioStreamsData = await Analytics.aggregate([
      {
        $match: {
          action: 'audio_played',
          date: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 }
        }
      }
    ]);
    
    // Use either total from Notes or time-filtered from Analytics
    // For dashboard, let's use total from Notes (all-time) and also show time-filtered
    const totalAudioStreams = totalAudioStreamsFromNotes;  // All-time total
    
    // Get premium vs general users
    const premiumUsers = await User.countDocuments({ 
      'subscription.plan': 'premium',
      role: 'user'
    });
    
    const generalUsers = totalUsers - premiumUsers;
    
    // Get usage trends for chart - UPDATED to include audio_played
    const usageTrends = await getUsageTrendsData(startDate, timeRange);
    
    res.status(200).json({
      success: true,
      totalUsers,
      totalDownloads,
      totalSummaries,
      totalAudioStreams,
      premiumUsers,
      generalUsers,
      usageTrends
    });
  } catch (error) {
    console.error('Dashboard metrics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching dashboard metrics'
    });
  }
};

/**
 * @desc    Get usage trends for charts
 * @route   GET /api/analytics/trends
 * @access  Private (Admin only)
 */
exports.getUsageTrends = async (req, res) => {
  try {
    const { timeRange = 'weekly', chartType = 'line' } = req.query;
    
    const now = new Date();
    let startDate = new Date();
    let groupFormat = {};
    
    switch (timeRange) {
      case 'daily':
        startDate.setDate(now.getDate() - 1);
        groupFormat = { 
          $dateToString: { format: '%H:00', date: '$date' }
        };
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - 7);
        groupFormat = { 
          $dateToString: { format: '%Y-%m-%d', date: '$date' }
        };
        break;
      case 'monthly':
        startDate.setMonth(now.getMonth() - 1);
        groupFormat = { 
          $dateToString: { format: '%Y-%m-%d', date: '$date' }
        };
        break;
      default:
        startDate.setDate(now.getDate() - 7);
        groupFormat = { 
          $dateToString: { format: '%Y-%m-%d', date: '$date' }
        };
    }
    
    const trends = await Analytics.aggregate([
      {
        $match: {
          date: { $gte: startDate },
          action: { $in: ['pdf_upload', 'summary_generated', 'audio_downloaded'] }
        }
      },
      {
        $group: {
          _id: {
            date: groupFormat,
            action: '$action'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          uploads: {
            $sum: {
              $cond: [{ $eq: ['$_id.action', 'pdf_upload'] }, '$count', 0]
            }
          },
          summaries: {
            $sum: {
              $cond: [{ $eq: ['$_id.action', 'summary_generated'] }, '$count', 0]
            }
          },
          downloads: {
            $sum: {
              $cond: [{ $eq: ['$_id.action', 'audio_downloaded'] }, '$count', 0]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Format data for chart
    const formattedData = trends.map(item => ({
      name: item._id,
      uploads: item.uploads || 0,
      summaries: item.summaries || 0,
      downloads: item.downloads || 0
    }));
    
    res.status(200).json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    console.error('Usage trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching usage trends'
    });
  }
};

/**
 * @desc    Get total audio streams
 * @route   GET /api/analytics/audio-streams
 * @access  Private (Admin only)
 */
exports.getAudioStreams = async (req, res) => {
  try {
    const { timeRange = 'weekly' } = req.query;
    
    const now = new Date();
    let startDate = new Date();
    
    switch (timeRange) {
      case 'daily':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(now.getMonth() - 1);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }
    
    // Get total plays from Note model (all-time)
    const totalPlaysAgg = await Note.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$plays' }
        }
      }
    ]);
    
    const allTimeTotal = totalPlaysAgg[0]?.total || 0;
    
    // Get time-filtered plays if Analytics collection has data
    const timeFilteredResult = await Analytics.aggregate([
      {
        $match: {
          action: 'audio_played',
          date: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 }
        }
      }
    ]);
    
    const timeFilteredTotal = timeFilteredResult[0]?.total || 0;
    
    res.status(200).json({
      success: true,
      total: allTimeTotal,  // Send all-time total
      timeFilteredTotal,    // Optional: send filtered total
      timeRange
    });
  } catch (error) {
    console.error('Audio streams error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching audio streams'
    });
  }
};

/**
 * @desc    Get conversion rate (Premium vs General users)
 * @route   GET /api/analytics/conversion-rate
 * @access  Private (Admin only)
 */
exports.getConversionRate = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const premiumUsers = await User.countDocuments({ 
      'subscription.plan': 'premium',
      role: 'user'
    });
    const generalUsers = totalUsers - premiumUsers;
    const rate = totalUsers > 0 ? (premiumUsers / totalUsers) * 100 : 0;
    
    res.status(200).json({
      success: true,
      premiumUsers,
      generalUsers,
      totalUsers,
      rate: rate.toFixed(1)
    });
  } catch (error) {
    console.error('Conversion rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching conversion rate'
    });
  }
};

// Helper function to get usage trends data
async function getUsageTrendsData(startDate, timeRange) {
  const trends = await Analytics.aggregate([
    {
      $match: {
        date: { $gte: startDate },
        action: { $in: ['pdf_upload', 'summary_generated', 'audio_downloaded', 'audio_played'] }
      }
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          action: '$action'
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.date',
        uploads: {
          $sum: {
            $cond: [{ $eq: ['$_id.action', 'pdf_upload'] }, '$count', 0]
          }
        },
        summaries: {
          $sum: {
            $cond: [{ $eq: ['$_id.action', 'summary_generated'] }, '$count', 0]
          }
        },
        downloads: {
          $sum: {
            $cond: [{ $eq: ['$_id.action', 'audio_downloaded'] }, '$count', 0]
          }
        },
        streams: {
          $sum: {
            $cond: [{ $eq: ['$_id.action', 'audio_played'] }, '$count', 0]
          }
        }
      }
    },
    { $sort: { _id: 1 } }
  ]);
  
  return trends.map(item => ({
    name: item._id,
    uploads: item.uploads || 0,
    summaries: item.summaries || 0,
    downloads: item.downloads || 0,
    streams: item.streams || 0
  }));
}
