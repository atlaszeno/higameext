const readline = require('readline');
const EventEmitter = require('events');

class DTMFPromptHandler extends EventEmitter {
    constructor() {
        super();
        this.rl = null;
        this.pendingConfirmations = new Map();
        this.isPromptActive = false;
        this.setupReadline();
    }

    setupReadline() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: 'DTMF> '
        });

        this.rl.on('line', (input) => {
            this.handleInput(input.trim());
        });

        console.log('\n=== DTMF Confirmation System Active ===');
        console.log('Instructions:');
        console.log('- After each call ends, confirm if the person pressed "1"');
        console.log('- Type: <phone_number> y (if they pressed 1)');
        console.log('- Type: <phone_number> n (if they did not press 1)');
        console.log('- Example: +1234567890 y');
        console.log('=========================================\n');
    }

    handleInput(input) {
        if (!input) {
            this.showPrompt();
            return;
        }

        const parts = input.split(' ');
        if (parts.length !== 2) {
            console.log('Invalid format. Use: <phone_number> y/n');
            this.showPrompt();
            return;
        }

        const [phoneNumber, response] = parts;
        const confirmation = response.toLowerCase();

        if (!['y', 'n', 'yes', 'no'].includes(confirmation)) {
            console.log('Invalid response. Use y/n or yes/no');
            this.showPrompt();
            return;
        }

        if (this.pendingConfirmations.has(phoneNumber)) {
            const isPressed = ['y', 'yes'].includes(confirmation);
            console.log(`✓ Confirmed for ${phoneNumber}: ${isPressed ? 'PRESSED 1' : 'NO PRESS'}`);
            
            // Remove from pending
            this.pendingConfirmations.delete(phoneNumber);
            
            // Emit confirmation event
            this.emit('dtmf_confirmed', {
                phoneNumber,
                pressed: isPressed,
                timestamp: new Date()
            });

            // Show remaining pending confirmations
            this.showPendingConfirmations();
        } else {
            console.log(`No pending confirmation found for ${phoneNumber}`);
        }

        this.showPrompt();
    }

    addPendingConfirmation(phoneNumber) {
        this.pendingConfirmations.set(phoneNumber, {
            timestamp: new Date(),
            phoneNumber
        });

        console.log(`\n📞 Call ended for: ${phoneNumber}`);
        console.log(`❓ Did the person press "1"? Type: ${phoneNumber} y/n`);
        this.showPendingConfirmations();
        this.showPrompt();
    }

    showPendingConfirmations() {
        if (this.pendingConfirmations.size > 0) {
            console.log(`\n⏳ Pending confirmations (${this.pendingConfirmations.size}):`);
            for (const [phoneNumber, data] of this.pendingConfirmations) {
                const timeAgo = Math.floor((Date.now() - data.timestamp) / 1000);
                console.log(`   - ${phoneNumber} (${timeAgo}s ago)`);
            }
            console.log('');
        }
    }

    showPrompt() {
        if (!this.isPromptActive) {
            this.isPromptActive = true;
            this.rl.prompt();
        }
    }

    getCurrentStatus() {
        return {
            pendingCount: this.pendingConfirmations.size,
            pendingNumbers: Array.from(this.pendingConfirmations.keys())
        };
    }

    clearPendingConfirmation(phoneNumber) {
        if (this.pendingConfirmations.has(phoneNumber)) {
            this.pendingConfirmations.delete(phoneNumber);
            console.log(`✓ Cleared pending confirmation for ${phoneNumber}`);
            return true;
        }
        return false;
    }

    close() {
        if (this.rl) {
            this.rl.close();
        }
    }
}

// Create singleton instance
const dtmfHandler = new DTMFPromptHandler();

module.exports = dtmfHandler;
