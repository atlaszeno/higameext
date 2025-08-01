const readline = require('readline');
const axios = require('axios');

class TerminalInterface {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.activeCallId = null;
  }

  // Helper method to ask yes/no questions
  askYesNo(question) {
    return new Promise((resolve) => {
      const ask = () => {
        this.rl.question(`${question} (y/n): `, (answer) => {
          const normalized = answer.toLowerCase().trim();
          if (normalized === 'y' || normalized === 'yes') {
            resolve(true);
          } else if (normalized === 'n' || normalized === 'no') {
            resolve(false);
          } else {
            console.log('Please answer with y/n or yes/no');
            ask();
          }
        });
      };
      ask();
    });
  }

  // Helper method to get 6-digit code input
  askForCode() {
    return new Promise((resolve) => {
      const ask = () => {
        this.rl.question('Enter 6-digit DTMF code: ', (answer) => {
          const code = answer.trim();
          if (/^\d{6}$/.test(code)) {
            resolve(code);
          } else {
            console.log('Please enter exactly 6 digits');
            ask();
          }
        });
      };
      ask();
    });
  }

  // Send manual DTMF digit 1
  async sendDTMFDigit1(callId) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/send-manual-dtmf`, {
        callId: callId,
        digit: '1'
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.data.success) {
        console.log('✅ DTMF digit "1" sent successfully');
        return true;
      } else {
        console.log('❌ Failed to send DTMF digit "1"');
        return false;
      }
    } catch (error) {
      console.log('❌ Error sending DTMF digit "1":', error.message);
      return false;
    }
  }

  // Send 6-digit DTMF code
  async sendDTMFCode(callId, code) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/send-dtmf-code`, {
        callId: callId,
        code: code
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.data.success) {
        console.log(`✅ DTMF code "${code}" sent successfully`);
        return true;
      } else {
        console.log(`❌ Failed to send DTMF code "${code}"`);
        return false;
      }
    } catch (error) {
      console.log(`❌ Error sending DTMF code "${code}":`, error.message);
      return false;
    }
  }

  // Main interactive prompt for DTMF digit 1
  async promptForDTMFDigit1(callId) {
    console.log('\n🔔 Call answered by human - ready to send DTMF');
    console.log(`📞 Call ID: ${callId}`);
    
    const shouldSend = await this.askYesNo('Send DTMF digit "1" to proceed?');
    
    if (shouldSend) {
      const success = await this.sendDTMFDigit1(callId);
      if (success) {
        console.log('✅ Waiting for Telegram user to select an option...\n');
      }
    } else {
      console.log('⏭️  Skipped sending DTMF digit "1"\n');
    }
  }

  // Main interactive prompt for 6-digit code
  async promptForDTMFCode(callId) {
    console.log('\n🔔 Telegram user selected an option - ready to send DTMF code');
    console.log(`📞 Call ID: ${callId}`);
    
    const shouldSend = await this.askYesNo('Send a 6-digit DTMF code?');
    
    if (shouldSend) {
      const code = await this.askForCode();
      const success = await this.sendDTMFCode(callId, code);
      if (success) {
        console.log('✅ Code sent to Telegram user for verification\n');
      }
    } else {
      console.log('⏭️  Skipped sending DTMF code\n');
    }
  }

  // Set the current active call ID
  setActiveCallId(callId) {
    this.activeCallId = callId;
    console.log(`📞 Active call set to: ${callId}`);
  }

  // Close the interface
  close() {
    this.rl.close();
  }

  // Display help information
  showHelp() {
    console.log('\n📋 Terminal Interface Commands:');
    console.log('- When call is answered by human: You\'ll be prompted to send DTMF "1"');
    console.log('- When Telegram user selects option: You\'ll be prompted to send 6-digit code');
    console.log('- Answer with y/n or yes/no for prompts');
    console.log('- Enter exactly 6 digits when prompted for DTMF code\n');
  }
}

module.exports = { TerminalInterface };
