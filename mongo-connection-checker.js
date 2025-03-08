// mongo-connection-checker.js
// Simple script to verify MongoDB connection and credentials
// Run with: node mongo-connection-checker.js YOUR_MONGODB_URI

const { MongoClient } = require('mongodb');

async function checkConnection() {
  const uri = process.argv[2];
  
  if (!uri) {
    console.error('Please provide MongoDB URI as an argument');
    console.error('Usage: node mongo-connection-checker.js "mongodb+srv://username:password@cluster.mongodb.net"');
    process.exit(1);
  }
  
  console.log('Testing MongoDB connection...');
  
  let client;
  try {
    client = new MongoClient(uri);
    await client.connect();
    
    console.log('✅ Connection successful!');
    
    // List databases
    const adminDb = client.db('admin');
    const dbs = await adminDb.admin().listDatabases();
    
    console.log('\nAvailable databases:');
    dbs.databases.forEach(db => {
      console.log(`- ${db.name} (${db.sizeOnDisk ? (db.sizeOnDisk / 1024 / 1024).toFixed(2) + ' MB' : 'empty'})`);
    });
    
    console.log('\nConnection information:');
    console.log('Host:', uri.split('@')[1]?.split('/')[0] || 'unknown');
    console.log('Username:', uri.includes('@') ? uri.split('://')[1].split(':')[0] : 'none');
    
    return true;
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error('\nPossible issues:');
    
    if (error.message.includes('authentication failed')) {
      console.error('- Username or password is incorrect');
    }
    
    if (error.message.includes('connection closed')) {
      console.error('- Connection was rejected or timed out');
    }
    
    if (error.message.includes('getaddrinfo')) {
      console.error('- Hostname could not be resolved');
      console.error('- Network connectivity issue or VPN problem');
    }
    
    if (error.message.includes('URI must include hostname')) {
      console.error('- The MongoDB URI format is incorrect');
    }
    
    return false;
  } finally {
    if (client) {
      await client.close();
      console.log('Connection closed');
    }
  }
}

checkConnection()
  .then(success => {
    if (!success) {
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });