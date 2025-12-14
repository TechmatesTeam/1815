import dotenv from 'dotenv';
import { CorsOptions } from 'cors';

// Load environment variables
dotenv.config();

interface Config {
  nodeEnv: string;
  port: number;
  mongodb: {
    uri: string;
    options: {
      maxPoolSize: number;
      minPoolSize: number;
      maxIdleTimeMS: number;
      serverSelectionTimeoutMS: number;
    };
  };
  redis: {
    url: string;
    options: {
      maxRetriesPerRequest: number;
      retryDelayOnFailover: number;
    };
  };
  blockfrost: {
    apiKey: string;
    baseUrl: string;
    network: 'mainnet' | 'testnet';
  };
  email: {
    useMailhog: boolean;
    sendgrid: {
      apiKey: string;
      fromEmail: string;
      fromName: string;
    };
    mailhog: {
      host: string;
      port: number;
    };
  };
  aws: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    s3Bucket: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  encryption: {
    key: string;
    algorithm: string;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
  cors: CorsOptions;
  qrCode: {
    baseUrl: string;
    size: number;
    margin: number;
  };
}

const requiredEnvVars = [
  'MONGODB_URI',
  'REDIS_URL',
  'BLOCKFROST_API_KEY',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
];

// Conditionally require SendGrid API key if not using MailHog
const useMailhog = process.env.USE_MAILHOG === 'true';
if (!useMailhog) {
  requiredEnvVars.push('SENDGRID_API_KEY');
}

// Validate required environment variables
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

export const config: Config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  mongodb: {
    uri: process.env.MONGODB_URI!,
    options: {
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10', 10),
      minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || '2', 10),
      maxIdleTimeMS: parseInt(process.env.MONGODB_MAX_IDLE_TIME_MS || '30000', 10),
      serverSelectionTimeoutMS: parseInt(
        process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || '5000',
        10
      ),
    },
  },

  redis: {
    url: process.env.REDIS_URL!,
    options: {
      maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
      retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY || '100', 10),
    },
  },

  blockfrost: {
    apiKey: process.env.BLOCKFROST_API_KEY!,
    baseUrl: process.env.BLOCKFROST_BASE_URL || 'https://cardano-mainnet.blockfrost.io/api/v0',
    network: (process.env.BLOCKFROST_NETWORK as 'mainnet' | 'testnet') || 'mainnet',
  },

  email: {
    useMailhog: process.env.USE_MAILHOG === 'true',
    sendgrid: {
      apiKey: process.env.SENDGRID_API_KEY || '',
      fromEmail: process.env.SENDGRID_FROM_EMAIL || 'noreply@1815.dev',
      fromName: process.env.SENDGRID_FROM_NAME || '1815',
    },
    mailhog: {
      host: process.env.MAILHOG_HOST || 'localhost',
      port: parseInt(process.env.MAILHOG_PORT || '1025', 10),
    },
  },

  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region: process.env.AWS_REGION || 'us-east-1',
    s3Bucket: process.env.AWS_S3_BUCKET || '1815-qr-codes',
  },

  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY!,
    algorithm: process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },

  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:3000',
      'http://localhost:5173',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  },

  qrCode: {
    baseUrl: process.env.QR_CODE_BASE_URL || 'https://1815.dev/qr',
    size: parseInt(process.env.QR_CODE_SIZE || '200', 10),
    margin: parseInt(process.env.QR_CODE_MARGIN || '2', 10),
  },
};
