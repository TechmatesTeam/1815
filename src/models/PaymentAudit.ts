import mongoose, { Document, Schema } from 'mongoose';

export interface IPaymentAudit extends Document {
  paymentId: Schema.Types.ObjectId | string;
  action: 'created' | 'discarded' | 'rejected' | 'honored';
  actorEmail?: string | null;
  reason?: string | null;
  timestamp: Date;
}

const PaymentAuditSchema = new Schema<IPaymentAudit>(
  {
    paymentId: { type: Schema.Types.ObjectId, required: true, index: true },
    action: { type: String, required: true },
    actorEmail: { type: String, trim: true },
    reason: { type: String },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

export const PaymentAudit = mongoose.model<IPaymentAudit>('PaymentAudit', PaymentAuditSchema);
