import { MongoClient } from 'mongodb';

async function syncData() {
  // Source: Local MongoDB (where your live data is)
  const localUri = 'mongodb://localhost:27017/1815_dev';
  const localClient = new MongoClient(localUri);

  // Target: Docker MongoDB (what MongoDB Express connects to)
  const dockerUri = 'mongodb://localhost:27017/1815_dev'; // Same port, but different instance
  
  try {
    console.log('🔍 Connecting to local MongoDB...');
    await localClient.connect();
    const localDb = localClient.db('1815_dev');

    // First, let's check what's in the local database
    console.log('\n📋 Checking local database content...');
    const collections = await localDb.listCollections().toArray();
    console.log(`Found ${collections.length} collections:`);
    
    for (const collection of collections) {
      const count = await localDb.collection(collection.name).countDocuments();
      console.log(`  - ${collection.name}: ${count} documents`);
      
      if (collection.name === 'aliases' && count > 0) {
        console.log('\n🔗 Sample aliases from local database:');
        const sampleAliases = await localDb.collection('aliases').find({}).limit(3).toArray();
        sampleAliases.forEach((alias, index) => {
          console.log(`  ${index + 1}. ${alias.shortCode} -> ${alias.cardanoAddress.substring(0, 30)}...`);
          console.log(`     Name: ${alias.customName || 'None'} | Active: ${alias.isActive} | Uses: ${alias.useCount}`);
        });
      }
    }

    // Now let's check if we can connect to the Docker MongoDB
    console.log('\n🐳 Checking Docker MongoDB connection...');
    
    // The Docker MongoDB is accessible on the same port, but we need to check if it's the same instance
    // Let's try to connect to it through the Docker network
    const dockerClient = new MongoClient('mongodb://localhost:27017/1815_dev');
    await dockerClient.connect();
    const dockerDb = dockerClient.db('1815_dev');
    
    const dockerCollections = await dockerDb.listCollections().toArray();
    console.log(`Docker MongoDB has ${dockerCollections.length} collections:`);
    
    for (const collection of dockerCollections) {
      const count = await dockerDb.collection(collection.name).countDocuments();
      console.log(`  - ${collection.name}: ${count} documents`);
    }

    // Check if they're the same instance by comparing data
    const localAliasCount = await localDb.collection('aliases').countDocuments();
    const dockerAliasCount = await dockerDb.collection('aliases').countDocuments();
    
    if (localAliasCount === dockerAliasCount && localAliasCount > 0) {
      console.log('\n✅ Both databases appear to be the same instance!');
      console.log('   MongoDB Express should be able to see your data.');
    } else {
      console.log('\n⚠️  Databases appear to be different instances.');
      console.log(`   Local: ${localAliasCount} aliases, Docker: ${dockerAliasCount} aliases`);
    }

    await dockerClient.close();

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await localClient.close();
  }
}

syncData().catch(console.error);