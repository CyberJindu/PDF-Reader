const mongoose = require('mongoose');

const AnalyticsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    enum: [
      'pdf_upload',
      'summary_generated',
      'summary_viewed_full',
      'summary_viewed_preview',
      'audio_played',
      'audio_downloaded',
      'pdf_downloaded',
      'login'
    ],
    required: true
  },
  metadata: {
    noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
    summaryLength: Number,
    audioDuration: Number,
    fileSize: Number,
    ipAddress: String,
    userAgent: String
  },
  date: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Indexes for faster queries
AnalyticsSchema.index({ userId: 1, date: -1 });
AnalyticsSchema.index({ action: 1, date: -1 });
AnalyticsSchema.index({ date: -1 });

module.exports = mongoose.model('Analytics', AnalyticsSchema);
