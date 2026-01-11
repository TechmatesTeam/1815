import mongoose, { Document, Schema } from 'mongoose';

export interface ISearchHistoryDocument extends Document {
  query: string;
  queryType: 'address' | 'transaction' | 'block' | 'alias' | 'auto';
  resultType?: 'address' | 'transaction' | 'block' | 'alias' | 'not_found';
  ipAddress: string;
  userAgent?: string;
  responseTime: number;
  wasSuccessful: boolean;
  errorMessage?: string;
  cacheHit: boolean;
  createdAt: Date;
}

const SearchHistorySchema = new Schema<ISearchHistoryDocument>(
  {
    query: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      index: true,
    },
    queryType: {
      type: String,
      required: true,
      enum: ['address', 'transaction', 'block', 'alias', 'auto'],
      index: true,
    },
    resultType: {
      type: String,
      enum: ['address', 'transaction', 'block', 'alias', 'not_found'],
      index: true,
    },
    ipAddress: {
      type: String,
      required: true,
      index: true,
    },
    userAgent: {
      type: String,
      maxlength: 500,
    },
    responseTime: {
      type: Number,
      required: true,
      min: 0,
    },
    wasSuccessful: {
      type: Boolean,
      required: true,
      index: true,
    },
    errorMessage: {
      type: String,
      maxlength: 500,
    },
    cacheHit: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform: function (doc, ret) {
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

// Compound indexes for analytics queries
SearchHistorySchema.index({ createdAt: -1 });
SearchHistorySchema.index({ queryType: 1, createdAt: -1 });
SearchHistorySchema.index({ wasSuccessful: 1, createdAt: -1 });
SearchHistorySchema.index({ cacheHit: 1, createdAt: -1 });
SearchHistorySchema.index({ ipAddress: 1, createdAt: -1 });

// TTL index to automatically delete old search history (90 days)
SearchHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Static method to get search analytics
SearchHistorySchema.statics.getAnalytics = async function (startDate: Date, endDate: Date) {
  const pipeline: any[] = [
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: null,
        totalSearches: { $sum: 1 },
        successfulSearches: {
          $sum: { $cond: ['$wasSuccessful', 1, 0] },
        },
        cacheHits: {
          $sum: { $cond: ['$cacheHit', 1, 0] },
        },
        avgResponseTime: { $avg: '$responseTime' },
        queryTypes: {
          $push: '$queryType',
        },
        resultTypes: {
          $push: '$resultType',
        },
      },
    },
  ];

  const result = await this.aggregate(pipeline);
  return (
    result[0] || {
      totalSearches: 0,
      successfulSearches: 0,
      cacheHits: 0,
      avgResponseTime: 0,
      queryTypes: [],
      resultTypes: [],
    }
  );
};

// Static method to get popular queries
SearchHistorySchema.statics.getPopularQueries = async function (
  limit: number = 10,
  days: number = 7
) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const pipeline: any[] = [
    {
      $match: {
        createdAt: { $gte: startDate },
        wasSuccessful: true,
      },
    },
    {
      $group: {
        _id: '$query',
        count: { $sum: 1 },
        lastSearched: { $max: '$createdAt' },
      },
    },
    {
      $sort: { count: -1 },
    },
    {
      $limit: limit,
    },
  ];

  return this.aggregate(pipeline);
};

export const SearchHistory = mongoose.model<ISearchHistoryDocument>(
  'SearchHistory',
  SearchHistorySchema
);
