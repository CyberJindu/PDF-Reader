const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * MongoDB connection utility
 * Handles connection events and reconnection logic
 */
class MongoDBConnection {
  constructor() {
    this.connection = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 5000; // 5 seconds
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        autoIndex: process.env.NODE_ENV === 'development',
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4
      };

      this.connection = await mongoose.connect(process.env.MONGODB_URI, options);
      
      this.reconnectAttempts = 0;
      logger.info('MongoDB connected successfully');
      
      this.setupEventHandlers();
      
      return this.connection;
    } catch (error) {
      logger.error('MongoDB connection error:', error);
      this.handleConnectionError();
    }
  }

  /**
   * Setup mongoose connection event handlers
   */
  setupEventHandlers() {
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
      this.handleDisconnect();
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
      this.reconnectAttempts = 0;
    });

    mongoose.connection.on('error', (error) => {
      logger.error('MongoDB error:', error);
    });

    // Graceful shutdown
    process.on('SIGINT', this.gracefulShutdown.bind(this));
    process.on('SIGTERM', this.gracefulShutdown.bind(this));
  }

  /**
   * Handle connection errors with retry logic
   */
  handleConnectionError() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      logger.info(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
      
      setTimeout(() => {
        this.connect();
      }, this.reconnectInterval * this.reconnectAttempts);
    } else {
      logger.error('Max reconnection attempts reached. Exiting...');
      process.exit(1);
    }
  }

  /**
   * Handle disconnection
   */
  handleDisconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      logger.info(`Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      setTimeout(() => {
        this.connect();
      }, this.reconnectInterval);
    }
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown() {
    try {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed through app termination');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Check connection status
   */
  isConnected() {
    return mongoose.connection.readyState === 1;
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    
    return {
      state: states[mongoose.connection.readyState],
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name
    };
  }
}

// Export singleton instance
module.exports = new MongoDBConnection();