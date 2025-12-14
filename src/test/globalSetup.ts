export default async (): Promise<void> => {
  // Global setup before all tests
  console.log('🧪 Setting up test environment...');

  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests
};
