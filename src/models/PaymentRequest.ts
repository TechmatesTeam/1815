import mongoose, { Document, Schema } from 'mongoose';

export type PaymentStatus = 'pending' | 'completed' | 'expired' | 'failed';

export interface IPaymentRequestDocument extends Document {
  jti: string; // token id
  shortCode?: string; // generated or existing alias
  cardanoAddress: string;
  amountLovelace: number; // integer
  fiatCurrency: string; // e.g., USD
  fiatAmount?: number; // optional optimized amount at creation time
  metadata?: Record<string, any>;
  expiresAt: Date;
  status: PaymentStatus;
  moonpayOrderId?: string;
  moonpayStatus?: string;
  ownerEmail?: string;
  ownerPasscodeHash?: string;
  isPublic?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentRequestSchema = new Schema<IPaymentRequestDocument>(
  {
    jti: { type: String, required: true, unique: true, index: true },
    shortCode: { type: String, trim: true, index: true },
    cardanoAddress: { type: String, required: true, trim: true, index: true },
    amountLovelace: { type: Number, required: true, min: 0 },
    fiatCurrency: { type: String, required: true, trim: true, uppercase: true },
    fiatAmount: { type: Number },
    metadata: { type: Schema.Types.Mixed },
    ownerEmail: { type: String, trim: true, index: true },
    ownerPasscodeHash: { type: String, trim: true },
    isPublic: { type: Boolean, default: false, index: true },
    expiresAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'completed', 'expired', 'failed'],
      default: 'pending',
      index: true,
    },
    moonpayOrderId: { type: String, trim: true, index: true },
    moonpayStatus: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete (ret as any).__v;
        // Do not expose passcode hash in API
        delete (ret as any).ownerPasscodeHash;
        return ret;
      },
    },
  }
);

// TTL index is driven via expiresAt + a job; keep index for fast queries
PaymentRequestSchema.index({ expiresAt: 1, status: 1 });

export const PaymentRequest = mongoose.model<IPaymentRequestDocument>(
  'PaymentRequest',
  PaymentRequestSchema
);
