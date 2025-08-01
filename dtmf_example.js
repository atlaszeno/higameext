const dtmfHandler = require('./dtmf_prompt');

// Example: How to integrate this with your call system

// 1. Listen for DTMF confirmations
dtmfHandler.on('dtmf_confirmed', (data) => {
    console.log(`\n🔔 DTMF Confirmation received:`, data);
    
    if (data.pressed) {
        console.log(`✅ ${data.phoneNumber} pressed 1 - Notifying Telegram bot...`);
        
        // TODO: Add your Telegram bot notification logic here
        // Example:
        // telegramBot.sendMessage(chatId, `${data.phoneNumber} pressed 1 during the call`);
        
    } else {
        console.log(`❌ ${data.phoneNumber} did not press 1`);
    }
});

// 2. When a call ends in your main system, add it for confirmation
// This would be called from your asterisk/call.js or wherever calls end
function onCallEnded(phoneNumber) {
    console.log(`Call to ${phoneNumber} has ended`);
    
    // Add to pending confirmations - this will prompt the user
    dtmfHandler.addPendingConfirmation(phoneNumber);
}

// Example usage:
console.log('DTMF Prompt System Example');
console.log('The prompt handler is now active and waiting for confirmations...');

// Simulate some call endings (for testing)
setTimeout(() => {
    onCallEnded('+1234567890');
}, 2000);

setTimeout(() => {
    onCallEnded('+0987654321');
}, 5000);

// Keep the process running
process.on('SIGINT', () => {
    console.log('\nShutting down DTMF handler...');
    dtmfHandler.close();
    process.exit(0);
});
