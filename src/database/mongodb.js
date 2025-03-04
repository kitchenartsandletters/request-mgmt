// database/mongodb.js
const { MongoClient } = require('mongodb');

let client;
let db;

/**
 * Connect to MongoDB
 */
async function connectToDatabase() {
  try {
    if (client && db) {
      return { client, db };
    }

    // Connect to MongoDB
    const uri = process.env.MONGODB_URI;
    client = new MongoClient(uri);
    await client.connect();
    
    // Get reference to database
    db = client.db(process.env.MONGODB_DATABASE || 'request_management');
    
    console.log('Connected to MongoDB');
    return { client, db };
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

/**
 * Get MongoDB collections
 */
async function getCollections() {
  const { db } = await connectToDatabase();
  
  return {
    requests: db.collection('requests'),
    events: db.collection('events')
  };
}

/**
 * Close the MongoDB connection
 */
async function closeConnection() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('MongoDB connection closed');
  }
}

// Handle application shutdown
process.on('SIGINT', async () => {
  await closeConnection();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeConnection();
  process.exit(0);
});

module.exports = {
  connectToDatabase,
  getCollections,
  closeConnection
};