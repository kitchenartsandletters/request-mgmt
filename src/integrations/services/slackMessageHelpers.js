function updateMessageBlocksForStatus(status) {
    return [
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*Status:* ${status}`
          }
        ]
      }
    ];
  }
  
  function extractRequestTypeFromMessage(message) {
    const typeBlock = message.blocks.find(block => 
      block.text && block.text.text.includes("Type:")
    );
  
    if (typeBlock) {
      const typeMatch = typeBlock.text.text.match(/Type:\s*(\w+)/);
      return typeMatch ? typeMatch[1].toLowerCase() : null;
    }
  
    return null;
  }
  
  module.exports = {
    updateMessageBlocksForStatus,
    extractRequestTypeFromMessage
  };