const mongoose = require('mongoose');

const NoteSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  uploadId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: [true, 'Please provide a title'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  summary: {
    type: String,
    required: [true, 'Please provide a summary'],
    maxlength: [50000, 'Summary cannot exceed 50000 characters']
  },
  pages: {
    type: Number,
    min: 1,
    default: 1
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  category: {
    type: String,
    trim: true,
    lowercase: true,
    default: 'uncategorized'
  },
  isFavorite: {
    type: Boolean,
    default: false
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  pdfUrl: {
    type: String,
    required: true
  },
  pdfPublicId: String,
  audioUrl: {
    type: String,
    required: true
  },
  audioPublicId: String,
  audioDuration: {
    type: String,
    default: '0:00'
  },
  audioSize: Number,
  plays: {
    type: Number,
    default: 0
  },
  downloads: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  metadata: {
    originalName: String,
    fileSize: Number,
    wordCount: Number,
    characterCount: Number,
    processingTime: Number,
    modelUsed: {
      type: String,
      default: 'gemini-2.5-flash'
    },
    language: {
      type: String,
      default: 'en'
    }
  },
  highlights: [{
    text: String,
    color: {
      type: String,
      enum: ['yellow', 'green', 'blue', 'pink'],
      default: 'yellow'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  comments: [{
    text: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  sharedWith: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    permission: {
      type: String,
      enum: ['view', 'edit'],
      default: 'view'
    },
    sharedAt: {
      type: Date,
      default: Date.now
    }
  }],
  source: {
    type: String,
    enum: ['upload', 'shared', 'sample'],
    default: 'upload'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for reading time (minutes)
NoteSchema.virtual('readingTime').get(function() {
  const wordsPerMinute = 200;
  const wordCount = this.metadata.wordCount || this.summary.split(/\s+/).length;
  return Math.ceil(wordCount / wordsPerMinute);
});

// Virtual for short preview
NoteSchema.virtual('preview').get(function() {
  return this.summary.length > 200 
    ? this.summary.substring(0, 200) + '...' 
    : this.summary;
});

// Update stats when note is played
NoteSchema.methods.incrementPlays = async function() {
  this.plays += 1;
  return this.save();
};

// Update stats when note is downloaded
NoteSchema.methods.incrementDownloads = async function() {
  this.downloads += 1;
  return this.save();
};

// Add highlight
NoteSchema.methods.addHighlight = function(text, color = 'yellow') {
  this.highlights.push({ text, color });
  return this.save();
};

// Remove highlight
NoteSchema.methods.removeHighlight = function(highlightId) {
  this.highlights = this.highlights.filter(h => h._id.toString() !== highlightId);
  return this.save();
};

// Add comment
NoteSchema.methods.addComment = function(text) {
  this.comments.push({ text });
  return this.save();
};

// Share with user
NoteSchema.methods.shareWith = function(userId, permission = 'view') {
  // Check if already shared
  const existing = this.sharedWith.find(
    s => s.user.toString() === userId.toString()
  );
  
  if (existing) {
    existing.permission = permission;
  } else {
    this.sharedWith.push({ user: userId, permission });
  }
  
  return this.save();
};

// Indexes for better query performance
NoteSchema.index({ user: 1, createdAt: -1 });
NoteSchema.index({ user: 1, isFavorite: 1 });
NoteSchema.index({ user: 1, tags: 1 });
NoteSchema.index({ user: 1, category: 1 });
NoteSchema.index({ title: 'text', summary: 'text', tags: 'text' });

// Compound indexes for common queries
NoteSchema.index({ user: 1, isArchived: 1, createdAt: -1 });
NoteSchema.index({ user: 1, 'metadata.language': 1 });

module.exports = mongoose.model('Note', NoteSchema);
