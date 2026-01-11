import request from 'supertest';
import { app } from '@/index';
import { EmailVerification } from '@/models/EmailVerification';
import { NewsletterSubscription } from '@/models/NewsletterSubscription';
import { FeatureSubscription } from '@/models/FeatureSubscription';

describe('Features API Integration Tests', () => {
  beforeEach(async () => {
    // Clean up test data
    await EmailVerification.deleteMany({});
    await NewsletterSubscription.deleteMany({});
    await FeatureSubscription.deleteMany({});
  });

  describe('GET /api/v1/features', () => {
    it('should return features data', async () => {
      const response = await request(app).get('/api/v1/features').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('currentVersion');
      expect(response.body.data).toHaveProperty('features');
      expect(Array.isArray(response.body.data.features)).toBe(true);
      expect(response.body.data.features.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/features/newsletter/subscribe', () => {
    it('should initiate newsletter subscription', async () => {
      const subscriptionData = {
        email: 'test@example.com',
        featureUpdates: true,
        generalNews: false,
      };

      const response = await request(app)
        .post('/api/v1/features/newsletter/subscribe')
        .send(subscriptionData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.verificationRequired).toBe(true);
      expect(response.body.data.verificationId).toBeDefined();

      // Check that verification record was created
      const verification = await EmailVerification.findById(response.body.data.verificationId);
      expect(verification).toBeTruthy();
      expect(verification?.email).toBe(subscriptionData.email);
      expect(verification?.subscriptionType).toBe('newsletter');
    });

    it('should reject invalid email', async () => {
      const subscriptionData = {
        email: 'invalid-email',
        featureUpdates: true,
        generalNews: false,
      };

      const response = await request(app)
        .post('/api/v1/features/newsletter/subscribe')
        .send(subscriptionData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/features/notify', () => {
    it('should initiate feature notification subscription', async () => {
      const subscriptionData = {
        email: 'test@example.com',
        featureId: 'user-accounts',
        featureName: 'User Signup & Accounts',
      };

      const response = await request(app)
        .post('/api/v1/features/notify')
        .send(subscriptionData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.verificationRequired).toBe(true);
      expect(response.body.data.verificationId).toBeDefined();

      // Check that verification record was created
      const verification = await EmailVerification.findById(response.body.data.verificationId);
      expect(verification).toBeTruthy();
      expect(verification?.email).toBe(subscriptionData.email);
      expect(verification?.subscriptionType).toBe('feature_notification');
      expect(verification?.subscriptionData.featureId).toBe(subscriptionData.featureId);
    });

    it('should require email and featureId', async () => {
      const response = await request(app)
        .post('/api/v1/features/notify')
        .send({ email: 'test@example.com' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/features/verify/:token', () => {
    it('should verify newsletter subscription', async () => {
      // Create a verification record
      const verification = new EmailVerification({
        email: 'test@example.com',
        subscriptionType: 'newsletter',
        subscriptionData: {
          featureUpdates: true,
          generalNews: false,
        },
      });
      await verification.save();

      const response = await request(app)
        .get(`/api/v1/features/verify/${verification.verificationToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.subscriptionType).toBe('newsletter');

      // Check that newsletter subscription was created
      const subscription = await NewsletterSubscription.findOne({ email: 'test@example.com' });
      expect(subscription).toBeTruthy();
      expect(subscription?.subscriptionTypes.featureUpdates).toBe(true);
      expect(subscription?.subscriptionTypes.generalNews).toBe(false);
    });

    it('should verify feature notification subscription', async () => {
      // Create a verification record
      const verification = new EmailVerification({
        email: 'test@example.com',
        subscriptionType: 'feature_notification',
        subscriptionData: {
          featureId: 'user-accounts',
          featureName: 'User Signup & Accounts',
        },
      });
      await verification.save();

      const response = await request(app)
        .get(`/api/v1/features/verify/${verification.verificationToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.subscriptionType).toBe('feature_notification');

      // Check that feature subscription was created
      const subscription = await FeatureSubscription.findOne({ email: 'test@example.com' });
      expect(subscription).toBeTruthy();
      expect(subscription?.features).toContain('user-accounts');
    });

    it('should reject invalid token', async () => {
      const response = await request(app).get('/api/v1/features/verify/invalid-token').expect(400);

      expect(response.body.success).toBe(false);
    });
  });
});
