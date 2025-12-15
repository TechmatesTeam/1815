import mongoose, { Document, Schema } from 'mongoose';
import { isValidCardanoAddress, isValidEmail } from '@/utils/validation';

export interface IAliasDocument extends Document {
  shortCode: string;
  cardanoAddress: string;
  customName?: string;
  userEmail?: string;
  expiresAt: Date;
  isActive: boolean;
  useCount: number;
  qrCodeUrl?: string;
  notificationSent: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;

  // Instance methods
  isExpired(): boolean;
  incrementUseCount(): Promise<void>;
}

export interface IAliasModel extends mongoose.Model<IAliasDocument> {
  findActive(filter?: any): mongoose.Query<IAliasDocument[], IAliasDocument>;
  findExpired(): mongoose.Query<IAliasDocument[], IAliasDocument>;
  deactivateExpired(): Promise<number>;
}

const AliasSchema = new Schema<IAliasDocument>(
  {
    shortCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 6,
      maxlength: 16,
      match: /^[a-zA-Z0-9]+$/,
      index: true,
    },
    cardanoAddress: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: isValidCardanoAddress,
        message: 'Invalid Cardano address format',
      },
      index: true,
    },
    customName: {
      type: String,
      trim: true,
      maxlength: 50,
      match: /^[a-zA-Z0-9\s\-_]+$/,
    },
    userEmail: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (email: string) {
          return !email || isValidEmail(email);
        },
        message: 'Invalid email address format',
      },
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      validate: {
        validator: function (date: Date) {
          return date > new Date();
        },
        message: 'Expiry date must be in the future',
      },
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    useCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    qrCodeUrl: {
      type: String,
      trim: true,
    },
    notificationSent: {
      type: Boolean,
      default: false,
    },
    lastUsedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

// Compound indexes for efficient queries
AliasSchema.index({ expiresAt: 1, isActive: 1 });
AliasSchema.index({ userEmail: 1, isActive: 1 });
AliasSchema.index({ cardanoAddress: 1, isActive: 1 });
AliasSchema.index({ createdAt: -1 });

// Pre-save middleware to ensure shortCode uniqueness
AliasSchema.pre('save', async function (next) {
  if (this.isNew || this.isModified('shortCode')) {
    const AliasModel = this.constructor as IAliasModel;
    const existingAlias = await AliasModel.findOne({
      shortCode: this.shortCode,
      _id: { $ne: this._id },
    });

    if (existingAlias) {
      const error = new Error('Short code already exists') as any;
      error.name = 'ValidationError';
      return next(error);
    }
  }
  next();
});

// Instance method to check if alias is expired
AliasSchema.methods.isExpired = function (): boolean {
  return this.expiresAt <= new Date();
};

// Instance method to increment use count
AliasSchema.methods.incrementUseCount = async function (): Promise<void> {
  this.useCount += 1;
  this.lastUsedAt = new Date();
  await this.save();
};

// Static method to find active aliases
AliasSchema.statics.findActive = function (filter: any = {}) {
  return this.find({
    ...filter,
    isActive: true,
    expiresAt: { $gt: new Date() },
  });
};

// Static method to find expired aliases
AliasSchema.statics.findExpired = function () {
  return this.find({
    isActive: true,
    expiresAt: { $lte: new Date() },
  });
};

// Static method to deactivate expired aliases
AliasSchema.statics.deactivateExpired = async function () {
  const result = await this.updateMany(
    {
      isActive: true,
      expiresAt: { $lte: new Date() },
    },
    {
      $set: { isActive: false },
    }
  );

  return result.modifiedCount;
};

export const Alias = mongoose.model<IAliasDocument, IAliasModel>('Alias', AliasSchema);
