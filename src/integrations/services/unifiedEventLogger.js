// integrations/services/unifiedEventLogger.js
const fs = require('fs');
const path = require('path');
const { getCollections } = require('../../database/mongodb');

class UnifiedEventLogger {
  constructor() {
    // Setup local logging directory
    this.logDirectory = path.join(__dirname, '../../../logs');
    if (!fs.existsSync(this.logDirectory)) {
      fs.mkdirSync(this.logDirectory, { recursive: true });
    }

    // Configure the required fields for each request type based on the CSV
    this.REQUIRED_FIELDS = {
      'special_order': ['customerName', 'customerContact', 'vendorPublisher', 'details', 'dateNeeded'],
      'book_hold': ['customerName', 'customerContact', 'isbn', 'details'],
      'backorder_request': ['customerName', 'customerContact', 'isbn', 'details', 'dateNeeded'],
      'out_of_print': ['customerName', 'customerContact', 'vendorPublisher', 'details', 'dateNeeded', 'condition'],
      'bulk_order': ['customerName', 'customerContact', 'isbn', 'details', 'dateNeeded'],
      'personalization': ['customerName', 'customerContact', 'isbn', 'details', 'dateNeeded']
    };

    // Common status flow for all request types based on the CSV
    const COMMON_STATUSES = [
      'NEW',
      'ORDERED',
      'RECEIVED',
      'NOTIFIED',
      'PAID',
      'COMPLETED',
      'CANCELLED'
    ];

    // Define updated transitions that prevent simultaneous Start Work and Mark as Ordered
    const IMPROVED_TRANSITIONS = {
        'NEW': ['ORDERED', 'CANCELLED'],
        'ORDERED': ['RECEIVED', 'CANCELLED'],
        'RECEIVED': ['NOTIFIED', 'CANCELLED'],
        'NOTIFIED': ['PAID', 'CANCELLED'],
        'PAID': ['COMPLETED', 'CANCELLED'],
        'COMPLETED': [],
        'CANCELLED': []
    };                  
    
    // Custom transitions for book_hold
    const BOOK_HOLD_TRANSITIONS = {
        'NEW': ['PAID', 'CANCELLED'],
        'PAID': ['COMPLETED', 'CANCELLED'],
        'COMPLETED': [],
        'CANCELLED': []
    };

    // Request type configurations with status transitions
    this.REQUEST_TYPES = {
      'special_order': {
        possibleStatuses: COMMON_STATUSES,
        statusTransitions: IMPROVED_TRANSITIONS,
        requiredFieldsPerStatus: {
          'ORDERED': ['ordered_by', 'order_method', 'estimated_arrival'],
          'RECEIVED': ['arrival_date'],
          'NOTIFIED': ['notification_method', 'notification_date'],
          'PAID': ['payment_method', 'order_number'],
          'COMPLETED': ['completion_date']
        }
      },
      'book_hold': {
        possibleStatuses: COMMON_STATUSES,
        statusTransitions: BOOK_HOLD_TRANSITIONS,
        requiredFieldsPerStatus: {
            'PAID': ['payment_method', 'order_number'],
            'COMPLETED': ['completion_date']
          }
        },
      'backorder_request': {
        possibleStatuses: COMMON_STATUSES,
        statusTransitions: IMPROVED_TRANSITIONS,
        requiredFieldsPerStatus: {
          'ORDERED': ['ordered_by', 'order_method', 'estimated_arrival'],
          'RECEIVED': ['arrival_date'],
          'NOTIFIED': ['notification_method', 'notification_date'],
          'PAID': ['payment_method', 'order_number'],
          'COMPLETED': ['completion_date']
        }
      },
      'out_of_print': {
        possibleStatuses: COMMON_STATUSES,
        statusTransitions: IMPROVED_TRANSITIONS,
        requiredFieldsPerStatus: {
          'ORDERED': ['source', 'estimated_cost'],
          'RECEIVED': ['arrival_date', 'actual_cost'],
          'NOTIFIED': ['notification_method', 'notification_date'],
          'PAID': ['payment_method', 'order_number'],
          'COMPLETED': ['completion_date']
        }
      },
      'bulk_order': {
        possibleStatuses: COMMON_STATUSES,
        statusTransitions: IMPROVED_TRANSITIONS,
        requiredFieldsPerStatus: {
          'ORDERED': ['ordered_by', 'order_method', 'estimated_arrival'],
          'RECEIVED': ['arrival_date'],
          'NOTIFIED': ['notification_method', 'notification_date'],
          'PAID': ['payment_method', 'order_number'],
          'COMPLETED': ['completion_date']
        }
      },
      'personalization': {
        possibleStatuses: COMMON_STATUSES,
        statusTransitions: IMPROVED_TRANSITIONS,
        requiredFieldsPerStatus: {
          'IN_PROGRESS': ['personalization_details', 'estimated_completion'],
          'NOTIFIED': ['notification_method', 'notification_date'],
          'PAID': ['payment_method', 'payment_amount'],
          'COMPLETED': ['completion_date']
        }
      }
    };
  }

  // Validate the required fields for a request type when creating a new request
  validateRequiredFieldsForType(requestType, providedData) {
    const requiredFields = this.REQUIRED_FIELDS[requestType];
    
    if (!requiredFields) {
      throw new Error(`Unknown request type: ${requestType}`);
    }

    const missingFields = requiredFields.filter(field => !providedData[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields for ${requestType}: ${missingFields.join(', ')}`);
    }

    return true;
  }

  // Log an event to both MongoDB and local file system
  async logEvent(eventData) {
    try {
      const { 
        requestType, 
        requestId, 
        action, 
        previousStatus,
        newStatus,
        userId, 
        additionalMetadata 
      } = eventData;

      // 1. Log to MongoDB
      try {
        const { events } = await getCollections();
        
        const result = await events.insertOne({
          requestId,
          requestType,
          action,
          previousStatus: previousStatus || '',
          newStatus: newStatus || '',
          timestamp: new Date(),
          userId: userId || 'system',
          additionalMetadata: additionalMetadata || {}
        });
        
        console.log('Event logged to MongoDB successfully', result.insertedId);
      } catch (dbError) {
        console.error('Failed to log event to MongoDB:', dbError);
        // Continue with file logging even if MongoDB logging fails
      }

      // 2. Log to file system (backup)
      try {
        const logFileName = `${requestType}_events.log`;
        const logFilePath = path.join(this.logDirectory, logFileName);

        const logEntry = `
EVENT: ${action}
-----------------
REQUEST ID: ${requestId}
REQUEST TYPE: ${requestType}
${previousStatus ? `PREVIOUS STATUS: ${previousStatus}` : ''}
${newStatus ? `NEW STATUS: ${newStatus}` : ''}
USER: ${userId || 'system'}
TIMESTAMP: ${new Date().toISOString()}
METADATA: ${JSON.stringify(additionalMetadata || {}, null, 2)}
-----------------

`;

        fs.appendFileSync(logFilePath, logEntry);
        console.log(`Event logged to file ${logFileName} successfully`);
      } catch (fileError) {
        console.error('Failed to log event to file system:', fileError);
      }

      return { success: true, message: 'Event logged successfully' };
    } catch (error) {
      console.error('Event logging error:', error);
      return { success: false, error: error.message };
    }
  }

  // Validate status transition based on request type
  validateStatusTransition(requestType, currentStatus, newStatus) {
    const typeConfig = this.REQUEST_TYPES[requestType];
    
    if (!typeConfig) {
      throw new Error(`Unsupported request type: ${requestType}`);
    }

    // Check if the transition is valid
    const validTransitions = typeConfig.statusTransitions[currentStatus] || [];
    
    if (!validTransitions.includes(newStatus)) {
      throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus} for ${requestType}`);
    }

    return true;
  }

  // Check if all required fields for a status are present
  validateRequiredFields(requestType, newStatus, providedFields) {
    const typeConfig = this.REQUEST_TYPES[requestType];
    
    if (!typeConfig || !typeConfig.requiredFieldsPerStatus) {
      return true; // No field requirements
    }

    const requiredFields = typeConfig.requiredFieldsPerStatus[newStatus] || [];
    
    for (const field of requiredFields) {
      if (!providedFields[field]) {
        throw new Error(`Field "${field}" is required for ${requestType} to transition to ${newStatus}`);
      }
    }

    return true;
  }

  // Log a new request to MongoDB
  async logNewRequest(requestData) {
    try {
      const { 
        requestId, 
        type: requestType, 
        customerName, 
        customerContact, 
        vendorPublisher,
        isbn,
        details, 
        dateNeeded,
        condition,
        priority, 
        userId = 'system'
      } = requestData;

      // Validate required fields for this request type
      try {
        this.validateRequiredFieldsForType(requestType, requestData);
      } catch (validationError) {
        console.error('Validation error:', validationError.message);
        return { success: false, error: validationError.message };
      }

      // 1. Insert into MongoDB
      try {
        const { requests } = await getCollections();
        
        const now = new Date();
        
        const result = await requests.insertOne({
          requestId,
          type: requestType,
          customerName,
          customerContact,
          vendorPublisher: vendorPublisher || '',
          isbn: isbn || '',
          details,
          dateNeeded: dateNeeded || '',
          condition: condition || '',
          priority,
          status: 'NEW',
          createdAt: now,
          updatedAt: now
        });
        
        console.log('Request added to MongoDB successfully', result.insertedId);
      } catch (dbError) {
        console.error('Failed to add request to MongoDB:', dbError);
        return { success: false, error: dbError.message };
      }

      // 2. Log event for request creation
      await this.logEvent({
        requestType,
        requestId,
        action: 'REQUEST_CREATED',
        newStatus: 'NEW',
        userId,
        additionalMetadata: { 
          customerName, 
          customerContact, 
          vendorPublisher,
          isbn,
          dateNeeded,
          condition,
          priority
        }
      });

      // 3. Log to file system (backup)
      try {
        const logFileName = `${requestType}_requests.log`;
        const logFilePath = path.join(this.logDirectory, logFileName);

        const logEntry = `
REQUEST CREATED
-----------------
ID: ${requestId}
TYPE: ${requestType}
CUSTOMER: ${customerName}
CONTACT: ${customerContact}
${vendorPublisher ? `VENDOR/PUBLISHER: ${vendorPublisher}` : ''}
${isbn ? `ISBN: ${isbn}` : ''}
DETAILS: ${details}
${dateNeeded ? `DATE NEEDED: ${dateNeeded}` : ''}
${condition ? `CONDITION: ${condition}` : ''}
PRIORITY: ${priority}
TIMESTAMP: ${new Date().toISOString()}
-----------------

`;

        fs.appendFileSync(logFilePath, logEntry);
        console.log(`Request logged to file ${logFileName} successfully`);
      } catch (fileError) {
        console.error('Failed to log request to file system:', fileError);
      }

      return { success: true, message: `Request ${requestId} created successfully` };
    } catch (error) {
      console.error('Error in logNewRequest:', error);
      return { success: false, error: error.message };
    }
  }

  // Update request status in MongoDB
  async updateRequestStatus(requestData) {
    try {
      const { 
        requestType, 
        requestId, 
        currentStatus, 
        newStatus, 
        userId, 
        additionalFields = {} 
      } = requestData;

      console.log(`Attempting to update request status for ID: ${requestId}`);
      console.log(`From status: ${currentStatus} to: ${newStatus}`);

      // 1. Validate the status transition
      try {
        this.validateStatusTransition(requestType, currentStatus, newStatus);
      } catch (validationError) {
        console.error(`Status transition validation failed: ${validationError.message}`);
        return { success: false, error: validationError.message };
      }
      
      // 2. Validate required fields for the new status
      try {
        this.validateRequiredFields(requestType, newStatus, additionalFields);
      } catch (fieldsError) {
        console.error(`Required fields validation failed: ${fieldsError.message}`);
        return { success: false, error: fieldsError.message };
      }

      // 3. Log the event regardless of whether we can update the document
      await this.logEvent({
        requestType,
        requestId,
        action: `STATUS_CHANGE`,
        previousStatus: currentStatus,
        newStatus,
        userId,
        additionalMetadata: additionalFields
      });

      // 4. Update request in MongoDB
      try {
        const { requests } = await getCollections();
        
        // Prepare update data
        const updateData = {
          $set: {
            status: newStatus,
            updatedAt: new Date()
          }
        };
        
        // Add any additional fields
        for (const [key, value] of Object.entries(additionalFields)) {
          updateData.$set[key] = value;
        }
        
        // Update the document
        const result = await requests.updateOne(
          { requestId },
          updateData
        );
        
        if (result.matchedCount === 0) {
          console.error(`No request found with ID: ${requestId}`);
          
          // If the request exists in logs but not in MongoDB, create it
          try {
            console.log('Attempting to create a new document for the request');
            
            // Try to get existing request info from file logs
            const logFileName = `${requestType}_requests.log`;
            const logFilePath = path.join(this.logDirectory, logFileName);
            
            if (fs.existsSync(logFilePath)) {
              console.log(`Request log file exists: ${logFilePath}`);
              const fileContent = fs.readFileSync(logFilePath, 'utf-8');
              
              // Check if this request ID is in the logs
              if (fileContent.includes(requestId)) {
                console.log('Request ID found in logs, creating new document in MongoDB');
                
                // Insert a new document
                const newDoc = {
                  requestId,
                  type: requestType,
                  status: newStatus,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  ...additionalFields
                };
                
                await requests.insertOne(newDoc);
                
                console.log('Created new document in MongoDB for the request');
                return { 
                  success: true, 
                  message: `Created new entry for request ${requestId} with status ${newStatus}` 
                };
              }
            }
          } catch (logError) {
            console.error('Error checking request logs:', logError);
          }
          
          throw new Error(`No request found with ID: ${requestId}`);
        }
        
        console.log('MongoDB document updated successfully');
        return { 
          success: true, 
          message: `Request ${requestId} status updated from ${currentStatus} to ${newStatus}` 
        };
      } catch (dbError) {
        console.error('Error updating MongoDB:', dbError);
        return { success: false, error: dbError.message };
      }
    } catch (error) {
      console.error('Error in updateRequestStatus:', error);
      return { success: false, error: error.message };
    }
  }

  // Get a specific request by ID - Updated to use correct field name while preserving fallback
async getRequestById(requestId) {
    try {
      console.log(`Looking for request with ID: ${requestId}`);
      
      // Try MongoDB first with the correct field name
      try {
        const { requests } = await getCollections();
        
        // Search using lowercase field name to match your document structure
        const request = await requests.findOne({ requestId });
        
        if (request) {
          console.log(`Found request in MongoDB: ${requestId}`);
          return request;
        }
      } catch (dbError) {
        console.error('Error accessing MongoDB:', dbError);
      }
      
      // If not found in MongoDB, check local logs (fallback)
      console.log('Request not found in MongoDB, checking logs');
      
      // Check all possible request type log files
      for (const requestType of Object.keys(this.REQUEST_TYPES)) {
        const logFileName = `${requestType}_requests.log`;
        const logFilePath = path.join(this.logDirectory, logFileName);
        
        if (fs.existsSync(logFilePath)) {
          const fileContent = fs.readFileSync(logFilePath, 'utf-8');
          
          // Check if this request ID is in this log
          if (fileContent.includes(requestId)) {
            console.log(`Found request in ${requestType} logs: ${requestId}`);
            
            // Parse basic info from the log
            const requestEntry = fileContent
              .split('\n\n')
              .find(entry => entry.includes(requestId));
              
            if (requestEntry) {
              // Extract details from log entry
              const type = requestType;
              const status = 'NEW'; // Assume NEW if only in logs
              const customerName = (requestEntry.match(/CUSTOMER: (.+)/) || [])[1] || 'Unknown';
              const customerContact = (requestEntry.match(/CONTACT: (.+)/) || [])[1] || '';
              const details = (requestEntry.match(/DETAILS: (.+)/) || [])[1] || '';
              const priority = (requestEntry.match(/PRIORITY: (.+)/) || [])[1] || 'Standard';
              const createdAt = (requestEntry.match(/TIMESTAMP: (.+)/) || [])[1] || new Date().toISOString();
              
              // Build a request object from log data
              return {
                requestId,
                type,
                status, 
                customerName,
                customerContact,
                details,
                priority,
                createdAt,
                updatedAt: createdAt
              };
            }
          }
        }
      }
      
      console.log(`Request not found anywhere: ${requestId}`);
      return null;
    } catch (error) {
      console.error('Error retrieving request:', error);
      throw error;
    }
  }

  /**
 * Search for requests with enhanced filtering options
 * @param {string} query - The search query text
 * @param {object} options - Advanced search options
 * @returns {Promise<Array>} - Array of matching requests
 */
// Updated searchRequests method to match your exact database structure
async searchRequests(query, options = {}) {
    try {
      console.log(`Searching requests with query: "${query}"`);
      console.log('Search options:', JSON.stringify(options));
  
      // Get database connection
      if (!this.client) {
        const { MongoClient } = require('mongodb');
        this.client = new MongoClient(process.env.MONGODB_URI);
        await this.client.connect();
        console.log('Connected to MongoDB');
      }
      
      const db = this.client.db(process.env.MONGODB_DATABASE || 'request_management');
      const collection = db.collection('requests'); // This is the correct collection based on your debug output
  
      // Count documents to verify we're accessing the right collection
      const totalCount = await collection.countDocuments({});
      console.log(`Found ${totalCount} total documents in requests collection`);
  
      // Build the query filter based on your actual field names from debug output
      let filter = {};
  
      // Convert options to match your actual field names
      if (Object.keys(options).length > 0) {
        // Convert field names to match your database
        const convertedOptions = {};
        
        if (options.CustomerName) {
          convertedOptions.customerName = options.CustomerName;
        }
        if (options.CustomerContact) {
          convertedOptions.customerContact = options.CustomerContact;
        }
        if (options.Type) {
          convertedOptions.type = options.Type;
        }
        if (options.Status) {
          convertedOptions.status = options.Status;
        }
        if (options.ISBN) {
          convertedOptions.isbn = options.ISBN;
        }
        if (options.RequestID) {
          convertedOptions.requestId = options.RequestID;
        }
        
        filter = convertedOptions;
      } 
      // General search query using correct field names
      else if (query && query.trim() !== '') {
        filter = {
          $or: [
            { requestId: { $regex: query, $options: 'i' } },
            { customerName: { $regex: query, $options: 'i' } },
            { customerContact: { $regex: query, $options: 'i' } },
            { type: { $regex: query, $options: 'i' } },
            { status: { $regex: query, $options: 'i' } },
            { details: { $regex: query, $options: 'i' } }
          ]
        };
  
        // If query looks like an ISBN, search that field too
        if (/^\d{9,13}X?$/.test(query.replace(/[-\s]/g, ''))) {
          filter.$or.push({ isbn: { $regex: query, $options: 'i' } });
        }
      }
  
      console.log('Final MongoDB query filter:', JSON.stringify(filter));
  
      // Execute the query
      const results = await collection.find(filter)
        .sort({ createdAt: -1 }) // Sort by creation date descending
        .limit(100) // Reasonable limit
        .toArray();
  
      console.log(`Found ${results.length} matching requests`);
      return results;
    } catch (error) {
      console.error('Error in searchRequests:', error);
      throw error;
    }
  }

  async connectToDB() {
    try {
      if (!this.client) {
        const { MongoClient } = require('mongodb');
        this.client = new MongoClient(process.env.MONGODB_URI);
        await this.client.connect();
        console.log('Connected to MongoDB');
      }
      
      return this.client.db(process.env.MONGODB_DATABASE || 'request_management');
    } catch (error) {
      console.error('Error connecting to MongoDB:', error);
      throw error;
    }
  }

  // Get event history for a specific request
  async getRequestHistory(requestId) {
    try {
      const { events } = await getCollections();
      
      // Query events collection for the specific requestId
      const history = await events
        .find({ requestId })
        .sort({ timestamp: 1 }) // Sort chronologically
        .toArray();
        
      return history;
    } catch (error) {
      console.error('Error retrieving request history:', error);
      throw error;
    }
  }
}

module.exports = new UnifiedEventLogger();