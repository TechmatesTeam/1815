import mongoose, { Document, Schema } from 'mongoose';
import { isValidEmail, encryptData, decryptData } from '@/utils/validation';

export interface INotificationPreferences {
  aliasExpiry: boolean;
  featureUpdates: boolean;
  ecosystemNews: boolean;
}

export interface IUserDocument extends Document {
  email: string;
  encryptedEmail: string;
  notificationPreferences: INotificationPreferences;
  unsubscribeToken: string;
  isActive: boolean;
  lastNotificationSent?: Date;
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  getDecryptedEmail(): string;
  generateUnsubscribeToken(): string;
}

export interface IUserModel extends mongoose.Model<IUserDocument> {
  findExpiryNotificationUsers(): mongoose.Query<IUserDocument[], IUserDocument>;
  findFeatureUpdateUsers(): mongoose.Query<IUserDocument[], IUserDocument>;
  findByUnsubscribeToken(token: string): mongoose.Query<IUserDocument | null, IUserDocument>;
}

const NotificationPreferencesSchema = new Schema<INotificationPreferences>(
  {
    aliasExpiry: {
      type: Boolean,
      default: true,
    },
    featureUpdates: {
      type: Boolean,
      default: false,
    },
    ecosystemNews: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const UserSchema = new Schema<IUserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: isValidEmail,
        message: 'Invalid email address format',
      },
    },
    encryptedEmail: {
      type: String,
    },
    notificationPreferences: {
      type: NotificationPreferencesSchema,
      default: () => ({
        aliasExpiry: true,
        featureUpdates: false,
        ecosystemNews: false,
      }),
    },
    unsubscribeToken: {
      type: String,
      unique: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastNotificationSent: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete (ret as any).encryptedEmail;
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

// Index for efficient queries
UserSchema.index({ email: 1, isActive: 1 });
UserSchema.index({ 'notificationPreferences.aliasExpiry': 1, isActive: 1 });

// Pre-save middleware to encrypt email
UserSchema.pre('save', function (next) {
  if (this.isNew || this.isModified('email')) {
    try {
      this.encryptedEmail = encryptData(this.email);
    } catch (error) {
      return next(error as any);
    }
  }
  next();
});

// Pre-save middleware to generate unsubscribe token
UserSchema.pre('save', function (next) {
  if (this.isNew || !this.unsubscribeToken) {
    const crypto = require('crypto');
    this.unsubscribeToken = crypto.randomBytes(32).toString('hex');
  }
  next();
});

// Instance method to get decrypted email
UserSchema.methods.getDecryptedEmail = function (): string {
  try {
    return decryptData(this.encryptedEmail);
  } catch (error) {
    throw new Error('Failed to decrypt email');
  }
};

// Instance method to generate unsubscribe token
UserSchema.methods.generateUnsubscribeToken = function (): string {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
};

// Static method to find users who want expiry notifications
UserSchema.statics.findExpiryNotificationUsers = function () {
  return this.find({
    isActive: true,
    'notificationPreferences.aliasExpiry': true,
  });
};

// Static method to find users who want feature update notifications
UserSchema.statics.findFeatureUpdateUsers = function () {
  return this.find({
    isActive: true,
    'notificationPreferences.featureUpdates': true,
  });
};

// Static method to find user by unsubscribe token
UserSchema.statics.findByUnsubscribeToken = function (token: string) {
  return this.findOne({
    unsubscribeToken: token,
    isActive: true,
  });
};

export const User = mongoose.model<IUserDocument, IUserModel>('User', UserSchema);
