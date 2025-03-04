const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

class RequestDashboard {
  constructor() {
    // Initialize Google Sheets authentication
    this.serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  }

  async generateDashboard() {
    try {
      const doc = new GoogleSpreadsheet(this.spreadsheetId, this.serviceAccountAuth);
      await doc.loadInfo();
      
      // Assume first sheet is the main requests log
      const requestsSheet = doc.sheetsByIndex[0];
      const rows = await requestsSheet.getRows();
  
      // Create or get Dashboard sheet
      let dashboardSheet = doc.sheetsByTitle['Dashboard'];
      if (!dashboardSheet) {
        dashboardSheet = await doc.addSheet({ 
          title: 'Dashboard', 
          headerValues: ['Metric', 'Value', 'Details']
        });
      }
  
      // Ensure sheet is clear and has correct headers
      await dashboardSheet.clear();
      await dashboardSheet.setHeaderRow(['Metric', 'Value', 'Details']);
  
      // Calculate Metrics
      const metrics = this.calculateMetrics(rows);
  
      // Write Metrics to Dashboard
      await dashboardSheet.addRows([
        ['Total Requests', metrics.totalRequests, ''],
        ['Pending Requests', metrics.pendingRequests, ''],
        ['Completed Requests', metrics.completedRequests, ''],
        ['In Progress Requests', metrics.inProgressRequests, ''],
        ['Average Request Priority', metrics.averagePriority.toFixed(2), 'Scale: Low=1, Standard=2, High=3, Urgent=4'],
        ['Requests by Type', '', ''],
        ...Object.entries(metrics.requestsByType).map(([type, count]) => 
          [`- ${type}`, count, '']
        ),
        ['Requests by Priority', '', ''],
        ...Object.entries(metrics.requestsByPriority).map(([priority, count]) => 
          [`- ${priority}`, count, '']
        )
      ]);
  
      return metrics;
    } catch (error) {
      console.error('Error generating dashboard:', error);
      console.error('Full error details:', error.stack);
      throw error;
    }
  }

  calculateMetrics(rows) {
    const metrics = {
      totalRequests: rows.length,
      pendingRequests: 0,
      completedRequests: 0,
      inProgressRequests: 0,
      averagePriority: 0,
      requestsByType: {},
      requestsByPriority: {}
    };

    // Priority mapping
    const priorityMap = {
      'Low': 1,
      'Standard': 2,
      'High': 3,
      'Urgent': 4
    };

    let totalPriorityValue = 0;

    rows.forEach(row => {
      // Status counting
      switch(row.Status) {
        case 'New':
        case 'Pending':
          metrics.pendingRequests++;
          break;
        case 'Completed':
        case 'Closed':
          metrics.completedRequests++;
          break;
        case 'In Progress':
          metrics.inProgressRequests++;
          break;
      }

      // Type counting
      metrics.requestsByType[row.Type] = 
        (metrics.requestsByType[row.Type] || 0) + 1;

      // Priority counting
      metrics.requestsByPriority[row.Priority] = 
        (metrics.requestsByPriority[row.Priority] || 0) + 1;

      // Priority calculation
      totalPriorityValue += priorityMap[row.Priority] || 2; // Default to Standard
    });

    // Calculate average priority
    metrics.averagePriority = rows.length > 0 
      ? totalPriorityValue / rows.length 
      : 0;

    return metrics;
  }

  async getRequestTrends() {
    try {
      const doc = new GoogleSpreadsheet(this.spreadsheetId, this.serviceAccountAuth);
      await doc.loadInfo();
      
      const requestsSheet = doc.sheetsByIndex[0];
      const rows = await requestsSheet.getRows();

      // Group requests by creation date
      const requestsByDate = rows.reduce((acc, row) => {
        const createdAt = new Date(row.CreatedAt).toISOString().split('T')[0];
        acc[createdAt] = (acc[createdAt] || 0) + 1;
        return acc;
      }, {});

      return requestsByDate;
    } catch (error) {
      console.error('Error retrieving request trends:', error);
      throw error;
    }
  }
}

module.exports = new RequestDashboard();