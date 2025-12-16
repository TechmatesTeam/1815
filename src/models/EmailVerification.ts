import mongoose, { Document, Schema } from 'mongoose';
import { isValidEmail } from '@/utils/validation';

export interface IEmailVerificationDocument extends Document {
  email: string;
  verificationToken: string;
  subscriptionType: 'newsletter' | 'feature_notification';
  subscriptionData: {
    featureUpdates?: boolean;
    generalNews?: boolean;
    featureId?: string;
    featureName?: string;
  };
  isVerified: boolean;
  verifiedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EmailVerificationSchema = new Schema<IEmailVerificationDocument>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: isValidEmail,
        message: 'Invalid email address format',
      },
      index: true,
    },
    verificationToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    subscriptionType: {
      type: String,
      required: true,
      enum: ['newsletter', 'feature_notification'],
      index: true,
    },
    subscriptionData: {
      featureUpdates: {
        type: Boolean,
        default: false,
      },
      generalNews: {
        type: Boolean,
        default: false,
      },
      featureId: {
        type: String,
      },
      featureName: {
        type: String,
      },
    },
    isVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    verifiedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete (ret as any).__v;
        delete (ret as any).verificationToken;
        return ret;
      },
    },
  }
);

// Compound indexes for efficient queries
EmailVerificationSchema.index({ email: 1, subscriptionType: 1 });
EmailVerificationSchema.index({ verificationToken: 1, isVerified: 1 });
EmailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save middleware to generate verification token and set expiry
EmailVerificationSchema.pre('save', function (next) {
  if (this.isNew) {
    const crypto = require('crypto');

    // Always generate verification token for new documents
    this.verificationToken = crypto.randomBytes(32).toString('hex');

    // Always set expiry to 24 hours from now for new documents
    this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  next();
});

// Static method to find by verification token
EmailVerificationSchema.statics.findByToken = function (token: string) {
  return this.findOne({
    verificationToken: token,
    isVerified: false,
    expiresAt: { $gt: new Date() },
  });
};

// Static method to cleanup expired tokens
EmailVerificationSchema.statics.cleanupExpired = function () {
  return this.deleteMany({
    expiresAt: { $lt: new Date() },
  });
};

export const EmailVerification = mongoose.model<IEmailVerificationDocument>(
  'EmailVerification',
  EmailVerificationSchema
);
