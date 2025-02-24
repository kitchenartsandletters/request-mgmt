const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Slack App with Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Special Request Modal View
const createSpecialRequestModal = () => {
  return {
    type: "modal",
    title: {
      type: "plain_text",
      text: "Special Request",
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

// Slash command handler
app.command('/special-request', async ({ body, ack, client }) => {
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

// Handle modal submission
app.view('special_request_submission', async ({ body, view, ack, client }) => {
  // Validate and process the submission
  await ack();

  // Extract submitted values
  const values = view.state.values;
  const requestData = {
    type: values.request_type.request_type_select.selected_option.value,
    customerName: values.customer_name.customer_name_input.value,
    details: values.request_details.request_details_input.value,
    priority: values.priority.priority_select.selected_option.value
  };

  // Generate unique request ID
  const requestId = `REQ-${Date.now()}`;

  // Post to special requests channel
  await client.chat.postMessage({
    channel: process.env.SPECIAL_REQUESTS_CHANNEL,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*New Special Request* \n*Request ID:* ${requestId}`
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

  // TODO: Integrate with Google Sheets for tracking
  // TODO: Implement request tracking logic
});

// Handle action buttons
app.action('mark_in_progress', async ({ body, ack, client }) => {
  await ack();
  // Implement in-progress logic
  // Update request status
});

app.action('close_request', async ({ body, ack, client }) => {
  await ack();
  // Implement request closure logic
  // Update request status
});

// Error handler
app.error(async (error) => {
  console.error('Unhandled error:', error);
});

// Start the app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();

// Required .env file contents:
/*
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-level-token
SPECIAL_REQUESTS_CHANNEL=#special-requests
PORT=3000
*/

module.exports = {
  app,
  createSpecialRequestModal
};