const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

class RequestEventLogger {
  constructor() {
    this.serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    this.REQUEST_TYPES = {
      'book_hold': {
        primarySheetId: process.env.BOOK_HOLDS_SHEET_ID,
        eventLogSheetId: process.env.BOOK_HOLDS_EVENT_LOG_SHEET_ID,
        possibleStatuses: [
          'NEW', 
          'PENDING', 
          'PAID', 
          'NOT_PAID', 
          'HELD', 
          'READY_FOR_PICKUP', 
          'PICKED_UP', 
          'CANCELLED'
        ],
        statusTransitions: {
          'NEW': ['PENDING', 'PAID', 'CANCELLED'],
          'PENDING': ['PAID', 'NOT_PAID', 'CANCELLED'],
          'PAID': ['HELD', 'READY_FOR_PICKUP', 'CANCELLED'],
        },
        requiredFieldsPerStatus: {
          'PAID': ['payment_method', 'payment_date'],
          'HELD': ['hold_date', 'expiration_date'],
          'READY_FOR_PICKUP': ['ready_date'],
          'PICKED_UP': ['pickup_date']
        }
      },
      'special_order': {
        primarySheetId: process.env.SPECIAL_ORDERS_SHEET_ID,
        eventLogSheetId: process.env.SPECIAL_ORDERS_EVENT_LOG_SHEET_ID,
      }
    };
  }

  async logEvent(requestData) {
    try {
      const { requestType, requestId, action, userId, additionalMetadata } = requestData;
      const typeConfig = this.REQUEST_TYPES[requestType];

      if (!typeConfig) {
        throw new Error(`Unsupported request type: ${requestType}`);
      }

      const doc = new GoogleSpreadsheet(typeConfig.eventLogSheetId, this.serviceAccountAuth);
      await doc.loadInfo();
      
      const eventLogSheet = doc.sheetsByIndex[0];
      
      await eventLogSheet.addRow({
        RequestID: requestId,
        RequestType: requestType,
        Action: action,
        Timestamp: new Date().toISOString(),
        UserId: userId,
        AdditionalMetadata: JSON.stringify(additionalMetadata || {})
      });

      return { success: true, message: 'Event logged successfully' };
    } catch (error) {
      console.error('Event logging error:', error);
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

  async updateRequestStatus(requestData) {
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

    // Log the status change event
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

    // TODO: Update primary sheet with new status
    return { success: true };
  }
}

module.exports = new RequestEventLogger();