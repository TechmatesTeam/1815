const { MongoClient } = require('mongodb');
const readline = require('readline');

const uri = 'mongodb://localhost:27017/1815_dev';
const client = new MongoClient(uri);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function connectToMongoDB() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB: 1815_dev');
    return client.db('1815_dev');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

async function showMenu() {
  console.log('\n📋 MongoDB Viewer - Available Commands:');
  console.log('1. list - List all collections');
  console.log('2. aliases - Show all aliases');
  console.log('3. users - Show all users');
  console.log('4. stats - Show database statistics');
  console.log('5. search <shortCode> - Search for specific alias');
  console.log('6. active - Show only active aliases');
  console.log('7. expired - Show expired aliases');
  console.log('8. clear - Clear screen');
  console.log('9. exit - Exit viewer');
  console.log('');
}

async function handleCommand(db, command) {
  const [cmd, ...args] = command.trim().split(' ');
  
  switch (cmd.toLowerCase()) {
    case 'list':
      const collections = await db.listCollections().toArray();
      console.log('\n📋 Collections:');
      collections.forEach(c => console.log(`  - ${c.name}`));
      break;
      
    case 'aliases':
      const aliases = await db.collection('aliases').find({}).toArray();
      console.log(`\n🔗 All Aliases (${aliases.length} total):`);
      aliases.forEach((alias, index) => {
        console.log(`\n${index + 1}. Short Code: ${alias.shortCode}`);
        console.log(`   Address: ${alias.cardanoAddress}`);
        console.log(`   Custom Name: ${alias.customName || 'None'}`);
        console.log(`   Active: ${alias.isActive ? '✅' : '❌'}`);
        console.log(`   Created: ${alias.createdAt}`);
        console.log(`   Expires: ${alias.expiresAt}`);
        console.log(`   Use Count: ${alias.useCount}`);
        console.log(`   Last Used: ${alias.lastUsedAt || 'Never'}`);
      });
      break;
      
    case 'users':
      const users = await db.collection('users').find({}).toArray();
      console.log(`\n👥 All Users (${users.length} total):`);
      if (users.length === 0) {
        console.log('   No users found');
      } else {
        users.forEach((user, index) => {
          console.log(`\n${index + 1}. Email: ${user.email}`);
          console.log(`   Created: ${user.createdAt}`);
          console.log(`   Active: ${user.isActive ? '✅' : '❌'}`);
        });
      }
      break;
      
    case 'stats':
      const stats = await db.stats();
      console.log('\n📊 Database Statistics:');
      console.log(`   Database: ${stats.db}`);
      console.log(`   Collections: ${stats.collections}`);
      console.log(`   Objects: ${stats.objects}`);
      console.log(`   Data Size: ${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Storage Size: ${(stats.storageSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Indexes: ${stats.indexes}`);
      break;
      
    case 'search':
      if (args.length === 0) {
        console.log('❌ Please provide a short code to search for');
        break;
      }
      const shortCode = args[0];
      const alias = await db.collection('aliases').findOne({ shortCode });
      if (alias) {
        console.log(`\n🔍 Found Alias: ${shortCode}`);
        console.log(`   Address: ${alias.cardanoAddress}`);
        console.log(`   Custom Name: ${alias.customName || 'None'}`);
        console.log(`   Active: ${alias.isActive ? '✅' : '❌'}`);
        console.log(`   Created: ${alias.createdAt}`);
        console.log(`   Expires: ${alias.expiresAt}`);
        console.log(`   Use Count: ${alias.useCount}`);
        console.log(`   Last Used: ${alias.lastUsedAt || 'Never'}`);
      } else {
        console.log(`❌ No alias found with short code: ${shortCode}`);
      }
      break;
      
    case 'active':
      const activeAliases = await db.collection('aliases').find({ 
        isActive: true, 
        expiresAt: { $gt: new Date() } 
      }).toArray();
      console.log(`\n✅ Active Aliases (${activeAliases.length} total):`);
      activeAliases.forEach((alias, index) => {
        console.log(`${index + 1}. ${alias.shortCode} -> ${alias.cardanoAddress.substring(0, 20)}...`);
        console.log(`   Name: ${alias.customName || 'None'} | Uses: ${alias.useCount}`);
      });
      break;
      
    case 'expired':
      const expiredAliases = await db.collection('aliases').find({ 
        $or: [
          { isActive: false },
          { expiresAt: { $lte: new Date() } }
        ]
      }).toArray();
      console.log(`\n❌ Expired/Inactive Aliases (${expiredAliases.length} total):`);
      expiredAliases.forEach((alias, index) => {
        console.log(`${index + 1}. ${alias.shortCode} -> ${alias.cardanoAddress.substring(0, 20)}...`);
        console.log(`   Status: ${alias.isActive ? 'Expired' : 'Inactive'} | Expires: ${alias.expiresAt}`);
      });
      break;
      
    case 'clear':
      console.clear();
      break;
      
    case 'exit':
      console.log('👋 Goodbye!');
      await client.close();
      rl.close();
      process.exit(0);
      break;
      
    default:
      console.log(`❌ Unknown command: ${cmd}`);
      console.log('Type a command or see the menu above');
  }
}

async function startViewer() {
  const db = await connectToMongoDB();
  
  console.log('\n🎉 MongoDB Viewer Started!');
  await showMenu();
  
  const askQuestion = () => {
    rl.question('mongodb> ', async (command) => {
      if (command.trim()) {
        try {
          await handleCommand(db, command);
        } catch (error) {
          console.error('❌ Error:', error.message);
        }
      }
      askQuestion();
    });
  };
  
  askQuestion();
}

// Handle Ctrl+C
process.on('SIGINT', async () => {
  console.log('\n\n👋 Shutting down...');
  await client.close();
  process.exit(0);
});

startViewer().catch(console.error);