// In a new file: src/integrations/services/requestLogger.js
const fs = require('fs');
const path = require('path');

class RequestLogger {
  constructor() {
    // Create a logs directory if it doesn't exist
    this.logDirectory = path.join(__dirname, '../../../logs');
    if (!fs.existsSync(this.logDirectory)) {
      fs.mkdirSync(this.logDirectory);
    }
  }

  logRequest(requestData) {
    const logFileName = `${requestData.requestType}_requests.log`;
    const logFilePath = path.join(this.logDirectory, logFileName);

    const logEntry = `
REQUEST DETAILS
---------------
ID: ${requestData.requestId}
Type: ${requestData.requestType}
Customer: ${requestData.customerName}
Contact: ${requestData.customerContact}
Details: ${requestData.details}
Priority: ${requestData.priority}
Timestamp: ${new Date().toISOString()}
---------------

`;

    try {
      fs.appendFileSync(logFilePath, logEntry);
      console.log(`Request logged to ${logFileName}`);
      return true;
    } catch (error) {
      console.error('Error logging request:', error);
      return false;
    }
  }
}

module.exports = new RequestLogger();