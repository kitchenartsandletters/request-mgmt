// healthcheck-server.js - A simple standalone server for health checks
const express = require('express');
const http = require('http');

// Create Express app
const app = express();

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('Health check received');
  res.status(200).send('OK');
});

// Default route
app.get('*', (req, res) => {
  console.log(`Request received: ${req.method} ${req.path}`);
  res.status(200).send('Health check server running');
});

// Start server
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down');
  server.close();
  process.exit(0);
});