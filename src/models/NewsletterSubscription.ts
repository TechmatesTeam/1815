import mongoose, { Document, Schema } from 'mongoose';
import { isValidEmail } from '@/utils/validation';

export interface INewsletterSubscriptionDocument extends Document {
  email: string;
  subscriptionTypes: {
    featureUpdates: boolean;
    generalNews: boolean;
  };
  isActive: boolean;
  unsubscribeToken: string;
  subscribedAt: Date;
  lastEmailSent?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface INewsletterSubscriptionModel extends mongoose.Model<INewsletterSubscriptionDocument> {
  findByUnsubscribeToken(
    token: string
  ): mongoose.Query<INewsletterSubscriptionDocument | null, INewsletterSubscriptionDocument>;
}

const NewsletterSubscriptionSchema = new Schema<INewsletterSubscriptionDocument>(
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
    subscriptionTypes: {
      featureUpdates: {
        type: Boolean,
        default: true,
      },
      generalNews: {
        type: Boolean,
        default: false,
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
    subscribedAt: {
      type: Date,
      default: Date.now,
    },
    lastEmailSent: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete (ret as any).__v;
        delete (ret as any).unsubscribeToken;
        return ret;
      },
    },
  }
);

// Indexes for efficient queries
NewsletterSubscriptionSchema.index({ email: 1, isActive: 1 });
NewsletterSubscriptionSchema.index({ 'subscriptionTypes.featureUpdates': 1, isActive: 1 });
NewsletterSubscriptionSchema.index({ 'subscriptionTypes.generalNews': 1, isActive: 1 });

// Pre-save middleware to generate unsubscribe token
NewsletterSubscriptionSchema.pre('save', function (next) {
  if (this.isNew || !this.unsubscribeToken) {
    const crypto = require('crypto');
    this.unsubscribeToken = crypto.randomBytes(32).toString('hex');
  }
  next();
});

// Static method to find subscribers by type
NewsletterSubscriptionSchema.statics.findBySubscriptionType = function (
  type: 'featureUpdates' | 'generalNews'
) {
  return this.find({
    [`subscriptionTypes.${type}`]: true,
    isActive: true,
  });
};

// Static method to find by unsubscribe token
NewsletterSubscriptionSchema.statics.findByUnsubscribeToken = function (token: string) {
  return this.findOne({
    unsubscribeToken: token,
    isActive: true,
  });
};

export const NewsletterSubscription = mongoose.model<
  INewsletterSubscriptionDocument,
  INewsletterSubscriptionModel
>('NewsletterSubscription', NewsletterSubscriptionSchema);
