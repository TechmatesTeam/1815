import mongoose from 'mongoose';
import { PaymentRequest } from '@/models/PaymentRequest';
import { paymentService } from './paymentService';
import { ratesService } from './ratesService';

jest.mock('./ratesService');

describe('PaymentService', () => {
  beforeAll(async () => {
    await mongoose.connect(global.__MONGO_URI__, { dbName: 'test' });
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await PaymentRequest.deleteMany({});
  });

  it('creates payment request and stores record', async () => {
    (ratesService.getPrices as jest.Mock).mockResolvedValue({ USD: 1.5 });

    const result = await paymentService.createPaymentRequest({
      cardanoAddress: 'addr_test1q...',
      amountAda: 10,
      fiatCurrency: 'USD',
    });

    expect(result.payment).toBeDefined();
    expect(result.payment.amountLovelace).toBe(10000000);
    expect(result.payment.fiatCurrency).toBe('USD');
    expect(result.payment.fiatAmount).toBe(15);
  });
});
