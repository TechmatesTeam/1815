const { MongoClient } = require('mongodb');

const uri = 'mongodb://localhost:27017/1815_dev';

async function quickView() {
  const client = new MongoClient(uri);
  
  try {
    console.log('🔍 Connecting to MongoDB...');
    await client.connect();
    console.log('✅ Connected to MongoDB: 1815_dev\n');

    const db = client.db('1815_dev');
    
    // Show collections
    const collections = await db.listCollections().toArray();
    console.log('📋 Collections:');
    for (const collection of collections) {
      const count = await db.collection(collection.name).countDocuments();
      console.log(`  - ${collection.name}: ${count} documents`);
    }
    
    // Show aliases
    const aliases = await db.collection('aliases').find({}).toArray();
    if (aliases.length > 0) {
      console.log('\n🔗 Current Aliases:');
      aliases.forEach((alias, index) => {
        console.log(`\n${index + 1}. ${alias.shortCode} -> ${alias.cardanoAddress.substring(0, 30)}...`);
        console.log(`   Name: ${alias.customName || 'None'}`);
        console.log(`   Active: ${alias.isActive ? '✅' : '❌'} | Uses: ${alias.useCount}`);
        console.log(`   Expires: ${new Date(alias.expiresAt).toLocaleDateString()}`);
      });
    }
    
    // Show database stats
    const stats = await db.stats();
    console.log('\n📊 Database Statistics:');
    console.log(`   Collections: ${stats.collections}`);
    console.log(`   Objects: ${stats.objects}`);
    console.log(`   Data Size: ${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Storage Size: ${(stats.storageSize / 1024 / 1024).toFixed(2)} MB`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

quickView().catch(console.error);