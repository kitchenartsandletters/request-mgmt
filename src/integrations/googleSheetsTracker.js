const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

class RequestTracker {
  constructor() {
    // Initialize Google Sheets authentication
    this.serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  }

  async addRequest(requestData) {
    try {
      const doc = new GoogleSpreadsheet(this.spreadsheetId, this.serviceAccountAuth);
      await doc.loadInfo();
      
      // Assume first sheet is for requests
      const sheet = doc.sheetsByIndex[0];

      // Add row with request details
      const row = await sheet.addRow({
        RequestID: requestData.requestId,
        Type: requestData.type,
        CustomerName: requestData.customerName,
        CustomerContact: requestData.customerContact,
        Details: requestData.details,
        Priority: requestData.priority,
        Status: 'New',
        CreatedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString()
      });

      return row;
    } catch (error) {
      console.error('Error adding request to Google Sheets:', error);
      throw error;
    }
  }

  async updateRequestStatus(requestId, status) {
    try {
      const doc = new GoogleSpreadsheet(this.spreadsheetId, this.serviceAccountAuth);
      await doc.loadInfo();
      
      const sheet = doc.sheetsByIndex[0];
      
      // Find the row with matching RequestID
      const rows = await sheet.getRows();
      const requestRow = rows.find(row => row.RequestID === requestId);

      if (requestRow) {
        requestRow.Status = status;
        requestRow.UpdatedAt = new Date().toISOString();
        await requestRow.save();
        return requestRow;
      }

      throw new Error(`Request with ID ${requestId} not found`);
    } catch (error) {
      console.error('Error updating request status:', error);
      throw error;
    }
  }

  async getRequestByID(requestId) {
    try {
      const doc = new GoogleSpreadsheet(this.spreadsheetId, this.serviceAccountAuth);
      await doc.loadInfo();
      
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();
      
      return rows.find(row => row.RequestID === requestId);
    } catch (error) {
      console.error('Error retrieving request:', error);
      throw error;
    }
  }

  async searchRequests(query) {
    try {
      const doc = new GoogleSpreadsheet(this.spreadsheetId, this.serviceAccountAuth);
      await doc.loadInfo();
      
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();
      
      // Basic search across all columns
      return rows.filter(row => 
        Object.values(row).some(
          value => value.toString().toLowerCase().includes(query.toLowerCase())
        )
      );
    } catch (error) {
      console.error('Error searching requests:', error);
      throw error;
    }
  }
}

module.exports = new RequestTracker();