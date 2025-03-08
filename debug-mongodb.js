// debug-mongodb.js
// Use this script to check your MongoDB connection and collection structure
// Run with: node debug-mongodb.js

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function debugMongoDB() {
  let client;
  
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    console.log(`URI: ${process.env.MONGODB_URI.replace(/mongodb\+srv:\/\/([^:]+):[^@]+@/, 'mongodb+srv://$1:***@')}`);
    
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    
    console.log('Connected successfully to MongoDB');
    
    // Get database
    const dbName = process.env.MONGODB_DATABASE || 'request_management';
    console.log(`Using database: ${dbName}`);
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
        const sample = await collection.findOne({});
        console.log('Sample document structure:');
        console.log(JSON.stringify(sample, null, 2));
        
        // Check field names specifically relevant to our search
        const hasSearchFields = checkSearchFields(sample);
        console.log('Search field availability:');
        console.log(JSON.stringify(hasSearchFields, null, 2));
      } else {
        console.log('No documents found in this collection');
      }
    }
    
    // Try to find a specific document (using the example from Slack)
    console.log('\nTrying to find John Smith request:');
    for (const coll of collections) {
      const collection = db.collection(coll.name);
      
      // Try lowercase field names
      let johnRequest = await collection.findOne({ customerName: { $regex: 'John', $options: 'i' } });
      
      // Try uppercase field names if needed
      if (!johnRequest) {
        johnRequest = await collection.findOne({ CustomerName: { $regex: 'John', $options: 'i' } });
      }
      
      if (johnRequest) {
        console.log(`Found John's request in collection: ${coll.name}`);
        console.log(JSON.stringify(johnRequest, null, 2));
        break;
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

// Helper function to check for search-relevant fields
function checkSearchFields(doc) {
  const fields = {
    'requestId/RequestID': !!doc.requestId || !!doc.RequestID,
    'customerName/CustomerName': !!doc.customerName || !!doc.CustomerName,
    'customerContact/CustomerContact': !!doc.customerContact || !!doc.CustomerContact,
    'type/Type': !!doc.type || !!doc.Type,
    'status/Status': !!doc.status || !!doc.Status,
    'isbn/ISBN': !!doc.isbn || !!doc.ISBN,
    'details/Details': !!doc.details || !!doc.Details
  };
  
  return fields;
}

// Run the debug function
debugMongoDB().catch(console.error);