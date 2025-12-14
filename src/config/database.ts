import mongoose from 'mongoose';
import { config } from './environment';
import { logger } from '@/utils/logger';

let isConnecting = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

export async function connectDatabase(): Promise<void> {
  if (isConnecting) {
    logger.info('Database connection already in progress...');
    return;
  }

  if (mongoose.connection.readyState === 1) {
    logger.info('Database already connected');
    return;
  }

  isConnecting = true;

  try {
    await mongoose.connect(config.mongodb.uri, {
      ...config.mongodb.options,
      bufferCommands: false,
    });

    logger.info('✅ Connected to MongoDB');
    connectionRetries = 0;
    isConnecting = false;

    // Handle connection events
    mongoose.connection.on('error', error => {
      logger.error('MongoDB connection error:', error);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
      if (!isConnecting && connectionRetries < MAX_RETRIES) {
        setTimeout(() => {
          logger.info('Attempting to reconnect to MongoDB...');
          connectDatabase();
        }, RETRY_DELAY);
      }
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
      connectionRetries = 0;
    });

    mongoose.connection.on('connecting', () => {
      logger.info('Connecting to MongoDB...');
    });
  } catch (error) {
    isConnecting = false;
    connectionRetries++;

    logger.error(
      `Failed to connect to MongoDB (attempt ${connectionRetries}/${MAX_RETRIES}):`,
      error
    );

    if (connectionRetries < MAX_RETRIES) {
      logger.info(`Retrying connection in ${RETRY_DELAY / 1000} seconds...`);
      setTimeout(() => {
        connectDatabase();
      }, RETRY_DELAY);
    } else {
      logger.error('Max connection retries reached. Database connection failed.');
      throw error;
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  } catch (error) {
    logger.error('Error disconnecting from MongoDB:', error);
    throw error;
  }
}
