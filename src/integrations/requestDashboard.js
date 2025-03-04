// integrations/requestDashboard.js
const { getCollections } = require('../database/mongodb');

class RequestDashboard {
  constructor() {
    // No initialization needed for MongoDB
  }

  async generateDashboard() {
    try {
      // Get MongoDB collections
      const { requests } = await getCollections();
      
      // Get all requests
      const rows = await requests.find({}).toArray();
  
      // Calculate Metrics
      const metrics = this.calculateMetrics(rows);
  
      // You may want to store the dashboard metrics in MongoDB for future reference
      // This is optional but could be useful for historical tracking
      try {
        const { events } = await getCollections();
        await events.insertOne({
          action: 'DASHBOARD_GENERATED',
          timestamp: new Date(),
          metrics: metrics
        });
      } catch (error) {
        console.error('Error saving dashboard metrics:', error);
      }
  
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
      switch(row.status) {
        case 'NEW':
        case 'PENDING':
          metrics.pendingRequests++;
          break;
        case 'COMPLETED':
        case 'CLOSED':
          metrics.completedRequests++;
          break;
        case 'IN_PROGRESS':
        case 'ORDERED':
        case 'RECEIVED':
        case 'NOTIFIED':
        case 'PAID':
          metrics.inProgressRequests++;
          break;
      }

      // Type counting
      metrics.requestsByType[row.type] = 
        (metrics.requestsByType[row.type] || 0) + 1;

      // Priority counting
      metrics.requestsByPriority[row.priority] = 
        (metrics.requestsByPriority[row.priority] || 0) + 1;

      // Priority calculation
      totalPriorityValue += priorityMap[row.priority] || 2; // Default to Standard
    });

    // Calculate average priority
    metrics.averagePriority = rows.length > 0 
      ? totalPriorityValue / rows.length 
      : 0;

    return metrics;
  }

  async getRequestTrends() {
    try {
      // Get MongoDB collections
      const { requests } = await getCollections();
      
      // Get all requests
      const rows = await requests.find({}).toArray();

      // Group requests by creation date
      const requestsByDate = rows.reduce((acc, row) => {
        // Convert MongoDB date to YYYY-MM-DD format
        const createdAt = new Date(row.createdAt).toISOString().split('T')[0];
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