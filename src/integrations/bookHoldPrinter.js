// integrations/bookHoldPrinter.js
const fs = require('fs');
const path = require('path');
const { getCollections } = require('../database/mongodb');

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

  async printBookHold(requestData) {
    return new Promise(async (resolve, reject) => {
      try {
        // Generate print content
        const printContent = this.generatePrintContent(requestData);
        
        // Log to file instead of printing
        const logFileName = 'book_hold_tickets.log';
        const logFilePath = path.join(this.logDirectory, logFileName);
        
        fs.appendFileSync(logFilePath, `\n${printContent}\n`);
        
        console.log(`Book hold ticket logged for ${requestData.customerName} (instead of printing)`);
        
        // Optionally log to MongoDB as well
        try {
          const { events } = await getCollections();
          await events.insertOne({
            requestId: requestData.requestId,
            action: 'BOOK_HOLD_TICKET_CREATED',
            timestamp: new Date(),
            printContent: printContent,
            customerName: requestData.customerName,
            customerContact: requestData.customerContact,
          });
        } catch (dbError) {
          console.error('Error logging book hold ticket to MongoDB:', dbError);
          // Continue even if MongoDB logging fails
        }
        
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