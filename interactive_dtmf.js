const axios = require('axios');
const readline = require('readline');

const baseURL = 'http://localhost:3000/api';
let currentCallId = null;
let monitoringInterval = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🤖 Interactive DTMF Controller Started');
console.log('========================================');
console.log('Instructions:');
console.log('1. Start your Telegram bot and make a call to 18188752229');
console.log('2. Type "press1" when you want me to simulate pressing 1');
console.log('3. After you choose an option in Telegram, type "enter696969" to simulate the code');
console.log('4. Type "status" to check call status');
console.log('5. Type "exit" to quit');
console.log('========================================\n');

// Function to get active calls and find the most recent one
async function findActiveCall() {
  try {
    const response = await axios.get(`${baseURL}/active-calls`);
    const activeCalls = response.data.activeCalls;
    
    if (activeCalls.length > 0) {
      // Get the most recent call
      const mostRecentCall = activeCalls[activeCalls.length - 1];
      const [callId, callData] = mostRecentCall;
      
      if (callData.phoneNumber === '18188752229' && currentCallId !== callId) {
        currentCallId = callId;
        console.log(`📞 Found your call! Call ID: ${callId}`);
        console.log(`📱 Phone: ${callData.phoneNumber}`);
        console.log(`📍 Status: ${callData.statusMessage}`);
        console.log('🎯 Ready for commands! Type "press1" when ready.\n');
        return true;
      }
    }
    return false;
  } catch (error) {
    // Silently handle errors during monitoring
    return false;
  }
}

// Start monitoring for calls
function startMonitoring() {
  console.log('🔍 Monitoring for your call to 18188752229...\n');
  
  monitoringInterval = setInterval(async () => {
    if (!currentCallId) {
      await findActiveCall();
    }
  }, 2000); // Check every 2 seconds
}

// Handle user commands
function handleCommand(command) {
  const cmd = command.toLowerCase().trim();
  
  switch (cmd) {
    case 'press1':
      if (!currentCallId) {
        console.log('❌ No active call found. Please make a call first.');
        break;
      }
      simulatePress1();
      break;
      
    case 'enter696969':
      if (!currentCallId) {
        console.log('❌ No active call found. Please make a call first.');
        break;
      }
      simulateEnterCode();
      break;
      
    case 'status':
      if (!currentCallId) {
        console.log('❌ No active call found.');
        break;
      }
      showCallStatus();
      break;
      
    case 'exit':
      console.log('👋 Goodbye!');
      if (monitoringInterval) {
        clearInterval(monitoringInterval);
      }
      rl.close();
      process.exit(0);
      break;
      
    default:
      console.log('❓ Unknown command. Available commands: press1, enter696969, status, exit');
  }
}

// Simulate pressing 1
async function simulatePress1() {
  try {
    console.log('🎯 Simulating caller pressing "1"...');
    const response = await axios.post(`${baseURL}/handle-dtmf`, {
      callId: currentCallId,
      digit: '1'
    });
    
    console.log('✅ DTMF "1" sent successfully!');
    console.log('📱 Check your Telegram bot - you should see the menu options now.');
    console.log('🔄 After you choose an option, type "enter696969" to simulate the code entry.\n');
    
  } catch (error) {
    console.error('❌ Error sending DTMF:', error.response?.data || error.message);
  }
}

// Simulate entering the code 696969
async function simulateEnterCode() {
  try {
    console.log('🔢 Simulating entering code "696969"...');
    const digits = ['6', '9', '6', '9', '6', '9'];
    
    for (let i = 0; i < digits.length; i++) {
      console.log(`   📱 Entering digit: ${digits[i]}`);
      await axios.post(`${baseURL}/handle-dtmf`, {
        callId: currentCallId,
        digit: digits[i]
      });
      await new Promise(resolve => setTimeout(resolve, 300)); // Small delay between digits
    }
    
    console.log('✅ Complete code "696969" has been entered!');
    console.log('📱 Check your Telegram bot - you should see the code display now.\n');
    
  } catch (error) {
    console.error('❌ Error entering code:', error.response?.data || error.message);
  }
}

// Show call status
async function showCallStatus() {
  try {
    const response = await axios.get(`${baseURL}/call-status/${currentCallId}`);
    const status = response.data.status;
    
    console.log('📊 Current Call Status:');
    console.log(`   📞 Phone: ${status.phoneNumber}`);
    console.log(`   🆔 Call ID: ${currentCallId}`);
    console.log(`   📍 Status: ${status.statusMessage}`);
    console.log(`   ⏰ Last Update: ${status.lastUpdate}\n`);
    
  } catch (error) {
    console.error('❌ Error getting status:', error.response?.data || error.message);
  }
}

// Start the interactive session
startMonitoring();

rl.on('line', (input) => {
  handleCommand(input);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n👋 Goodbye!');
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  rl.close();
  process.exit(0);
});
