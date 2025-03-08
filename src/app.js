require('dotenv').config();
const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const { connectToDatabase } = require('./database/mongodb');
const UnifiedEventLogger = require('./integrations/services/unifiedEventLogger');
const RequestDashboard = require('./integrations/requestDashboard');
const BookHoldPrinter = require('./integrations/bookHoldPrinter');
const express = require('express');
const expressApp = express();
const healthEndpoint = require('../health-endpoint');

// Add health check endpoint
expressApp.use(healthEndpoint);
expressApp.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Log incoming requests for debugging
expressApp.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Start the express app separately for health checks
const PORT = process.env.PORT || 3000;
expressApp.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
  console.log(`Health check endpoint available at: http://localhost:${PORT}/health`);
});

// Configure request types for book holds
UnifiedEventLogger.REQUEST_TYPES.book_hold.requiredFieldsPerStatus.PAID = ['payment_method', 'order_number'];
console.log('Updated PAID status requirements:', 
  UnifiedEventLogger.REQUEST_TYPES.book_hold.requiredFieldsPerStatus.PAID);

// Initialize MongoDB connection
async function initDatabase() {
  try {
    await connectToDatabase();
    console.log('MongoDB connection initialized successfully');
  } catch (error) {
    console.error('Failed to initialize MongoDB connection:', error);
    process.exit(1); // Exit on database connection failure
  }
}

// Initialize Slack App with Socket Mode for all environments
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  // Set log level instead of custom logger
  logLevel: 'debug'
});

// Log socket connection status
app.use(async ({ next }) => {
  console.log('Socket connection active - middleware triggered');
  await next();
});

// ========= VALIDATION FUNCTIONS ============

// Validation function for ISBN numbers with proper length checks and checksum validation
function validateISBN(isbn) {
  // Remove any hyphens or spaces
  const cleanISBN = isbn.replace(/[-\s]/g, '');
  
  if (cleanISBN.trim() === '') {
    return { 
      valid: false, 
      error: "ISBN cannot be empty" 
    };
  }
  
  // If the ISBN is all digits, enforce length rules
  if (/^\d+$/.test(cleanISBN)) {
    if (cleanISBN.length === 13) {
      if (!/^(978|979)/.test(cleanISBN)) {
        return { 
          valid: false, 
          error: "ISBN-13 must start with 978 or 979" 
        };
      }
      // Add checksum validation for ISBN-13
      if (!isValidISBN13(cleanISBN)) {
         return { 
           valid: false, 
           error: "Invalid ISBN-13 checksum" 
         };
      }
      return { valid: true };
    } else if (cleanISBN.length === 10) {
      // Add checksum validation for ISBN-10
      if (!isValidISBN10(cleanISBN)) {
         return { 
           valid: false, 
           error: "Invalid ISBN-10 checksum" 
         };
      }
      return { valid: true };
    } else {
      return { 
        valid: false, 
        error: "Numeric ISBN must be either 10 or 13 digits long" 
      };
    }
  }
  
  // For non-numeric input (custom SKUs), just ensure it's not empty
  return { valid: true };
}

// Helper function to validate ISBN-13 checksum
function isValidISBN13(isbn) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += (i % 2 === 0 ? 1 : 3) * parseInt(isbn[i], 10);
  }
  const checksum = (10 - (sum % 10)) % 10;
  return checksum === parseInt(isbn[12], 10);
}

// Helper function to validate ISBN-10 checksum
function isValidISBN10(isbn) {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (10 - i) * parseInt(isbn[i], 10);
  }
  let checkDigit = isbn[9].toUpperCase() === 'X' ? 10 : parseInt(isbn[9], 10);
  sum += checkDigit;
  return sum % 11 === 0;
}

// Validation function for Order Numbers
function validateOrderNumber(orderNumber) {
  // Remove any spaces that might be in the order number
  const cleanOrderNumber = orderNumber.replace(/\s/g, '');
  
  // Check if it's a draft order (starts with D followed by numbers)
  if (/^D\d+$/.test(cleanOrderNumber)) {
    return { valid: true };
  }
  
  // Check if it's a 5-digit order number
  if (/^\d{5}$/.test(cleanOrderNumber)) {
    return { valid: true };
  }
  
  // Check if it's a longer order number (more than 5 digits) starting with 1
  if (/^1\d{5,}$/.test(cleanOrderNumber)) {
    return { valid: true };
  }
  
  // If it doesn't match any of the valid patterns
  return { 
    valid: false, 
    error: "Order number must be either: 5 digits, more than 5 digits starting with '1', or start with 'D' followed by numbers" 
  };
}

// Helper function to guess if a contact value is an email or phone
function guessContactType(value) {
  // Clean the value
  const cleanValue = value.trim();
  
  // Check if it contains an @ symbol - likely an email
  if (cleanValue.includes('@')) {
    return 'email';
  }
  
  // If it contains digits and common phone characters, likely a phone number
  if (/[\d\+\-\(\)\.\s]/.test(cleanValue) && cleanValue.replace(/[^\d\+]/g, '').length >= 4) {
    return 'phone';
  }
  
  // If we can't tell, try both validations
  return 'unknown';
}

// Validation function for email addresses
function validateEmail(email) {
  // Trim the email to remove leading/trailing whitespace
  const trimmedEmail = email.trim();
  
  if (trimmedEmail === '') {
    return {
      valid: false,
      error: "Email address cannot be empty"
    };
  }
  
  // Regular expression for standard email validation
  // This checks for:
  // - At least one character before the @ symbol
  // - At least one character between @ and the domain
  // - A domain with at least one period and appropriate characters
  // - A TLD of at least 2 characters after the last period
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  
  if (!emailRegex.test(trimmedEmail)) {
    return {
      valid: false,
      error: "Please enter a valid email address (e.g., name@example.com)"
    };
  }
  
  return { valid: true };
}

// Validation function for phone numbers
function validatePhoneNumber(phone) {
  // Remove spaces, hyphens, periods, and parentheses
  const cleanPhone = phone.replace(/[\s\-\.\(\)]/g, '');
  
  if (cleanPhone === '') {
    return {
      valid: false,
      error: "Phone number cannot be empty"
    };
  }
  
  // Check for international format starting with +
  if (cleanPhone.startsWith('+')) {
    // For international numbers, allow any length but require at least 8 digits
    // after the + sign (minimum for most countries)
    if (cleanPhone.length < 9) { // +1234567 is too short
      return {
        valid: false,
        error: "International phone number is too short"
      };
    }
    
    // Make sure the rest of the number is numeric
    if (!/^\+\d+$/.test(cleanPhone)) {
      return {
        valid: false,
        error: "International phone number can only contain digits after the '+'"
      };
    }
    
    return { valid: true };
  }
  
  // For domestic numbers, require exactly 10 digits
  if (cleanPhone.length !== 10) {
    return {
      valid: false,
      error: "Phone number must be 10 digits (or include '+' for international format)"
    };
  }
  
  // Make sure the number is numeric
  if (!/^\d+$/.test(cleanPhone)) {
    return {
      valid: false,
      error: "Phone number can only contain digits"
    };
  }
  
  return { valid: true };
}

// ======== END VALIDATION FUNCTIONS =========

// Step 1: Request Type Selection Modal
const createRequestTypeModal = () => {
  return {
    type: "modal",
    callback_id: "request_type_selection",
    title: {
      type: "plain_text",
      text: "Create New Request",
      emoji: true
    },
    submit: {
      type: "plain_text",
      text: "Next",
      emoji: true
    },
    close: {
      type: "plain_text",
      text: "Cancel",
      emoji: true
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Please select the type of request you'd like to create:"
        }
      },
      {
        type: "input",
        block_id: "request_type",
        label: {
          type: "plain_text",
          text: "Request Type"
        },
        element: {
          type: "static_select",
          action_id: "request_type_select",
          placeholder: {
            type: "plain_text",
            text: "Select a request type"
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "Special Order"
              },
              value: "special_order"
            },
            {
              text: {
                type: "plain_text",
                text: "Book Hold"
              },
              value: "book_hold"
            },
            {
              text: {
                type: "plain_text",
                text: "Backorder Request"
              },
              value: "backorder_request"
            },
            {
              text: {
                type: "plain_text",
                text: "Out of Print Search"
              },
              value: "out_of_print"
            },
            {
              text: {
                type: "plain_text",
                text: "Bulk Order"
              },
              value: "bulk_order"
            },
            {
              text: {
                type: "plain_text",
                text: "Personalization Request"
              },
              value: "personalization"
            }
          ]
        }
      }
    ]
  };
};

// Helper function to format request type names
const formatRequestTypeName = (requestType) => {
  const names = {
    'special_order': 'Special Order',
    'book_hold': 'Book Hold',
    'backorder_request': 'Backorder Request',
    'out_of_print': 'Out-of-Print Search',
    'bulk_order': 'Bulk Order',
    'personalization': 'Personalization Request'
  };
  
  return names[requestType] || requestType;
};

// UPDATED: Fixed createTypeSpecificModal without min_date property
const createTypeSpecificModal = (requestType) => {
  // Calculate tomorrow's date at the beginning of the function - available to all case blocks
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 0);
  const tomorrowFormatted = tomorrow.toISOString().split('T')[0];

  // Common blocks for all request types - with field ordering changes
  const commonBlocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Creating a new ${formatRequestTypeName(requestType)}*`
      }
    },
    {
      type: "input",
      block_id: "customer_name",
      label: {
        type: "plain_text",
        text: "Customer Name"
      },
      element: {
        type: "plain_text_input",
        action_id: "customer_name_input",
        placeholder: {
          type: "plain_text",
          text: "Enter customer name"
        }
      }
    },
    {
      type: "input",
      block_id: "customer_contact",
      label: {
        type: "plain_text",
        text: "Customer Contact"
      },
      element: {
        type: "plain_text_input",
        action_id: "customer_contact_input",
        placeholder: {
          type: "plain_text",
          text: "Email (name@example.com) or phone (10 digits)"
        }
      }
    }
  ];

  // Type-specific blocks based on the request type
  let typeSpecificBlocks = [];

  switch (requestType) {
    case 'special_order':
      typeSpecificBlocks = [
        {
          type: "input",
          block_id: "vendor_publisher",
          label: {
            type: "plain_text",
            text: "Vendor/Publisher"
          },
          element: {
            type: "plain_text_input",
            action_id: "vendor_publisher_input",
            placeholder: {
              type: "plain_text",
              text: "Enter vendor or publisher name"
            }
          }
        },
        // Added optional ISBN field for Special Order
        {
          type: "input",
          block_id: "isbn",
          optional: true,
          label: {
            type: "plain_text",
            text: "ISBN"
          },
          element: {
            type: "plain_text_input",
            action_id: "isbn_input",
            placeholder: {
              type: "plain_text",
              text: "Enter book ISBN (13-digit standard starts with 978 or 979)"
            }
          }
        },
        {
          type: "input",
          block_id: "request_details",
          label: {
            type: "plain_text",
            text: "Request Details"
          },
          element: {
            type: "plain_text_input",
            action_id: "request_details_input",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "Provide specific details about the request"
            }
          }
        },
        {
          type: "input",
          block_id: "date_needed",
          label: {
            type: "plain_text",
            text: "Date Needed"
          },
          element: {
            type: "datepicker",
            action_id: "date_needed_input",
            // Removed min_date property
            placeholder: {
              type: "plain_text",
              text: "Select a date (must be future date)"
            }
          }
        }
      ];
      break;

    case 'book_hold':
      typeSpecificBlocks = [
        {
          type: "input",
          block_id: "isbn",
          label: {
            type: "plain_text",
            text: "ISBN"
          },
          element: {
            type: "plain_text_input",
            action_id: "isbn_input",
            placeholder: {
              type: "plain_text",
              text: "Enter book ISBN (13-digit standard starts with 978 or 979)"
            }
          }
        },
        {
          type: "input",
          block_id: "request_details",
          label: {
            type: "plain_text",
            text: "Request Details"
          },
          element: {
            type: "plain_text_input",
            action_id: "request_details_input",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "Provide specific details about the request"
            }
          }
        },
        {
          type: "input",
          block_id: "pickup_date",
          label: {
            type: "plain_text",
            text: "Pick Up Date",
          },
          element: {
            type: "datepicker",
            action_id: "pickup_date_input",
            placeholder: {
              type: "plain_text",
              text: "Select a date (must be today or future date)",
            }
          }
        }
      ];
      break;

    case 'backorder_request':
      typeSpecificBlocks = [
        {
          type: "input",
          block_id: "vendor_publisher",
          label: {
            type: "plain_text",
            text: "Vendor/Publisher",
          },
          element: {
            type: "plain_text_input",
            action_id: "vendor_publisher_input",
            placeholder: {
              type: "plain_text",
              text: "Enter vendor or publisher name",
            }
          }
        },
        {
          type: "input",
          block_id: "isbn",
          label: {
            type: "plain_text",
            text: "ISBN"
          },
          element: {
            type: "plain_text_input",
            action_id: "isbn_input",
            placeholder: {
              type: "plain_text",
              text: "Enter book ISBN (13-digit standard starts with 978 or 979)"
            }
          }
        },
        {
          type: "input",
          block_id: "request_details",
          label: {
            type: "plain_text",
            text: "Request Details"
          },
          element: {
            type: "plain_text_input",
            action_id: "request_details_input",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "Provide specific details about the request"
            }
          }
        },
        {
          type: "input",
          block_id: "date_needed",
          label: {
            type: "plain_text",
            text: "Date Needed"
          },
          element: {
            type: "datepicker",
            action_id: "date_needed_input",
            // Removed min_date property
            placeholder: {
              type: "plain_text",
              text: "Select a date (must be future date)"
            }
          }
        }
      ];
      break;

    case 'out_of_print':
      typeSpecificBlocks = [
        {
          type: "input",
          block_id: "vendor_publisher",
          label: {
            type: "plain_text",
            text: "Vendor/Publisher"
          },
          element: {
            type: "plain_text_input",
            action_id: "vendor_publisher_input",
            placeholder: {
              type: "plain_text",
              text: "Enter vendor or publisher name"
            }
          }
        },
        {
          type: "input",
          block_id: "request_details",
          label: {
            type: "plain_text",
            text: "Request Details"
          },
          element: {
            type: "plain_text_input",
            action_id: "request_details_input",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "Provide specific details about the request"
            }
          }
        },
        {
          type: "input",
          block_id: "date_needed",
          label: {
            type: "plain_text",
            text: "Date Needed"
          },
          element: {
            type: "datepicker",
            action_id: "date_needed_input",
            // Removed min_date property
            placeholder: {
              type: "plain_text",
              text: "Select a date (must be future date)"
            }
          }
        },
        {
          type: "input",
          block_id: "condition",
          label: {
            type: "plain_text",
            text: "Condition"
          },
          element: {
            type: "static_select",
            action_id: "condition_input",
            placeholder: {
              type: "plain_text",
              text: "Select minimum acceptable condition"
            },
            options: [
              {
                text: {
                  type: "plain_text",
                  text: "New"
                },
                value: "new"
              },
              {
                text: {
                  type: "plain_text",
                  text: "Like New"
                },
                value: "like_new"
              },
              {
                text: {
                  type: "plain_text",
                  text: "Very Good"
                },
                value: "very_good"
              },
              {
                text: {
                  type: "plain_text",
                  text: "Good"
                },
                value: "good"
              },
              {
                text: {
                  type: "plain_text",
                  text: "Fair"
                },
                value: "fair"
              },
              {
                text: {
                  type: "plain_text",
                  text: "Poor"
                },
                value: "poor"
              },
              {
                text: {
                  type: "plain_text",
                  text: "Any Readable Condition"
                },
                value: "any"
              }
            ]
          }
        }
      ];
      break;

    case 'bulk_order':
      typeSpecificBlocks = [
        {
          type: "input",
          block_id: "vendor_publisher",
          label: {
            type: "plain_text",
            text: "Vendor/Publisher"
          },
          element: {
            type: "plain_text_input",
            action_id: "vendor_publisher_input",
            placeholder: {
              type: "plain_text",
              text: "Enter vendor or publisher name"
            }
          }
        },
        {
          type: "input",
          block_id: "isbn",
          label: {
            type: "plain_text",
            text: "ISBN"
          },
          element: {
            type: "plain_text_input",
            action_id: "isbn_input",
            placeholder: {
              type: "plain_text",
              text: "Enter book ISBN (13-digit standard starts with 978 or 979)"
            }
          }
        },
        {
          type: "input",
          block_id: "request_details",
          label: {
            type: "plain_text",
            text: "Request Details"
          },
          element: {
            type: "plain_text_input",
            action_id: "request_details_input",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "Provide specific details about the request"
            }
          }
        },
        {
          type: "input",
          block_id: "date_needed",
          label: {
            type: "plain_text",
            text: "Date Needed"
          },
          element: {
            type: "datepicker",
            action_id: "date_needed_input",
            // Removed min_date property
            placeholder: {
              type: "plain_text",
              text: "Select a date (must be future date)"
            }
          }
        }
      ];
      break;

    case 'personalization':
      typeSpecificBlocks = [
        {
          type: "input",
          block_id: "vendor_publisher",
          label: {
            type: "plain_text",
            text: "Vendor/Publisher"
          },
          element: {
            type: "plain_text_input",
            action_id: "vendor_publisher_input",
            placeholder: {
              type: "plain_text",
              text: "Enter vendor or publisher name"
            }
          }
        },
        {
          type: "input",
          block_id: "isbn",
          label: {
            type: "plain_text",
            text: "ISBN"
          },
          element: {
            type: "plain_text_input",
            action_id: "isbn_input",
            placeholder: {
              type: "plain_text",
              text: "Enter book ISBN (13-digit standard starts with 978 or 979)"
            }
          }
        },
        {
          type: "input",
          block_id: "request_details",
          label: {
            type: "plain_text",
            text: "Request Details"
          },
          element: {
            type: "plain_text_input",
            action_id: "request_details_input",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "Provide specific details about the request"
            }
          }
        },
        {
          type: "input",
          block_id: "date_needed",
          label: {
            type: "plain_text",
            text: "Date Needed"
          },
          element: {
            type: "datepicker",
            action_id: "date_needed_input",
            // Removed min_date property
            placeholder: {
              type: "plain_text",
              text: "Select a date (must be future date)"
            }
          }
        }
      ];
      break;
  }

  // Rest of the function stays the same...
  // ...
  const priorityBlock = {
    type: "input",
    block_id: "priority",
    label: {
      type: "plain_text",
      text: "Priority"
    },
    element: {
      type: "static_select",
      action_id: "priority_select",
      placeholder: {
        type: "plain_text",
        text: "Select priority"
      },
      options: [
        {
          text: {
            type: "plain_text",
            text: "Low"
          },
          value: "low"
        },
        {
          text: {
            type: "plain_text",
            text: "Standard"
          },
          value: "standard"
        },
        {
          text: {
            type: "plain_text",
            text: "High"
          },
          value: "high"
        },
        {
          text: {
            type: "plain_text",
            text: "Urgent"
          },
          value: "urgent"
        }
      ]
    }
  };

  const blocks = [...commonBlocks, ...typeSpecificBlocks, priorityBlock];

  return {
    type: "modal",
    callback_id: "request_submission",
    private_metadata: JSON.stringify({ requestType }),
    title: {
      type: "plain_text",
      text: "Create New Request",
      emoji: true
    },
    submit: {
      type: "plain_text",
      text: "Submit",
      emoji: true
    },
    close: {
      type: "plain_text",
      text: "Back",
      emoji: true
    },
    blocks
  };
};

// Updated createSpecialRequestModal function to reorder fields
const createSpecialRequestModal = () => {
  return {
    type: "modal",
    callback_id: "request_submission",
    title: {
      type: "plain_text",
      text: "Create New Request",
      emoji: true
    },
    submit: {
      type: "plain_text",
      text: "Submit",
      emoji: true
    },
    close: {
      type: "plain_text",
      text: "Cancel",
      emoji: true
    },
    blocks: [
      {
        type: "input",
        block_id: "request_type",
        label: {
          type: "plain_text",
          text: "Request Type"
        },
        element: {
          type: "static_select",
          action_id: "request_type_select",
          placeholder: {
            type: "plain_text",
            text: "Select a request type"
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "Special Order"
              },
              value: "special_order"
            },
            {
              text: {
                type: "plain_text",
                text: "Book Hold"
              },
              value: "book_hold"
            },
            {
              text: {
                type: "plain_text",
                text: "Backorder Request"
              },
              value: "backorder_request"
            },
            {
              text: {
                type: "plain_text",
                text: "Out of Print Search"
              },
              value: "out_of_print"
            },
            {
              text: {
                type: "plain_text",
                text: "Bulk Order"
              },
              value: "bulk_order"
            },
            {
              text: {
                type: "plain_text",
                text: "Personalization Request"
              },
              value: "personalization"
            }
          ]
        }
      },
      {
        type: "input",
        block_id: "customer_name",
        label: {
          type: "plain_text",
          text: "Customer Name"
        },
        element: {
          type: "plain_text_input",
          action_id: "customer_name_input",
          placeholder: {
            type: "plain_text",
            text: "Enter customer name"
          }
        }
      },
      {
        type: "input",
        block_id: "customer_contact",
        label: {
          type: "plain_text",
          text: "Customer Contact"
        },
        element: {
          type: "plain_text_input",
          action_id: "customer_contact_input",
          placeholder: {
            type: "plain_text",
            text: "Phone or email"
          }
        }
      },
      {
        type: "input",
        block_id: "vendor_publisher",
        optional: true,
        label: {
          type: "plain_text",
          text: "Vendor/Publisher"
        },
        element: {
          type: "plain_text_input",
          action_id: "vendor_publisher_input",
          placeholder: {
            type: "plain_text",
            text: "Required for Special Order and Out-of-Print"
          }
        }
      },
      {
        type: "input",
        block_id: "isbn",
        optional: true,
        label: {
          type: "plain_text",
          text: "ISBN"
        },
        element: {
          type: "plain_text_input",
          action_id: "isbn_input",
          placeholder: {
            type: "plain_text",
            text: "Required for Book Hold, Backorder, Bulk Order, and Personalization"
          }
        }
      },
      {
        type: "input",
        block_id: "request_details",
        label: {
          type: "plain_text",
          text: "Request Details"
        },
        element: {
          type: "plain_text_input",
          action_id: "request_details_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Provide specific details about the request"
          }
        }
      },
      {
        type: "input",
        block_id: "date_needed",
        optional: true,
        label: {
          type: "plain_text",
          text: "Date Needed"
        },
        element: {
          type: "datepicker",
          action_id: "date_needed_input",
          placeholder: {
            type: "plain_text",
            text: "Select a date"
          }
        }
      },
      {
        type: "input",
        block_id: "condition",
        optional: true,
        label: {
          type: "plain_text",
          text: "Condition"
        },
        element: {
          type: "static_select",
          action_id: "condition_input",
          placeholder: {
            type: "plain_text",
            text: "Required for Out-of-Print"
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "New"
              },
              value: "new"
            },
            {
              text: {
                type: "plain_text",
                text: "Like New"
              },
              value: "like_new"
            },
            {
              text: {
                type: "plain_text",
                text: "Very Good"
              },
              value: "very_good"
            },
            {
              text: {
                type: "plain_text",
                text: "Good"
              },
              value: "good"
            },
            {
              text: {
                type: "plain_text",
                text: "Fair"
              },
              value: "fair"
            },
            {
              text: {
                type: "plain_text",
                text: "Poor"
              },
              value: "poor"
            },
            {
              text: {
                type: "plain_text",
                text: "Any Readable Condition"
              },
              value: "any"
            }
          ]
        }
      },
      {
        type: "input",
        block_id: "priority",
        label: {
          type: "plain_text",
          text: "Priority"
        },
        element: {
          type: "static_select",
          action_id: "priority_select",
          placeholder: {
            type: "plain_text",
            text: "Select priority"
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "Low"
              },
              value: "low"
            },
            {
              text: {
                type: "plain_text",
                text: "Standard"
              },
              value: "standard"
            },
            {
              text: {
                type: "plain_text",
                text: "High"
              },
              value: "high"
            },
            {
              text: {
                type: "plain_text",
                text: "Urgent"
              },
              value: "urgent"
            }
          ]
        }
      }
    ]
  };
};

// Helper function to get button text based on status
const getStatusButtonText = (nextStatus) => {
  const statusLabels = {
    'PENDING': 'Mark In Progress',
    'PAID': 'Mark as Paid',
    'NOT_PAID': 'Mark as Not Paid',
    'HELD': 'Mark as Held',
    'READY_FOR_PICKUP': 'Ready for Pickup',
    'PICKED_UP': 'Mark as Picked Up',
    'ORDERED': 'Mark as Ordered',
    'RECEIVED': 'Mark as Received',
    'NOTIFIED': 'Customer Notified',
    // 'IN_PROGRESS': 'Start Work', // Removed
    'READY': 'Mark as Ready',
    'COMPLETED': 'Mark as Completed',
    'QUOTED': 'Quote Sent',
    'CONFIRMED': 'Order Confirmed',
    'SEARCHING': 'Start Search',
    'FOUND': 'Item Found',
    'NOT_FOUND': 'Not Found',
    'ACQUIRED': 'Item Acquired',
    'CANCELLED': 'Cancel Request'
  };
  
  return statusLabels[nextStatus] || `Change to ${nextStatus}`;
};

// Helper function to create action buttons based on request type and status
const getActionButtons = (requestId, requestType, currentStatus) => {
  const requestConfig = UnifiedEventLogger.REQUEST_TYPES[requestType];
  
  if (!requestConfig || !requestConfig.statusTransitions[currentStatus]) {
    // Default buttons if config not found
    return [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Mark In Progress"
        },
        value: `${requestId}|${currentStatus}|PENDING`,
        action_id: "update_status_to_pending", // Unique action_id
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Cancel Request"
        },
        value: `${requestId}|${currentStatus}|CANCELLED`,
        action_id: "update_status_to_cancelled", // Unique action_id
        style: "danger"
      }
    ];
  }
  
  // Generate buttons based on available transitions with unique action_ids
  return requestConfig.statusTransitions[currentStatus].map(nextStatus => {
    return {
      type: "button",
      text: {
        type: "plain_text",
        text: getStatusButtonText(nextStatus)
      },
      value: `${requestId}|${currentStatus}|${nextStatus}`,
      action_id: `update_status_to_${nextStatus.toLowerCase()}`, // Unique action_id per status
      style: nextStatus === 'CANCELLED' ? "danger" : undefined
    };
  });
};

// Helper function to format field labels
const formatFieldLabel = (field) => {
  return field
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// UPDATED: Improved buildRequiredFieldsModal - removed min_date/max_date properties
const buildRequiredFieldsModal = (requestId, requestType, status, requiredFields) => {
  console.log('Building modal for', requestType, status, 'with fields:', requiredFields);
  
  // Get today's date for past/current date fields
  const today = new Date();
  const todayFormatted = today.toISOString().split('T')[0];
  
  // Get tomorrow's date for future date fields
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 0);
  const tomorrowFormatted = tomorrow.toISOString().split('T')[0];
  
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Please provide additional information required for *${formatRequestTypeName(requestType)}* request status *${status}*:`
      }
    }
  ];
  
  // Process each required field individually
  for (const field of requiredFields) {
    console.log('Processing field:', field);
    
    if (field === 'estimated_arrival') {
      console.log('Adding datepicker for estimated_arrival');
      
      blocks.push({
        type: "input",
        block_id: 'estimated_arrival',
        label: {
          type: "plain_text",
          text: "Estimated Arrival Date"
        },
        element: {
          type: "datepicker",
          action_id: "estimated_arrival_input",
          initial_date: tomorrowFormatted,
          // Removed min_date property
          placeholder: {
            type: "plain_text",
            text: "Select arrival date (today or future date)"
          }
        }
      });
    } 
    else if (field === 'payment_method') {
      blocks.push({
        type: "input",
        block_id: 'payment_method',
        label: {
          type: "plain_text",
          text: "Payment Method"
        },
        element: {
          type: "static_select",
          action_id: "payment_method_input",
          placeholder: {
            type: "plain_text",
            text: "Select payment method"
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "POS"
              },
              value: "POS"
            },
            {
              text: {
                type: "plain_text",
                text: "Shopify"
              },
              value: "Shopify"
            }
          ]
        }
      });
    }
    else if (field === 'order_number') {
      blocks.push({
        type: "input",
        block_id: 'order_number',
        label: {
          type: "plain_text",
          text: "Order Number"
        },
        element: {
          type: "plain_text_input",
          action_id: "order_number_input",
          placeholder: {
            type: "plain_text",
            text: "Enter order number (5 digits, or start with 1 or D)"
          }
        }
      });
    }
    else if (field === 'order_method') {
      blocks.push({
        type: "input",
        block_id: 'order_method',
        label: {
          type: "plain_text",
          text: "Order Method"
        },
        element: {
          type: "static_select",
          action_id: "order_method_input",
          placeholder: {
            type: "plain_text",
            text: "Select order method"
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "Vendor Website"
              },
              value: "Vendor Website"
            },
            {
              text: {
                type: "plain_text",
                text: "Phone"
              },
              value: "Phone"
            },
            {
              text: {
                type: "plain_text",
                text: "Email"
              },
              value: "Email"
            },
            {
              text: {
                type: "plain_text",
                text: "Distributor"
              },
              value: "Distributor"
            }
          ]
        }
      });
    }
    else if (field === 'notification_method') {
      blocks.push({
        type: "input",
        block_id: 'notification_method',
        label: {
          type: "plain_text",
          text: "Notification Method"
        },
        element: {
          type: "static_select",
          action_id: "notification_method_input",
          placeholder: {
            type: "plain_text",
            text: "Select notification method"
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "Phone"
              },
              value: "Phone"
            },
            {
              text: {
                type: "plain_text",
                text: "Email"
              },
              value: "Email"
            }
            // Removed "Text Message" option as requested
          ]
        }
      });
    }
    else if (field === 'arrival_date' || field === 'notification_date' || field === 'completion_date') {
      blocks.push({
        type: "input",
        block_id: field,
        label: {
          type: "plain_text",
          text: formatFieldLabel(field)
        },
        element: {
          type: "datepicker",
          action_id: `${field}_input`,
          initial_date: todayFormatted,
          // Removed max_date property
          placeholder: {
            type: "plain_text",
            text: `Select ${formatFieldLabel(field).toLowerCase()} (cannot be a future date)`
          }
        }
      });
    }
    else {
      // Default text input for all other fields
      blocks.push({
        type: "input",
        block_id: field,
        label: {
          type: "plain_text",
          text: formatFieldLabel(field)
        },
        element: {
          type: "plain_text_input",
          action_id: `${field}_input`,
          placeholder: {
            type: "plain_text",
            text: `Enter ${formatFieldLabel(field).toLowerCase()}`
          }
        }
      });
    }
  }
  
  return {
    type: "modal",
    callback_id: "required_fields_submission",
    private_metadata: JSON.stringify({ requestId, requestType, status }),
    title: {
      type: "plain_text",
      text: "Additional Information"
    },
    submit: {
      type: "plain_text",
      text: "Submit"
    },
    close: {
      type: "plain_text",
      text: "Cancel"
    },
    blocks
  };
};

// UPDATED: createMarkAsOrderedModal without min_date property
const createMarkAsOrderedModal = (requestId, requestType, currentStatus) => {
  // Get tomorrow's date for the datepicker
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 0);
  const tomorrowFormatted = tomorrow.toISOString().split('T')[0];
  
  return {
    type: "modal",
    callback_id: "mark_as_ordered_submission",
    private_metadata: JSON.stringify({ 
      requestId, 
      requestType, 
      currentStatus, 
      newStatus: 'ORDERED' 
    }),
    title: {
      type: "plain_text",
      text: "Mark as Ordered"
    },
    submit: {
      type: "plain_text",
      text: "Submit"
    },
    close: {
      type: "plain_text",
      text: "Cancel"
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Please provide order information for request *${requestId}*:`
        }
      },
      {
        type: "input",
        block_id: "ordered_by",
        label: {
          type: "plain_text",
          text: "Ordered By"
        },
        element: {
          type: "plain_text_input",
          action_id: "ordered_by_input",
          placeholder: {
            type: "plain_text",
            text: "Enter your name"
          }
        }
      },
      {
        type: "input",
        block_id: "order_method",
        label: {
          type: "plain_text",
          text: "Order Method"
        },
        element: {
          type: "static_select",
          action_id: "order_method_input",
          placeholder: {
            type: "plain_text",
            text: "Select order method"
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "Vendor Website"
              },
              value: "Vendor Website"
            },
            {
              text: {
                type: "plain_text",
                text: "Phone"
              },
              value: "Phone"
            },
            {
              text: {
                type: "plain_text",
                text: "Email"
              },
              value: "Email"
            },
            {
              text: {
                type: "plain_text",
                text: "Distributor"
              },
              value: "Distributor"
            }
          ]
        }
      },
      {
        type: "input",
        block_id: "estimated_arrival",
        label: {
          type: "plain_text",
          text: "Estimated Arrival Date"
        },
        element: {
          type: "datepicker",
          action_id: "estimated_arrival_input",
          initial_date: tomorrowFormatted,
          // Removed the min_date property
          placeholder: {
            type: "plain_text",
            text: "Select arrival date (must be today or future date)"
          }
        }
      }
    ]
  };
};

// Handle slash command to open the initial request type modal
app.command('/request', async ({ body, ack, client }) => {
  // Acknowledge the command request
  await ack();

  try {
    // Open the first modal to select request type
    const result = await client.views.open({
      trigger_id: body.trigger_id,
      view: createRequestTypeModal()
    });
    console.log('Initial request type modal opened successfully');
  } catch (error) {
    console.error('Error opening request type modal:', error);
  }
});

// Handle the selection of request type and show the appropriate form
app.view('request_type_selection', async ({ body, ack, client, view }) => {
  // Get the selected request type
  const requestType = view.state.values.request_type.request_type_select.selected_option.value;
  
  try {
    // Acknowledge with an update flag to replace the view
    await ack({
      response_action: "update",
      view: createTypeSpecificModal(requestType)
    });
    console.log(`Opened type-specific form for ${requestType}`);
  } catch (error) {
    console.error(`Error opening ${requestType} form:`, error);
    
    // If update fails, acknowledge normally and try to push a new view
    try {
      await ack();
      await client.views.push({
        trigger_id: body.trigger_id,
        view: createTypeSpecificModal(requestType)
      });
    } catch (pushError) {
      console.error('Error pushing type-specific view:', pushError);
    }
  }
});

// Fix for Special Order form submission validation
  app.view('request_submission', async ({ body, view, ack, client }) => {
    try {
      // Check if we need to validate any dates before acknowledging
      const { requestType } = JSON.parse(view.private_metadata);
      const values = view.state.values;
  
      // Validate customer contact information
      if (values.customer_contact && values.customer_contact.customer_contact_input) {
        const contactValue = values.customer_contact.customer_contact_input.value;
        
        if (contactValue.trim() === '') {
          await ack({
            response_action: "errors",
            errors: {
              customer_contact: "Contact information cannot be empty"
            }
          });
          return;
        }
        
        // Guess if this is an email or phone number
        const contactType = guessContactType(contactValue);
        
        // Validate based on the guess
        let validationResult;
        
        if (contactType === 'email') {
          validationResult = validateEmail(contactValue);
        } else if (contactType === 'phone') {
          validationResult = validatePhoneNumber(contactValue);
        } else {
          // If we can't determine, try both validations
          const emailResult = validateEmail(contactValue);
          const phoneResult = validatePhoneNumber(contactValue);
          
          // If either validation passes, consider it valid
          if (emailResult.valid || phoneResult.valid) {
            validationResult = { valid: true };
          } else {
            // If both validations fail, use a general error message
            validationResult = {
              valid: false,
              error: "Please enter a valid email address or phone number"
            };
          }
        }
        
        // If validation fails, show error
        if (!validationResult.valid) {
          await ack({
            response_action: "errors",
            errors: {
              customer_contact: validationResult.error
            }
          });
          return;
        }
      } else {
        // No contact information provided
        await ack({
          response_action: "errors",
          errors: {
            customer_contact: "Contact information is required"
          }
        });
        return;
      }
  
      // Validate ISBN for request types that require it
      if (['book_hold', 'backorder_request', 'bulk_order', 'personalization'].includes(requestType) && 
          values.isbn && values.isbn.isbn_input) {
        
        const isbnValue = values.isbn.isbn_input.value;
        const isbnValidation = validateISBN(isbnValue);
        
        if (!isbnValidation.valid) {
          await ack({
            response_action: "errors",
            errors: {
              isbn: isbnValidation.error
            }
          });
          return;
        }
      }
      
      // For Special Order, validate ISBN only if provided (it's optional)
      if (requestType === 'special_order' && 
          values.isbn && 
          values.isbn.isbn_input && 
          values.isbn.isbn_input.value && 
          values.isbn.isbn_input.value.trim() !== '') {
        
        const isbnValidation = validateISBN(values.isbn.isbn_input.value);
        if (!isbnValidation.valid) {
          await ack({
            response_action: "errors",
            errors: {
              isbn: isbnValidation.error
            }
          });
          return;
        }
      }
  
      // Validate Vendor/Publisher for request types that require it
      if (['special_order', 'out_of_print', 'backorder_request', 'bulk_order', 'personalization'].includes(requestType)) {
        if (!values.vendor_publisher || 
            !values.vendor_publisher.vendor_publisher_input || 
            !values.vendor_publisher.vendor_publisher_input.value || 
            values.vendor_publisher.vendor_publisher_input.value.trim() === '') {
          
          await ack({
            response_action: "errors",
            errors: {
              vendor_publisher: "Vendor/Publisher is required"
            }
          });
          return;
        }
      }
  
      // For all request types that have date_needed field, validate it's a future date
      if (['special_order', 'backorder_request', 'bulk_order', 'personalization', 'out_of_print'].includes(requestType) && 
          values.date_needed && 
          values.date_needed.date_needed_input && 
          values.date_needed.date_needed_input.selected_date) {
        
        // Parse the "YYYY-MM-DD" string manually
        const selectedDateString = values.date_needed.date_needed_input.selected_date;
        const [year, month, day] = selectedDateString.split('-').map(Number);
        const selectedDate = new Date(year, month - 1, day); // Creates a date in local time
        
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Beginning of today
        
        // Create tomorrow's date properly
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1); // Add 1 day to get tomorrow
        
        // For date_needed, tomorrow should be allowed (>= tomorrow)
        if (selectedDate < tomorrow) {
          await ack({
            response_action: "errors",
            errors: {
              date_needed: "Date needed must be tomorrow or later"
            }
          });
          return;
        }
      }
  
      // Add specific validation for Book Hold Pick Up Date
      if (requestType === 'book_hold' &&
          values.pickup_date &&
          values.pickup_date.pickup_date_input &&
          values.pickup_date.pickup_date_input.selected_date) {
      
        // Parse the "YYYY-MM-DD" string manually
        const selectedDateString = values.pickup_date.pickup_date_input.selected_date;
        const [year, month, day] = selectedDateString.split('-').map(Number);
        const selectedDate = new Date(year, month - 1, day); // Creates a date in local time
      
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to beginning of today
      
        // Check if the selected date is before today
        if (selectedDate < today) {
          await ack({
            response_action: "errors",
            errors: {
              pickup_date: "Pick Up Date must be today or a future date"
            }
          });
          return;
        }
      }
  
      // All validation has passed, now we can acknowledge the submission
      await ack();
  
      try {
        // Extract values from the submitted form
        const requestId = `REQ-${Date.now()}`;
        
        // Prepare request data based on the request type
        const requestData = {
          requestId,
          type: requestType,
          customerName: values.customer_name.customer_name_input.value,
          customerContact: values.customer_contact.customer_contact_input.value,
          details: values.request_details.request_details_input.value,
          priority: values.priority.priority_select.selected_option.value,
          userId: body.user.id
        };
        
        // Add type-specific fields based on the request type
        switch (requestType) {
          case 'special_order':
          case 'out_of_print':
            requestData.vendorPublisher = values.vendor_publisher.vendor_publisher_input.value;
            requestData.dateNeeded = values.date_needed.date_needed_input.selected_date;
            if (requestType === 'out_of_print') {
              requestData.condition = values.condition.condition_input.selected_option.value;
            }
            // Add ISBN if provided (optional for Special Order)
            if (values.isbn && values.isbn.isbn_input && values.isbn.isbn_input.value) {
              requestData.isbn = values.isbn.isbn_input.value;
            }
            break;
            
          case 'book_hold':
            requestData.isbn = values.isbn.isbn_input.value;
            // Add pickup date if provided
            if (values.pickup_date && values.pickup_date.pickup_date_input) {
              requestData.pickupDate = values.pickup_date.pickup_date_input.selected_date;
            }
            break;
            
          case 'backorder_request':
          case 'bulk_order':
          case 'personalization':
            requestData.vendorPublisher = values.vendor_publisher.vendor_publisher_input.value;
            requestData.isbn = values.isbn.isbn_input.value;
            requestData.dateNeeded = values.date_needed.date_needed_input.selected_date;
            break;
        }
  
        console.log('Processing request submission:', requestData);
  
        // Log the new request using unified logger
        const result = await UnifiedEventLogger.logNewRequest(requestData);
  
        if (!result.success) {
          throw new Error(result.error || 'Failed to create request');
        }
  
        // For book hold requests, log a ticket (instead of printing)
        if (requestData.type === 'book_hold') {
          try {
            await BookHoldPrinter.printBookHold(requestData);
          } catch (printError) {
            console.error('Error logging book hold ticket:', printError);
          }
        }
  
        // Prepare message blocks for posting to channel
        const messageBlocks = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*New ${formatRequestTypeName(requestType)}* \n*Request ID:* ${requestId}`
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Type:* ${formatRequestTypeName(requestType)}`
              },
              {
                type: "mrkdwn",
                text: `*Priority:* ${requestData.priority}`
              },
              {
                type: "mrkdwn",
                text: `*Customer:* ${requestData.customerName}`
              },
              {
                type: "mrkdwn",
                text: `*Contact:* ${requestData.customerContact}`
              }
            ]
          }
        ];
  
        // Add type-specific fields to the message
        const typeSpecificFields = [];
        
        if (requestData.vendorPublisher) {
          typeSpecificFields.push({
            type: "mrkdwn",
            text: `*Vendor/Publisher:* ${requestData.vendorPublisher}`
          });
        }
        
        if (requestData.isbn) {
          typeSpecificFields.push({
            type: "mrkdwn",
            text: `*ISBN:* ${requestData.isbn}`
          });
        }
        
        if (requestData.dateNeeded) {
          typeSpecificFields.push({
            type: "mrkdwn",
            text: `*Date Needed:* ${requestData.dateNeeded}`
          });
        }
        
        if (requestData.pickupDate) {
          typeSpecificFields.push({
            type: "mrkdwn",
            text: `*Pick Up Date:* ${requestData.pickupDate}`
          });
        }
        
        if (requestData.condition) {
          typeSpecificFields.push({
            type: "mrkdwn",
            text: `*Condition:* ${requestData.condition}`
          });
        }
        
        // Add type-specific fields if we have any
        if (typeSpecificFields.length > 0) {
          messageBlocks.push({
            type: "section",
            fields: typeSpecificFields
          });
        }
  
        // Add details and status blocks
        messageBlocks.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Details:*\n${requestData.details}`
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Status:* NEW`
            }
          },
          {
            type: "actions",
            elements: getActionButtons(requestId, requestData.type.toLowerCase(), 'NEW')
          }
        );
  
        // Post to requests channel
        await client.chat.postMessage({
          channel: process.env.REQUESTS_CHANNEL,
          text: `New ${formatRequestTypeName(requestType)}: ${requestId}`,
          blocks: messageBlocks
        });
  
        // Notify the user who submitted the request
        await client.chat.postMessage({
          channel: body.user.id,
          text: `Your ${formatRequestTypeName(requestType)} has been submitted`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:white_check_mark: Your ${formatRequestTypeName(requestType)} *${requestId}* has been submitted successfully.`
              }
            },
            {
              type: "section",
              fields: [
                {
                  type: "mrkdwn",
                  text: `*Priority:* ${requestData.priority}`
                },
                {
                  type: "mrkdwn",
                  text: `*Status:* NEW`
                }
              ]
            }
          ]
        });
  
      } catch (error) {
        console.error('Error in request submission after acknowledgment:', error);
        
        // Notify the user of the error
        try {
          await client.chat.postMessage({
            channel: body.user.id,
            text: `Error submitting request: ${error.message}`
          });
        } catch (notifyError) {
          console.error('Error notifying user of failure:', notifyError);
        }
      }
    } catch (error) {
      console.error('Error in request submission before acknowledgment:', error);
      
      // Try to acknowledge with an error message
      try {
        await ack({
          response_action: "errors",
          errors: {
            general: "An unexpected error occurred. Please try again."
          }
        });
      } catch (ackError) {
        console.error('Error acknowledging with error:', ackError);
        
        // Last resort: try to acknowledge without an error message
        try {
          await ack();
        } catch (finalError) {
          console.error('Final error acknowledging submission:', finalError);
        }
      }
    }
  });

// Fix for Mark as Ordered validation to correctly allow tomorrow
app.view('mark_as_ordered_submission', async ({ body, view, ack, client }) => {
  try {
    // Extract metadata from the modal
    const metadata = JSON.parse(view.private_metadata);
    const requestId = metadata.requestId;
    const requestType = metadata.requestType;
    const currentStatus = metadata.currentStatus || 'NEW';
    const newStatus = metadata.newStatus || 'ORDERED';
    const userId = body.user.id;
    
    // Log what we received
    console.log('Mark as Ordered submission:', {
      metadata,
      values: view.state.values
    });
    
    // Validate estimated arrival date - must be at least tomorrow
    const estimatedArrivalValue = view.state.values.estimated_arrival?.estimated_arrival_input;
    
    if (estimatedArrivalValue && estimatedArrivalValue.selected_date) {
      const selectedDate = new Date(estimatedArrivalValue.selected_date);
      selectedDate.setHours(0, 0, 0, 0); // Beginning of selected day
      
      // Calculate today and tomorrow correctly
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Beginning of today
      
      const tomorrow = new Date();
      tomorrow.setDate(today.getDate() + 0);
      tomorrow.setHours(0, 0, 0, 0); // Beginning of tomorrow
      
      // For estimated arrival, tomorrow should be allowed (>= tomorrow)
      if (selectedDate < tomorrow) {
        await ack({
          response_action: "errors",
          errors: {
            estimated_arrival: "Estimated arrival date must be tomorrow or later"
          }
        });
        return;
      }
    }

      // Validate order number if present
  if (view.state.values.order_number && view.state.values.order_number.order_number_input) {
    const orderNumberValue = view.state.values.order_number.order_number_input.value;
    const orderValidation = validateOrderNumber(orderNumberValue);
    
    if (!orderValidation.valid) {
      await ack({
        response_action: "errors",
        errors: {
          order_number: orderValidation.error
        }
      });
      return;
    }
  }
    
    // Acknowledge the submission
    await ack();
    
    // Get values from the form
    const additionalFields = {
      ordered_by: view.state.values.ordered_by.ordered_by_input.value,
      order_method: view.state.values.order_method.order_method_input.selected_option.value,
      estimated_arrival: estimatedArrivalValue.selected_date,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    };
    
    // Update the request status
    const result = await UnifiedEventLogger.updateRequestStatus({
      requestType,
      requestId,
      currentStatus,
      newStatus,
      userId,
      additionalFields
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Unknown error updating status');
    }
    
    // Rest of the function remains unchanged
    // Update the message in the channel with the new status
    try {
      // Find the message in the channel
      const channelId = process.env.REQUESTS_CHANNEL;
      const messagesResult = await client.conversations.history({
        channel: channelId,
        limit: 100
      });
      
      const requestMessage = messagesResult.messages.find(msg => 
        msg.blocks && 
        msg.blocks.some(block => 
          block.text && 
          block.text.text && 
          block.text.text.includes(requestId)
        )
      );
      
      if (requestMessage) {
        // Update message blocks with new status
        const updatedBlocks = [...requestMessage.blocks];
        
        // Find and update status section
        const statusIndex = updatedBlocks.findIndex(block => 
          block.text && block.text.text && block.text.text.includes('*Status:*')
        );
        
        if (statusIndex !== -1) {
          updatedBlocks[statusIndex] = {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Status:* ${newStatus}`
            }
          };
        }
        
        // Update action buttons
        const typeConfig = UnifiedEventLogger.REQUEST_TYPES[requestType];
        const actionsIndex = updatedBlocks.findIndex(block => block.type === "actions");
        
        if (actionsIndex !== -1 && typeConfig) {
          const nextTransitions = typeConfig.statusTransitions[newStatus] || [];
          
          if (nextTransitions.length > 0) {
            updatedBlocks[actionsIndex] = {
              type: "actions",
              elements: getActionButtons(requestId, requestType, newStatus)
            };
          } else {
            updatedBlocks.splice(actionsIndex, 1);
            updatedBlocks.push({
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `This request is now in a final state (${newStatus}). No further actions available.`
                }
              ]
            });
          }
        }
        
        // Update the message
        await client.chat.update({
          channel: channelId,
          ts: requestMessage.ts,
          blocks: updatedBlocks
        });
      }
    } catch (updateError) {
      console.error('Error updating message:', updateError);
    }
    
    // Notify the user
    await client.chat.postMessage({
      channel: userId,
      text: `Status updated to ${newStatus} for request ${requestId}. Order information saved.`
    });
    
  } catch (error) {
    console.error('Error processing Mark as Ordered submission:', error);
    await ack(); // Must acknowledge even on error
    
    // Notify user of error
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `Error updating status: ${error.message}`
      });
    } catch (notifyError) {
      console.error('Error sending error notification:', notifyError);
    }
  }
});

// Handle all status update actions with dynamic action_id pattern
// Update the status update action handler to handle required fields correctly
app.action(/^update_status_to_.*$/, async ({ body, ack, client }) => {
  await ack();
  
  try {
    const actionId = body.actions[0].action_id;
    const [requestId, currentStatus, newStatus] = body.actions[0].value.split('|');
    const userId = body.user.id;
    
    // Extract request type from message
    let requestType = null;
    
    // First, try to find explicit Type field
    const typeBlock = body.message.blocks.find(block => 
      block.fields && block.fields.some(field => field.text.includes('*Type:*'))
    );
    
    if (typeBlock) {
      const typeField = typeBlock.fields.find(field => field.text.includes('*Type:*'));
      if (typeField) {
        // Extract the type name after "*Type:*"
        const typeName = typeField.text.replace('*Type:*', '').trim();
        
        // Map from display name to internal type code
        const displayToTypeMap = {
          'Special Order': 'special_order',
          'Book Hold': 'book_hold',
          'Backorder Request': 'backorder_request',
          'Out-of-Print Search': 'out_of_print',
          'Bulk Order': 'bulk_order',
          'Personalization Request': 'personalization'
        };
        
        requestType = displayToTypeMap[typeName] || typeName.toLowerCase().replace(/\s+/g, '_');
        console.log(`Extracted request type from Type field: "${typeName}" -> "${requestType}"`);
      }
    }
    
    // If not found in Type field, try title block
    if (!requestType) {
      const titleBlock = body.message.blocks.find(block => 
        block.text && block.text.text && block.text.text.includes('*New ')
      );
      
      if (titleBlock) {
        const titleText = titleBlock.text.text;
        const match = titleText.match(/\*New ([^*]+)\*/);
        if (match && match[1]) {
          const typeName = match[1].trim();
          
          // Same mapping as above
          const displayToTypeMap = {
            'Special Order': 'special_order',
            'Book Hold': 'book_hold',
            'Backorder Request': 'backorder_request',
            'Out-of-Print Search': 'out_of_print',
            'Bulk Order': 'bulk_order',
            'Personalization Request': 'personalization'
          };
          
          requestType = displayToTypeMap[typeName] || typeName.toLowerCase().replace(/\s+/g, '_');
          console.log(`Extracted request type from title: "${typeName}" -> "${requestType}"`);
        }
      }
    }
    
    if (!requestType) {
      throw new Error('Could not determine request type');
    }

    console.log(`Updating status for request type: ${requestType}`);

    if (newStatus === 'PAID') {
      console.log('Fields required for PAID status:', 
        UnifiedEventLogger.REQUEST_TYPES[requestType].requiredFieldsPerStatus[newStatus]);
    }

    // Get the type configuration
    const typeConfig = UnifiedEventLogger.REQUEST_TYPES[requestType];
    
    // Check if additional fields are required for this status transition
    if (typeConfig && 
        typeConfig.requiredFieldsPerStatus && 
        typeConfig.requiredFieldsPerStatus[newStatus] && 
        typeConfig.requiredFieldsPerStatus[newStatus].length > 0) {
      
      // If fields are required, open a modal to collect them BEFORE updating status
      const requiredFields = typeConfig.requiredFieldsPerStatus[newStatus];
      
      // Special handling for Mark as Ordered
      if (newStatus === 'ORDERED') {
        console.log('Special handling for Mark as Ordered');
        
        try {
          // Use the dedicated Mark as Ordered modal
          await client.views.open({
            trigger_id: body.trigger_id,
            view: createMarkAsOrderedModal(requestId, requestType, currentStatus)
          });
          return; // Exit early - actual update will happen after modal submission
        } catch (error) {
          console.error('Error opening Mark as Ordered modal:', error);
          throw new Error(`Failed to open order form: ${error.message}`);
        }
      }
      
      // Try to open modal to collect required fields
      try {
        // Build the modal using our improved function that handles datepickers properly
        const modal = buildRequiredFieldsModal(requestId, requestType, newStatus, requiredFields);
        
        // Add current status to metadata
        const modalMetadata = JSON.parse(modal.private_metadata);
        modalMetadata.currentStatus = currentStatus;
        modal.private_metadata = JSON.stringify(modalMetadata);
        
        // Open the modal
        await client.views.open({
          trigger_id: body.trigger_id,
          view: modal
        });
        return; // Exit early - the actual update will happen after modal submission
      } catch (modalError) {
        console.error('Error opening required fields modal:', modalError);
        throw new Error(`Failed to collect required information: ${modalError.message}`);
      }
    }

    // Only proceed with update if no required fields
    const result = await UnifiedEventLogger.updateRequestStatus({
      requestType,
      requestId,
      currentStatus,
      newStatus,
      userId,
      additionalFields: {
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      }
    });

    if (!result.success) {
      throw new Error(result.error || 'Unknown error updating status');
    }

    // Update the message with new status and action buttons
    const updatedBlocks = [...body.message.blocks];
    
    // Find and update the status section
    const statusIndex = updatedBlocks.findIndex(block => 
      block.text && block.text.text && block.text.text.includes('*Status:*')
    );
    
    if (statusIndex !== -1) {
      updatedBlocks[statusIndex] = {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Status:* ${newStatus}`
        }
      };
    } else {
      // Add a status section if not found
      updatedBlocks.splice(updatedBlocks.length - 1, 0, {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Status:* ${newStatus}`
        }
      });
    }
    
    // Update action buttons or remove them for terminal states
    const nextTransitions = (typeConfig && typeConfig.statusTransitions[newStatus]) || [];
    
    if (nextTransitions.length > 0) {
      // Update action buttons
      updatedBlocks[updatedBlocks.length - 1] = {
        type: "actions",
        elements: getActionButtons(requestId, requestType, newStatus)
      };
    } else {
      // Remove action buttons for terminal states
      updatedBlocks.pop();
      
      // Add a context block indicating completion
      updatedBlocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `This request is now in a final state (${newStatus}). No further actions available.`
          }
        ]
      });
    }

    // Update the message
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: updatedBlocks
    });
  } catch (error) {
    console.error('Error updating request status:', error);
    
    // Notify user of error
    try {
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: body.user.id,
        text: `Error updating status: ${error.message}`
      });
    } catch (notifyError) {
      console.error('Error sending error notification:', notifyError);
    }
  }
});

// FINAL FIX: Required Fields validation with stronger validation for past-only dates
app.view('required_fields_submission', async ({ body, view, ack, client }) => {
  try {
    // Extract metadata and form values
    const metadata = JSON.parse(view.private_metadata);
    const requestId = metadata.requestId;
    const requestType = metadata.requestType;
    const newStatus = metadata.status || metadata.newStatus;
    const currentStatus = metadata.currentStatus || 'NEW';
    const values = view.state.values;
    const userId = body.user.id;

    // Validate order number if present
    if (values.order_number && values.order_number.order_number_input) {
      const orderNumberValue = values.order_number.order_number_input.value;
      const orderValidation = validateOrderNumber(orderNumberValue);
      
      if (!orderValidation.valid) {
        await ack({
          response_action: "errors",
          errors: {
            order_number: orderValidation.error
          }
        });
        return;
      }
    }

    // Debugging: Log the status we're validating for
    console.log(`Validating dates for status: ${newStatus}`);

    // Perform date validation
    // Calculate dates once for consistent comparison
    const now = new Date(); // Current exact time
    
    // Today at beginning of day (midnight)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Tomorrow at beginning of day (midnight)
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    console.log("Date objects for comparison:", {
      now: now.toISOString(),
      today: today.toISOString(),
      tomorrow: tomorrow.toISOString()
    });

    // Check if any date fields need validation
    let dateValidationErrors = {}; // Object to store multiple errors

    // For Mark as Received, arrival_date must not be tomorrow or later
    if (newStatus === 'RECEIVED' && values.arrival_date && values.arrival_date.arrival_date_input) {
      const selectedDate = new Date(values.arrival_date.arrival_date_input.selected_date + "T00:00:00");
      selectedDate.setHours(0, 0, 0, 0);
      
      console.log(`RECEIVED: Validating arrival_date:`, {
        selectedDate: selectedDate.toISOString(),
        today: today.toISOString(),
        tomorrow: tomorrow.toISOString(),
        selectedEqualsToday: selectedDate.getTime() === today.getTime(),
        selectedEqualsTomorrow: selectedDate.getTime() === tomorrow.getTime(),
        selectedGreaterThanEqualTomorrow: selectedDate.getTime() >= tomorrow.getTime()
      });
      
      // Check if the date is tomorrow or later (future date not allowed)
      if (selectedDate.getTime() >= tomorrow.getTime()) {
        dateValidationErrors.arrival_date = 'Arrival date must be today or earlier, not a future date';
      }
    }
    
    // For Customer Notified, notification_date must not be tomorrow or later
    if (newStatus === 'NOTIFIED' && values.notification_date && values.notification_date.notification_date_input) {
      const selectedDate = new Date(values.notification_date.notification_date_input.selected_date + "T00:00:00");
      selectedDate.setHours(0, 0, 0, 0);
      
      console.log(`NOTIFIED: Validating notification_date:`, {
        selectedDate: selectedDate.toISOString(),
        today: today.toISOString(),
        tomorrow: tomorrow.toISOString(),
        selectedEqualsToday: selectedDate.getTime() === today.getTime(),
        selectedEqualsTomorrow: selectedDate.getTime() === tomorrow.getTime(),
        selectedGreaterThanEqualTomorrow: selectedDate.getTime() >= tomorrow.getTime()
      });
      
      // Check if the date is tomorrow or later (future date not allowed)
      if (selectedDate.getTime() >= tomorrow.getTime()) {
        dateValidationErrors.notification_date = 'Notification date must be today or earlier, not a future date';
      }
    }
    
    // For Mark as Completed, completion_date must not be tomorrow or later
    if (newStatus === 'COMPLETED' && values.completion_date && values.completion_date.completion_date_input) {
      const selectedDate = new Date(values.completion_date.completion_date_input.selected_date + "T00:00:00");
      selectedDate.setHours(0, 0, 0, 0);
      
      console.log(`COMPLETED: Validating completion_date:`, {
        selectedDate: selectedDate.toISOString(),
        today: today.toISOString(),
        tomorrow: tomorrow.toISOString(),
        selectedEqualsToday: selectedDate.getTime() === today.getTime(),
        selectedEqualsTomorrow: selectedDate.getTime() === tomorrow.getTime(),
        selectedGreaterThanEqualTomorrow: selectedDate.getTime() >= tomorrow.getTime()
      });
      
      // Check if the date is tomorrow or later (future date not allowed)
      if (selectedDate.getTime() >= tomorrow.getTime()) {
        dateValidationErrors.completion_date = 'Completion date must be today or earlier, not a future date';
      }
    }

    // For estimated arrival dates, ensure they are at least tomorrow
    if (values.estimated_arrival && values.estimated_arrival.estimated_arrival_input) {
      const selectedDate = new Date(values.estimated_arrival.estimated_arrival_input.selected_date);
      selectedDate.setHours(0, 0, 0, 0);
      
      console.log('Validating estimated_arrival:', {
        selectedDate: selectedDate.toISOString(),
        tomorrow: tomorrow.toISOString(),
        selectedLessThanTomorrow: selectedDate.getTime() < tomorrow.getTime()
      });
      
      // For estimated arrival, must be tomorrow or later
      if (selectedDate.getTime() < tomorrow.getTime()) {
        dateValidationErrors.estimated_arrival = 'Estimated arrival date must be tomorrow or later';
      }
    }

    // If validation errors found, reject the submission
    if (Object.keys(dateValidationErrors).length > 0) {
      console.log('Date validation errors:', dateValidationErrors);
      
      await ack({
        response_action: "errors",
        errors: dateValidationErrors
      });
      return;
    }

    // Acknowledge the submission if validation passes
    await ack();
    
    console.log('Modal metadata:', metadata);
    console.log('Processing status update from', currentStatus, 'to', newStatus);
    console.log('Form submission values:', JSON.stringify(values, null, 2));
    
    // Extract field values
    const additionalFields = {
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    };
    
    Object.keys(values).forEach(blockId => {
      const block = values[blockId];
      const actionId = Object.keys(block)[0];
      
      // Special handling for dropdown selects
      if (block[actionId].selected_option) {
        additionalFields[blockId] = block[actionId].selected_option.value;
      } 
      // Special handling for datepickers
      else if (block[actionId].selected_date) {
        additionalFields[blockId] = block[actionId].selected_date;
      }
      // For text inputs and other fields
      else if (block[actionId].value) {
        additionalFields[blockId] = block[actionId].value;
      }
    });
    
    // Rest of the function remains unchanged
    // Now perform the actual status update with the collected fields
    const result = await UnifiedEventLogger.updateRequestStatus({
      requestType,
      requestId,
      currentStatus: currentStatus,
      newStatus,
      userId,
      additionalFields
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Unknown error updating status');
    }
    
    // Log the additional fields
    await UnifiedEventLogger.logEvent({
      requestType,
      requestId,
      action: `FIELDS_ADDED`,
      userId,
      additionalMetadata: additionalFields
    });
    
    // Find and update the message in the channel
    try {
      // Search for messages in the requests channel
      const channelId = process.env.REQUESTS_CHANNEL;
      const messagesResult = await client.conversations.history({
        channel: channelId,
        limit: 100 // Adjust as needed
      });
      
      const requestMessage = messagesResult.messages.find(msg => 
        msg.blocks && 
        msg.blocks.some(block => 
          block.text && 
          block.text.text && 
          block.text.text.includes(requestId)
        )
      );
      
      if (requestMessage) {
        // Update the message with new status
        const updatedBlocks = [...requestMessage.blocks];
        
        // Find and update the status section
        const statusIndex = updatedBlocks.findIndex(block => 
          block.text && block.text.text && block.text.text.includes('*Status:*')
        );
        
        if (statusIndex !== -1) {
          updatedBlocks[statusIndex] = {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Status:* ${newStatus}`
            }
          };
        }
        
        // Get the type configuration
        const typeConfig = UnifiedEventLogger.REQUEST_TYPES[requestType];
        
        // Update action buttons
        const actionsIndex = updatedBlocks.findIndex(block => block.type === "actions");
        if (actionsIndex !== -1) {
          const nextTransitions = (typeConfig && typeConfig.statusTransitions[newStatus]) || [];
          
          if (nextTransitions.length > 0) {
            updatedBlocks[actionsIndex] = {
              type: "actions",
              elements: getActionButtons(requestId, requestType, newStatus)
            };
          } else {
            // Remove action buttons for terminal states
            updatedBlocks.splice(actionsIndex, 1);
            
            // Add a context block indicating completion
            updatedBlocks.push({
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `This request is now in a final state (${newStatus}). No further actions available.`
                }
              ]
            });
          }
        }
        
        // Update the message
        await client.chat.update({
          channel: channelId,
          ts: requestMessage.ts,
          blocks: updatedBlocks
        });
      }
    } catch (updateError) {
      console.error('Error updating message:', updateError);
    }
    
    // Notify the user
    await client.chat.postMessage({
      channel: userId,
      text: `Status updated to ${newStatus} for request ${requestId}. Additional information saved.`
    });
  } catch (error) {
    console.error('Error processing required fields:', error);
    
    // Notify the user of the error
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `Error updating status: ${error.message}`
      });
    } catch (notifyError) {
      console.error('Error notifying user of failure:', notifyError);
    }
  }
});

// Generate dashboard
app.command('/request-dashboard', async ({ body, ack, client }) => {
  await ack();

  try {
    // Generate dashboard metrics
    const metrics = await RequestDashboard.generateDashboard();

    // Create a formatted message with key metrics
    const dashboardBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Request Management Dashboard* :chart_with_upwards_trend:"
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Total Requests:* ${metrics.totalRequests}`
          },
          {
            type: "mrkdwn",
            text: `*Pending Requests:* ${metrics.pendingRequests}`
          },
          {
            type: "mrkdwn",
            text: `*Completed Requests:* ${metrics.completedRequests}`
          },
          {
            type: "mrkdwn",
            text: `*In Progress:* ${metrics.inProgressRequests}`
          }
        ]
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Requests by Type:*"
        }
      },
      {
        type: "section",
        fields: Object.entries(metrics.requestsByType).map(([type, count]) => ({
          type: "mrkdwn",
          text: `*${type}:* ${count}`
        }))
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Requests by Priority:*"
        }
      },
      {
        type: "section",
        fields: Object.entries(metrics.requestsByPriority).map(([priority, count]) => ({
          type: "mrkdwn",
          text: `*${priority}:* ${count}`
        }))
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Full dashboard available in Google Sheets. Use `/request-dashboard` to refresh."
          }
        ]
      }
    ];

    // Send dashboard message to the channel
    await client.chat.postMessage({
      channel: body.channel_id,
      blocks: dashboardBlocks
    });

  } catch (error) {
    console.error('Detailed dashboard generation error:', error);
    
    await client.chat.postMessage({
      channel: body.channel_id,
      text: `Error generating dashboard: ${error.message}\n\nPlease check the console logs for more details.`
    });
  }
});

// Search command to find requests
app.command('/request-search', async ({ body, ack, client }) => {
  await ack();

  try {
    const searchQuery = body.text.trim();
    
    if (!searchQuery) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "Please provide a search term. Usage: `/request-search [term]`"
      });
      return;
    }
    
    const results = await UnifiedEventLogger.searchRequests(searchQuery);
    
    if (results.length === 0) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: `No results found for "${searchQuery}"`
      });
      return;
    }

    // Format results for Slack message
    const resultBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Search Results for "${searchQuery}"* (${results.length} found)`
        }
      }
    ];
    
    // Add results (limit to 10 to avoid message size limitations)
    const limitedResults = results.slice(0, 10);
    
    limitedResults.forEach(request => {
      resultBlocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Request ID:* ${request.RequestID}\n*Type:* ${request.Type}\n*Status:* ${request.Status}\n*Customer:* ${request.CustomerName || 'N/A'}\n*Created:* ${new Date(request.CreatedAt).toLocaleString()}`
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Details"
          },
          value: request.RequestID,
          action_id: "view_request_details"
        }
      });
    });
    
    // Add note if results were truncated
    if (results.length > 10) {
      resultBlocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `_Showing 10 of ${results.length} results. Refine your search for more specific results._`
          }
        ]
      });
    }

    await client.chat.postMessage({
      channel: body.channel_id,
      blocks: resultBlocks
    });
  } catch (error) {
    console.error('Error searching requests:', error);
    
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: `Error searching requests: ${error.message}`
    });
  }
});

// Handle request details view
app.action('view_request_details', async ({ body, ack, client }) => {
  await ack();
  
  try {
    const requestId = body.actions[0].value;
    
    // Get request details and history
    const request = await UnifiedEventLogger.getRequestById(requestId);
    const history = await UnifiedEventLogger.getRequestHistory(requestId);
    
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }
    
    // Format request details
    const detailsBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Request Details:* ${requestId}`
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Type:* ${request.Type}`
          },
          {
            type: "mrkdwn",
            text: `*Status:* ${request.Status}`
          },
          {
            type: "mrkdwn",
            text: `*Customer:* ${request.CustomerName || 'N/A'}`
          },
          {
            type: "mrkdwn",
            text: `*Contact:* ${request.CustomerContact || 'N/A'}`
          },
          {
            type: "mrkdwn",
            text: `*Priority:* ${request.Priority}`
          },
          {
            type: "mrkdwn",
            text: `*Created:* ${new Date(request.CreatedAt).toLocaleString()}`
          }
        ]
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Details:*\n${request.Details}`
        }
      }
    ];
    
    // Add history section if available
    if (history && history.length > 0) {
      detailsBlocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Event History:*"
        }
      });
      
      // Show last 5 events to avoid message size limitations
      const recentHistory = history.slice(-5);
      
      recentHistory.forEach(event => {
        const timestamp = new Date(event.Timestamp).toLocaleString();
        let eventText = `• ${timestamp}: ${event.Action}`;
        
        if (event.UserId) {
          eventText += ` by <@${event.UserId}>`;
        }
        
        detailsBlocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: eventText
          }
        });
      });
      
      // Add note if history was truncated
      if (history.length > 5) {
        detailsBlocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `_Showing ${recentHistory.length} of ${history.length} events. See Google Sheets for full history._`
            }
          ]
        });
      }
    }
    
    // Add action buttons if request is not in a terminal state
    const requestType = request.Type.toLowerCase();
    const typeConfig = UnifiedEventLogger.REQUEST_TYPES[requestType];
    
    if (typeConfig && 
        typeConfig.statusTransitions && 
        typeConfig.statusTransitions[request.Status] && 
        typeConfig.statusTransitions[request.Status].length > 0) {
      
      detailsBlocks.push({
        type: "actions",
        elements: getActionButtons(requestId, requestType, request.Status)
      });
    }
    
    // Show request details in a modal
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: "modal",
          title: {
            type: "plain_text",
            text: `Request ${requestId}`
          },
          blocks: detailsBlocks
        }
      });
    } catch (modalError) {
      // Fallback to message if modal fails
      console.error('Error opening modal, falling back to message:', modalError);
      
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: body.user.id,
        blocks: detailsBlocks
      });
    }
  } catch (error) {
    console.error('Error viewing request details:', error);
    
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      text: `Error viewing request details: ${error.message}`
    });
  }
});

// Add command to view request history
app.command('/request-history', async ({ body, ack, client }) => {
  await ack();
  
  try {
    const requestId = body.text.trim();
    
    if (!requestId) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "Please provide a request ID. Usage: `/request-history [REQUEST-ID]`"
      });
      return;
    }
    
    const history = await UnifiedEventLogger.getRequestHistory(requestId);
    
    if (!history || history.length === 0) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: `No history found for request ${requestId}`
      });
      return;
    }
    
    // Format history for Slack message
    const historyBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*History for Request ${requestId}* (${history.length} events)`
        }
      }
    ];
    
    history.forEach(event => {
      const timestamp = new Date(event.Timestamp).toLocaleString();
      let eventText = `*${timestamp}*: ${event.Action}`;
      
      if (event.UserId) {
        eventText += ` by <@${event.UserId}>`;
      }
      
      if (event.PreviousStatus && event.NewStatus) {
        eventText += `\nStatus changed from *${event.PreviousStatus}* to *${event.NewStatus}*`;
      }
      
      if (event.AdditionalMetadata) {
        try {
          const metadata = JSON.parse(event.AdditionalMetadata);
          if (Object.keys(metadata).length > 0) {
            eventText += "\nAdditional data:";
            Object.entries(metadata).forEach(([key, value]) => {
              if (key !== 'previousStatus' && key !== 'newStatus') {
                eventText += `\n• ${formatFieldLabel(key)}: ${value}`;
              }
            });
          }
        } catch (e) {
          // Ignore JSON parse errors
        }
      }
      
      historyBlocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: eventText
        }
      });
    });

    await client.chat.postMessage({
      channel: body.channel_id,
      blocks: historyBlocks
    });
  } catch (error) {
    console.error('Error retrieving request history:', error);
    
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: `Error retrieving history: ${error.message}`
    });
  }
});

// Error handling middleware
app.error(async (error) => {
  console.error('Global error handler caught:', error);
});

// Start the app
(async () => {
  try {
    // Initialize database connection
    await initDatabase();
    
    // Start the Slack app with Socket Mode
    await app.start();
    console.log('⚡️ Request Management app connected via Socket Mode!');
  } catch (error) {
    console.error('Failed to start app:', error);
  }
})();

module.exports = {
  app,
  createSpecialRequestModal
};