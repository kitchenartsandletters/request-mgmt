const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

class RequestEventLogger {
  constructor() {
    this.serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    // Configuration for sheet names or indexes
    this.SHEETS = {
      PRIMARY_REQUESTS: 'Requests', // Sheet name or index
      EVENT_LOG: 'Event Log' // Sheet name or index
    };

    this.REQUEST_TYPES = {
      'book_hold': {
        possibleStatuses: [
          'NEW', 'PENDING', 'PAID', 'NOT_PAID', 
          'HELD', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED'
        ],
        statusTransitions: {
          'NEW': ['PENDING', 'PAID', 'CANCELLED'],
          'PENDING': ['PAID', 'NOT_PAID', 'CANCELLED'],
          'PAID': ['HELD', 'READY_FOR_PICKUP', 'CANCELLED'],
        }
      },
      'special_order': {
        // Similar structure can be added
      }
    };
  }

  async getSheet(sheetName) {
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SPREADSHEET_ID, this.serviceAccountAuth);
    await doc.loadInfo();
    
    // Try to find sheet by name, fallback to index if not found
    let sheet;
    try {
      sheet = doc.sheetsByTitle[sheetName];
    } catch {
      // If sheet name doesn't work, try index
      const index = typeof sheetName === 'string' 
        ? doc.sheetsByTitle[sheetName] 
        : doc.sheetsByIndex[sheetName];
      sheet = index;
    }

    if (!sheet) {
      throw new Error(`Sheet '${sheetName}' not found`);
    }

    return sheet;
  }

  async logEvent(requestData) {
    try {
      console.log('Logging Event:', requestData);
      const { requestType, requestId, action, userId, additionalMetadata } = requestData;

      const eventLogSheet = await this.getSheet(this.SHEETS.EVENT_LOG);

      await eventLogSheet.addRow({
        RequestID: requestId,
        RequestType: requestType,
        Action: action,
        Timestamp: new Date().toISOString(),
        UserId: userId,
        AdditionalMetadata: JSON.stringify(additionalMetadata || {})
      });

      console.log('Event logged successfully');
      return { success: true, message: 'Event logged successfully' };
    } catch (error) {
      console.error('Event logging error:', error);
      throw error;
    }
  }

  async updateRequestStatus(requestData) {
    console.log('Updating Request Status:', requestData);

    try {
      const { 
        requestType, 
        requestId, 
        currentStatus, 
        newStatus, 
        userId, 
        additionalFields 
      } = requestData;

      // Validate status transition
      await this.validateStatusTransition(requestType, currentStatus, newStatus);

      // Log the event in the event log sheet
      await this.logEvent({
        requestType,
        requestId,
        action: `STATUS_CHANGE: ${currentStatus} → ${newStatus}`,
        userId,
        additionalMetadata: { 
          previousStatus: currentStatus, 
          newStatus,
          ...additionalFields 
        }
      });

      // Update primary requests sheet
      const primarySheet = await this.getSheet(this.SHEETS.PRIMARY_REQUESTS);
      
      // Find and update the specific request row
      const rows = await primarySheet.getRows();
      const requestRow = rows.find(row => row.RequestID === requestId);

      if (requestRow) {
        // Update status and any additional fields
        requestRow.Status = newStatus;
        
        // Add any additional fields passed in
        Object.keys(additionalFields || {}).forEach(key => {
          requestRow[key] = additionalFields[key];
        });

        await requestRow.save();
        console.log('Primary sheet row updated successfully');
      } else {
        console.error(`No row found with RequestID: ${requestId}`);
      }

      return { success: true };
    } catch (error) {
      console.error('Error in updateRequestStatus:', error);
      throw error;
    }
  }

  async validateStatusTransition(requestType, currentStatus, newStatus) {
    const typeConfig = this.REQUEST_TYPES[requestType];
    
    if (!typeConfig) {
      throw new Error(`Unsupported request type: ${requestType}`);
    }

    const validTransitions = typeConfig.statusTransitions[currentStatus] || [];
    
    if (!validTransitions.includes(newStatus)) {
      throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus}`);
    }

    return true;
  }
}

module.exports = new RequestEventLogger();