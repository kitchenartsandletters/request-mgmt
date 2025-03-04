// integrations/services/unifiedEventLogger.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

class UnifiedEventLogger {
  constructor() {
    // Initialize Google Sheets authentication
    this.serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    
    // Configuration for sheet names
    this.SHEETS = {
      PRIMARY_REQUESTS: 'Requests',
      EVENT_LOG: 'Event Log'
    };

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
      // 'IN_PROGRESS', // Removed
      'ORDERED',
      'RECEIVED',
      'NOTIFIED',
      'PAID',
      'COMPLETED',
      'CANCELLED'
    ];

    // Define standard transitions that apply to all request types
    const STANDARD_TRANSITIONS = {
      'NEW': ['IN_PROGRESS', 'ORDERED', 'CANCELLED'],
      'IN_PROGRESS': ['ORDERED', 'CANCELLED'],
      'ORDERED': ['RECEIVED', 'CANCELLED'],
      'RECEIVED': ['NOTIFIED', 'CANCELLED'],
      'NOTIFIED': ['PAID', 'CANCELLED'],
      'PAID': ['COMPLETED', 'CANCELLED'],
      'COMPLETED': [],
      'CANCELLED': []
    };

    // Define updated transitions that prevent simultaneous Start Work and Mark as Ordered
    const IMPROVED_TRANSITIONS = {
        'NEW': ['ORDERED', 'CANCELLED'], // Only allow Start Work from NEW
        // 'IN_PROGRESS': ['ORDERED', 'CANCELLED'], // REMOVED Then allow Ordered after IN_PROGRESS
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
        statusTransitions: STANDARD_TRANSITIONS,
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

  // Get a specific sheet from the Google Spreadsheet
  async getSheet(sheetName) {
    try {
      const doc = new GoogleSpreadsheet(this.spreadsheetId, this.serviceAccountAuth);
      await doc.loadInfo();
      
      // Try to find sheet by name
      let sheet = doc.sheetsByTitle[sheetName];
      
      if (!sheet) {
        console.warn(`Sheet '${sheetName}' not found, will create it`);
        
        // Create the sheet if it doesn't exist
        if (sheetName === this.SHEETS.PRIMARY_REQUESTS) {
          sheet = await doc.addSheet({
            title: sheetName,
            headerValues: [
              'RequestID', 'Type', 'CustomerName', 'CustomerContact', 
              'VendorPublisher', 'ISBN', 'Details', 'DateNeeded', 'Condition',
              'Priority', 'Status', 'CreatedAt', 'UpdatedAt',
              'AssignedTo', 'Notes'
            ]
          });
        } else if (sheetName === this.SHEETS.EVENT_LOG) {
          sheet = await doc.addSheet({
            title: sheetName,
            headerValues: [
              'RequestID', 'RequestType', 'Action', 'PreviousStatus',
              'NewStatus', 'Timestamp', 'UserId', 'AdditionalMetadata'
            ]
          });
        } else {
          throw new Error(`Unknown sheet type: ${sheetName}`);
        }
      }

      return sheet;
    } catch (error) {
      console.error(`Error accessing sheet '${sheetName}':`, error);
      throw error;
    }
  }

  // Log an event to both Google Sheets and local file system
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

      // 1. Log to Google Sheets
      try {
        const eventLogSheet = await this.getSheet(this.SHEETS.EVENT_LOG);
        
        await eventLogSheet.addRow({
          RequestID: requestId,
          RequestType: requestType,
          Action: action,
          PreviousStatus: previousStatus || '',
          NewStatus: newStatus || '',
          Timestamp: new Date().toISOString(),
          UserId: userId || 'system',
          AdditionalMetadata: JSON.stringify(additionalMetadata || {})
        });
        
        console.log('Event logged to Google Sheets successfully');
      } catch (sheetsError) {
        console.error('Failed to log event to Google Sheets:', sheetsError);
        // Continue with file logging even if Sheets logging fails
      }

      // 2. Log to file system
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

  // Log a new request to both systems
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

      // 1. Log to Google Sheets primary requests
      try {
        const primarySheet = await this.getSheet(this.SHEETS.PRIMARY_REQUESTS);
        
        await primarySheet.addRow({
          RequestID: requestId,
          Type: requestType,
          CustomerName: customerName,
          CustomerContact: customerContact,
          VendorPublisher: vendorPublisher || '',
          ISBN: isbn || '',
          Details: details,
          DateNeeded: dateNeeded || '',
          Condition: condition || '',
          Priority: priority,
          Status: 'NEW',
          CreatedAt: new Date().toISOString(),
          UpdatedAt: new Date().toISOString()
        });
        
        console.log('Request added to primary sheet successfully');
      } catch (sheetsError) {
        console.error('Failed to add request to Google Sheets:', sheetsError);
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

      // 3. Log to file system
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

  // Update request status in both systems
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

      // 3. Log the event regardless of whether we can update the sheet
      // This ensures we have a record of the attempted change
      await this.logEvent({
        requestType,
        requestId,
        action: `STATUS_CHANGE`,
        previousStatus: currentStatus,
        newStatus,
        userId,
        additionalMetadata: additionalFields
      });

      // 4. Update primary requests sheet
      try {
        const primarySheet = await this.getSheet(this.SHEETS.PRIMARY_REQUESTS);
        
        // Load all rows and log the count for debugging
        const rows = await primarySheet.getRows();
        console.log(`Found ${rows.length} total rows in the sheet`);
        
        // Find the specific request row
        const requestRow = rows.find(row => row.RequestID === requestId);

        if (requestRow) {
          console.log(`Found request row with ID: ${requestId}`);
          
          // Update status
          requestRow.Status = newStatus;
          requestRow.UpdatedAt = new Date().toISOString();
          
          // Add any additional fields
          Object.keys(additionalFields).forEach(key => {
            // Only add fields that have column headers
            if (primarySheet.headerValues.includes(key)) {
              requestRow[key] = additionalFields[key];
            }
          });

          await requestRow.save();
          console.log('Primary sheet row updated successfully');
          
          return { 
            success: true, 
            message: `Request ${requestId} status updated from ${currentStatus} to ${newStatus}` 
          };
        } else {
          console.error(`No row found with RequestID: ${requestId}`);
          
          // If the row doesn't exist in the sheet but we have a record of it,
          // add a new row rather than failing
          console.log('Attempting to create a new row for the request');
          
          // Try to get existing request info from file logs
          const logFileName = `${requestType}_requests.log`;
          const logFilePath = path.join(this.logDirectory, logFileName);
          
          try {
            // Only proceed if the request was successfully logged but not in the sheet
            if (fs.existsSync(logFilePath)) {
              console.log(`Request log file exists: ${logFilePath}`);
              const fileContent = fs.readFileSync(logFilePath, 'utf-8');
              
              // Check if this request ID is in the logs
              if (fileContent.includes(requestId)) {
                console.log('Request ID found in logs, creating new row in sheet');
                
                // Add a new row to the sheet
                await primarySheet.addRow({
                  RequestID: requestId,
                  Type: requestType,
                  Status: newStatus,
                  CreatedAt: new Date().toISOString(),
                  UpdatedAt: new Date().toISOString(),
                  ...additionalFields
                });
                
                console.log('Created new row in sheet for the request');
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
      } catch (sheetError) {
        console.error('Error updating sheet:', sheetError);
        return { success: false, error: sheetError.message };
      }
    } catch (error) {
      console.error('Error in updateRequestStatus:', error);
      return { success: false, error: error.message };
    }
  }

  // Get a specific request by ID
  async getRequestById(requestId) {
    try {
      console.log(`Looking for request with ID: ${requestId}`);
      
      // Try Google Sheets first
      try {
        const primarySheet = await this.getSheet(this.SHEETS.PRIMARY_REQUESTS);
        const rows = await primarySheet.getRows();
        
        console.log(`Searching through ${rows.length} rows in sheet`);
        const request = rows.find(row => row.RequestID === requestId);
        
        if (request) {
          console.log(`Found request in sheet: ${requestId}`);
          return request;
        }
      } catch (sheetError) {
        console.error('Error accessing Google Sheet:', sheetError);
      }
      
      // If not found in sheets, check local logs
      console.log('Request not found in sheet, checking logs');
      
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
                RequestID: requestId,
                Type: type,
                Status: status, 
                CustomerName: customerName,
                CustomerContact: customerContact,
                Details: details,
                Priority: priority,
                CreatedAt: createdAt,
                UpdatedAt: createdAt
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

  // Search requests from Google Sheets
  async searchRequests(query, options = {}) {
    try {
      const { requestType, status, dateRange } = options;
      
      const primarySheet = await this.getSheet(this.SHEETS.PRIMARY_REQUESTS);
      const rows = await primarySheet.getRows();
      
      // Filter rows based on query and options
      return rows.filter(row => {
        // Apply request type filter if provided
        if (requestType && row.Type !== requestType) {
          return false;
        }
        
        // Apply status filter if provided
        if (status && row.Status !== status) {
          return false;
        }
        
        // Apply date range filter if provided
        if (dateRange) {
          const createdAt = new Date(row.CreatedAt);
          if (dateRange.from && createdAt < new Date(dateRange.from)) {
            return false;
          }
          if (dateRange.to && createdAt > new Date(dateRange.to)) {
            return false;
          }
        }
        
        // Apply text search if query is provided
        if (query) {
          // Search across all columns
          return Object.values(row).some(value => 
            value && value.toString().toLowerCase().includes(query.toLowerCase())
          );
        }
        
        return true;
      });
    } catch (error) {
      console.error('Error searching requests:', error);
      throw error;
    }
  }

  // Get event history for a specific request
  async getRequestHistory(requestId) {
    try {
      const eventLogSheet = await this.getSheet(this.SHEETS.EVENT_LOG);
      const rows = await eventLogSheet.getRows();
      
      return rows
        .filter(row => row.RequestID === requestId)
        .sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));
    } catch (error) {
      console.error('Error retrieving request history:', error);
      throw error;
    }
  }
}

module.exports = new UnifiedEventLogger();