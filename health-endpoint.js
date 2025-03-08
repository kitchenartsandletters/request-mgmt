// Create this as a separate file and import it in your app.js
const express = require('express');
const router = express.Router();

// Simple health check endpoint
router.get('/health', (req, res) => {
  res.status(200).send('OK');
});

module.exports = router;