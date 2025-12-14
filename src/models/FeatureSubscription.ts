import mongoose, { Document, Schema } from 'mongoose';
import { isValidEmail } from '@/utils/validation';

export interface IFeatureSubscriptionDocument extends Document {
  email: string;
  features: string[];
  isActive: boolean;
  unsubscribeToken: string;
  lastNotificationSent?: Date;
  createdAt: Date;
  updatedAt: Date;

  // Methods
  addFeature(feature: string): void;
  removeFeature(feature: string): void;
  hasFeature(feature: string): boolean;
}

const FeatureSubscriptionSchema = new Schema<IFeatureSubscriptionDocument>(
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
      index: true,
    },
    features: {
      type: [String],
      default: [],
      validate: {
        validator: function (features: string[]) {
          const validFeatures = [
            'alias_management',
            'blockchain_explorer',
            'qr_codes',
            'bulk_operations',
            'analytics',
            'api_updates',
            'security_alerts',
          ];
          return features.every(feature => validFeatures.includes(feature));
        },
        message: 'Invalid feature name',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    unsubscribeToken: {
      type: String,
      required: true,
      unique: true,
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
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

// Indexes for efficient queries
FeatureSubscriptionSchema.index({ email: 1, isActive: 1 });
FeatureSubscriptionSchema.index({ features: 1, isActive: 1 });
FeatureSubscriptionSchema.index({ unsubscribeToken: 1 });

// Pre-save middleware to generate unsubscribe token
FeatureSubscriptionSchema.pre('save', function (next) {
  if (this.isNew || !this.unsubscribeToken) {
    const crypto = require('crypto');
    this.unsubscribeToken = crypto.randomBytes(32).toString('hex');
  }
  next();
});

// Instance method to add a feature
FeatureSubscriptionSchema.methods.addFeature = function (feature: string): void {
  if (!this.features.includes(feature)) {
    this.features.push(feature);
  }
};

// Instance method to remove a feature
FeatureSubscriptionSchema.methods.removeFeature = function (feature: string): void {
  this.features = this.features.filter((f: string) => f !== feature);
};

// Instance method to check if user has subscribed to a feature
FeatureSubscriptionSchema.methods.hasFeature = function (feature: string): boolean {
  return this.features.includes(feature);
};

// Static method to find subscribers for a specific feature
FeatureSubscriptionSchema.statics.findFeatureSubscribers = function (feature: string) {
  return this.find({
    features: feature,
    isActive: true,
  });
};

// Static method to find subscription by unsubscribe token
FeatureSubscriptionSchema.statics.findByUnsubscribeToken = function (token: string) {
  return this.findOne({
    unsubscribeToken: token,
    isActive: true,
  });
};

// Static method to get feature popularity stats
FeatureSubscriptionSchema.statics.getFeatureStats = async function () {
  const pipeline: any[] = [
    {
      $match: { isActive: true },
    },
    {
      $unwind: '$features',
    },
    {
      $group: {
        _id: '$features',
        subscriberCount: { $sum: 1 },
      },
    },
    {
      $sort: { subscriberCount: -1 },
    },
  ];

  return this.aggregate(pipeline);
};

export const FeatureSubscription = mongoose.model<IFeatureSubscriptionDocument>(
  'FeatureSubscription',
  FeatureSubscriptionSchema
);
