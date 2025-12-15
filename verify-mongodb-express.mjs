import { MongoClient } from 'mongodb';

async function verifySetup() {
  console.log('🔍 MongoDB Express Setup Verification\n');

  // Test 1: Check if MongoDB Express is accessible
  console.log('1. Testing MongoDB Express accessibility...');
  try {
    const response = await fetch('http://localhost:8082', {
      headers: {
        'Authorization': 'Basic ' + Buffer.from('admin:admin123').toString('base64')
      }
    });
    
    if (response.ok) {
      console.log('   ✅ MongoDB Express is accessible at http://localhost:8082');
    } else {
      console.log('   ❌ MongoDB Express returned status:', response.status);
    }
  } catch (error) {
    console.log('   ❌ Cannot connect to MongoDB Express:', error.message);
  }

  // Test 2: Verify database content
  console.log('\n2. Verifying database content...');
  const client = new MongoClient('mongodb://localhost:27017/1815_dev');
  
  try {
    await client.connect();
    const db = client.db('1815_dev');
    
    const aliases = await db.collection('aliases').find({}).toArray();
    console.log(`   ✅ Found ${aliases.length} aliases in database`);
    
    if (aliases.length > 0) {
      console.log('\n   📋 Live aliases that should be visible in MongoDB Express:');
      aliases.forEach((alias, index) => {
        console.log(`   ${index + 1}. Code: ${alias.shortCode}`);
        console.log(`      Address: ${alias.cardanoAddress.substring(0, 40)}...`);
        console.log(`      Name: ${alias.customName || 'None'}`);
        console.log(`      Active: ${alias.isActive ? '✅' : '❌'}`);
        console.log(`      Uses: ${alias.useCount}`);
        console.log(`      Expires: ${new Date(alias.expiresAt).toLocaleDateString()}`);
        console.log('');
      });
    }

    // Test 3: Check collections and indexes
    console.log('3. Database schema verification...');
    const collections = await db.listCollections().toArray();
    console.log(`   ✅ Collections: ${collections.map(c => c.name).join(', ')}`);
    
    const indexes = await db.collection('aliases').listIndexes().toArray();
    console.log(`   ✅ Aliases indexes: ${indexes.map(i => i.name).join(', ')}`);

  } catch (error) {
    console.log('   ❌ Database connection failed:', error.message);
  } finally {
    await client.close();
  }

  // Test 4: Docker container status
  console.log('\n4. Docker container status...');
  console.log('   Run this command to check MongoDB Express logs:');
  console.log('   docker logs 1815-api-mongo-express-1 --tail 10');
  
  console.log('\n🎉 Verification complete!');
  console.log('\n📋 Access Instructions:');
  console.log('   1. Open: http://localhost:8082');
  console.log('   2. Login: admin / admin123');
  console.log('   3. Select database: 1815_dev');
  console.log('   4. View collection: aliases');
  console.log('   5. You should see your live data with schema!');
}

verifySetup().catch(console.error);