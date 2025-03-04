const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

class RequestManager {
  constructor() {
    // Initialize Google Sheets authentication
    this.serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    // Request type configurations
    this.REQUEST_TYPES = {
      'book_hold': {
        sheetId: 'book_holds_sheet_id', // Specific sheet for book holds
        actions: {
          'mark_paid': {
            requiredFields: ['order_number'],
            validate: (data) => {
              if (!data.order_number) {
                throw new Error('Order number is required to mark as PAID');
              }
            },
            updateStatus: (row) => {
              row.Status = 'PAID';
              row.PaidDate = new Date().toISOString();
            }
          },
          'mark_not_paid': {
            validate: (data) => {
              // Optional: Add specific validation for not paid status
            },
            updateStatus: (row) => {
              row.Status = 'NOT PAID';
            }
          },
          'mark_notified': {
            requiredFields: ['notification_date'],
            validate: (data) => {
              if (!data.notification_date) {
                throw new Error('Notification date is required');
              }
            },
            updateStatus: (row) => {
              row.Status = 'NOTIFIED';
              row.NotificationDate = new Date(data.notification_date).toISOString();
            }
          }
        }
      },
      'special_order': {
        sheetId: 'special_orders_sheet_id',
        actions: {
          // Similar action definitions for special orders
        }
      }
    };
  }

  async updateRequestStatus(requestId, requestType, actionType, additionalData = {}) {
    try {
      const doc = new GoogleSpreadsheet(this.REQUEST_TYPES[requestType].sheetId, this.serviceAccountAuth);
      await doc.loadInfo();
      
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();
      
      // Find the specific request
      const requestRow = rows.find(row => row.RequestID === requestId);
      
      if (!requestRow) {
        throw new Error(`Request ${requestId} not found`);
      }

      // Get action configuration
      const actionConfig = this.REQUEST_TYPES[requestType].actions[actionType];
      
      if (!actionConfig) {
        throw new Error(`Invalid action ${actionType} for request type ${requestType}`);
      }

      // Validate required fields
      if (actionConfig.requiredFields) {
        actionConfig.requiredFields.forEach(field => {
          if (!additionalData[field]) {
            throw new Error(`${field} is required for this action`);
          }
        });
      }

      // Custom validation
      if (actionConfig.validate) {
        actionConfig.validate(additionalData);
      }

      // Update status
      actionConfig.updateStatus(requestRow);

      // Save additional data if provided
      Object.keys(additionalData).forEach(key => {
        requestRow[key] = additionalData[key];
      });

      // Save changes
      await requestRow.save();

      return requestRow;
    } catch (error) {
      console.error('Error updating request status:', error);
      throw error;
    }
  }
}

module.exports = new RequestManager();