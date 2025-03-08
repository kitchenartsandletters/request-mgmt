// simplified-debug-mongodb.js
// Run with: node simplified-debug-mongodb.js YOUR_MONGODB_URI YOUR_DATABASE_NAME

const { MongoClient } = require('mongodb');

async function debugMongoDB() {
  let client;
  
  try {
    // Get connection parameters from command line arguments
    const uri = process.argv[2];
    const dbName = process.argv[3] || 'request_management';
    
    if (!uri) {
      console.error('Please provide MongoDB URI as the first argument');
      console.error('Usage: node simplified-debug-mongodb.js "mongodb+srv://username:password@cluster.mongodb.net" [database_name]');
      return;
    }
    
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    console.log(`Database name: ${dbName}`);
    
    client = new MongoClient(uri);
    await client.connect();
    
    console.log('Connected successfully to MongoDB');
    
    // Get database
    const db = client.db(dbName);
    
    // List all collections
    const collections = await db.listCollections().toArray();
    console.log('Available collections:');
    collections.forEach(coll => {
      console.log(`- ${coll.name}`);
    });
    
    // For each collection, count documents and show a sample
    for (const coll of collections) {
      const collection = db.collection(coll.name);
      const count = await collection.countDocuments();
      console.log(`\nCollection: ${coll.name} (${count} documents)`);
      
      if (count > 0) {
        console.log('First 2 documents:');
        const samples = await collection.find().limit(2).toArray();
        samples.forEach((doc, index) => {
          console.log(`\nDocument ${index + 1}:`);
          console.log(JSON.stringify(doc, null, 2));
        });
      } else {
        console.log('No documents found in this collection');
      }
    }
    
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Run the debug function
debugMongoDB().catch(console.error);