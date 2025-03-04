require('dotenv').config();
const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const RequestTracker = require('./integrations/googleSheetsTracker');
const RequestDashboard = require('./integrations/requestDashboard');
const BookHoldPrinter = require('./integrations/bookHoldPrinter');
const RequestManager = require('./integrations/requestManager');
const EventLogger = require('./integrations/services/requestEventLogger');
const RequestLogger = require('./integrations/services/requestLogger');

// Initialize Slack App with Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Create Special Request Modal
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
                text: "Book Hold"
              },
              value: "book_hold"
            },
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
                text: "Personalization Request"
              },
              value: "personalization"
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
                text: "Out of Print Search"
              },
              value: "out_of_print"
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

// Slash command handler to open modal
app.command('/request', async ({ body, ack, client }) => {
  // Acknowledge the command request
  await ack();

  try {
    // Open the modal
    const result = await client.views.open({
      trigger_id: body.trigger_id,
      view: createSpecialRequestModal()
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
});

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

// Handle modal submission
app.view('request_submission', async ({ body, view, ack, client }) => {
  await ack();

  try {
    const values = view.state.values;
    const requestId = `REQ-${Date.now()}`;
    const requestData = {
      requestId,
      type: values.request_type.request_type_select.selected_option.value,
      customerName: values.customer_name.customer_name_input.value,
      customerContact: values.customer_contact.customer_contact_input.value,
      details: values.request_details.request_details_input.value,
      priority: values.priority.priority_select.selected_option.value
    };

    // Log request instead of printing
    RequestLogger.logRequest({
      ...requestData,
      requestType: requestData.type
    });

    // Save to Google Sheets
    await RequestTracker.addRequest(requestData);

    // Post to requests channel (using the already declared requestId)
    await client.chat.postMessage({
      channel: process.env.REQUESTS_CHANNEL,
      text: `New Request: ${requestId}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*New Request* \n*Request ID:* ${requestId}`
          }
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Type:* ${requestData.type}`
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
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Details:*\n${requestData.details}`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Mark In Progress"
              },
              value: requestId,
              action_id: "mark_in_progress"
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Close Request"
              },
              value: requestId,
              action_id: "close_request"
            }
          ]
        }
      ]
    });

  } catch (error) {
    console.error('Error in request submission:', error);
    // Optionally send an error message to the user
  }
});

// Update action handlers to modify Google Sheets
const { 
  updateMessageBlocksForStatus, 
  extractRequestTypeFromMessage 
} = require('./integrations/services/slackMessageHelpers');

// Then update all references from RequestEventLogger to EventLogger
app.action('mark_in_progress', async ({ body, ack, client }) => {
  await ack();
  
  try {
    const requestId = body.actions[0].value;
    const requestType = extractRequestTypeFromMessage(body.message);
    const userId = body.user.id;

    await EventLogger.updateRequestStatus({
      requestType,
      requestId,
      currentStatus: 'NEW',
      newStatus: 'PENDING',
      userId,
      additionalFields: {
        slackMessageTs: body.message.ts
      }
    });

    // Rest of the code remains the same
  } catch (error) {
    console.error('Error marking request in progress:', error);
  }
});

app.action('close_request', async ({ body, ack, client }) => {
  await ack();
  
  try {
    const requestId = body.actions[0].value;
    
    // Update status in Google Sheets
    await RequestTracker.updateRequestStatus(requestId, 'Closed');

    // Update Slack message
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [
        ...body.message.blocks.slice(0, -1),
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `*Status:* Closed`
            }
          ]
        }
      ]
    });
  } catch (error) {
    console.error('Error closing request:', error);
  }
});

// Error handler
app.error(async (error) => {
  console.error('Unhandled error:', error);
});

// Add new slash commands for advanced tracking
app.command('/request-search', async ({ body, ack, client }) => {
  await ack();

  try {
    const searchQuery = body.text;
    const results = await RequestTracker.searchRequests(searchQuery);

    // Format results for Slack message
    const resultBlocks = results.map(request => ({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Request ID:* ${request.RequestID}\n*Type:* ${request.Type}\n*Status:* ${request.Status}\n*Customer:* ${request.CustomerName}`
      }
    }));

    await client.chat.postMessage({
      channel: body.channel_id,
      text: `Search Results for "${searchQuery}"`,
      blocks: resultBlocks
    });
  } catch (error) {
    console.error('Error searching requests:', error);
  }
});

// Error handler
app.error(async (error) => {
  console.error('Unhandled error:', error);
});

// Start the app
(async () => {
  try {
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Bolt app is running!');
  } catch (error) {
    console.error('Failed to start app:', error);
  }
})();

module.exports = {
  app,
  createSpecialRequestModal
};