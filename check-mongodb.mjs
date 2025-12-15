import { MongoClient } from 'mongodb';

async function checkMongoDB() {
  const uri = 'mongodb://localhost:27017/1815_dev';
  const client = new MongoClient(uri);

  try {
    console.log('🔍 Connecting to MongoDB...');
    await client.connect();
    console.log('✅ Connected to MongoDB successfully');

    const db = client.db('1815_dev');
    
    // List all collections
    console.log('\n📋 Collections in database:');
    const collections = await db.listCollections().toArray();
    console.log(collections.map(c => c.name));

    // Check aliases collection
    if (collections.some(c => c.name === 'aliases')) {
      console.log('\n🔍 Aliases collection data:');
      const aliasesCollection = db.collection('aliases');
      const aliasCount = await aliasesCollection.countDocuments();
      console.log(`Total aliases: ${aliasCount}`);
      
      if (aliasCount > 0) {
        console.log('\n📄 Sample aliases:');
        const sampleAliases = await aliasesCollection.find({}).limit(5).toArray();
        sampleAliases.forEach((alias, index) => {
          console.log(`${index + 1}. ${alias.shortCode} -> ${alias.cardanoAddress}`);
          console.log(`   Custom Name: ${alias.customName || 'None'}`);
          console.log(`   Active: ${alias.isActive}`);
          console.log(`   Expires: ${alias.expiresAt}`);
          console.log(`   Use Count: ${alias.useCount}`);
          console.log('');
        });
      }
    } else {
      console.log('\n❌ No aliases collection found');
    }

    // Check users collection
    if (collections.some(c => c.name === 'users')) {
      console.log('\n👥 Users collection:');
      const usersCollection = db.collection('users');
      const userCount = await usersCollection.countDocuments();
      console.log(`Total users: ${userCount}`);
    }

    // Database stats
    console.log('\n📊 Database stats:');
    const stats = await db.stats();
    console.log(`Database size: ${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Storage size: ${(stats.storageSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Collections: ${stats.collections}`);
    console.log(`Objects: ${stats.objects}`);

  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

checkMongoDB().catch(console.error);