// integrations/bookHoldPrinter.js
const fs = require('fs');
const path = require('path');

class BookHoldPrinter {
  constructor() {
    // Setup logging directory
    this.logDirectory = path.join(__dirname, '../../logs');
    if (!fs.existsSync(this.logDirectory)) {
      fs.mkdirSync(this.logDirectory, { recursive: true });
    }
  }

  generatePrintContent(requestData) {
    return `
BOOK HOLD TICKET
=====================================
Request ID: ${requestData.requestId}
Date: ${new Date().toLocaleString()}
-------------------------------------
Customer: ${requestData.customerName}
Contact: ${requestData.customerContact}
-------------------------------------
Request Details:
${requestData.details}
-------------------------------------
Priority: ${requestData.priority}
Status: PENDING
=====================================
Logged by Request Management System
    `;
  }

  printBookHold(requestData) {
    return new Promise((resolve, reject) => {
      try {
        // Generate print content
        const printContent = this.generatePrintContent(requestData);
        
        // Log to file instead of printing
        const logFileName = 'book_hold_tickets.log';
        const logFilePath = path.join(this.logDirectory, logFileName);
        
        fs.appendFileSync(logFilePath, `\n${printContent}\n`);
        
        console.log(`Book hold ticket logged for ${requestData.customerName} (instead of printing)`);
        
        resolve({
          success: true,
          message: 'Book hold ticket logged successfully (paper-saving mode)',
          requestId: requestData.requestId
        });
      } catch (error) {
        console.error('Error logging book hold ticket:', error);
        reject(error);
      }
    });
  }
}

module.exports = new BookHoldPrinter();