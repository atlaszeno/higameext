#!/usr/bin/env node

const { ami, waitForConnection } = require("./asterisk/instance");
const config = require("./config");

// Test phone number - replace with a number you want to test
const TEST_NUMBER = "18188752229"; // Testing with (818) 875-2229

async function testCall() {
  console.log("=== SIP CALL TEST ===");
  console.log(`Using SIP configuration:`);
  console.log(`- Host: ${config.sip.host}`);
  console.log(`- Domain: ${config.sip.domain}`);
  console.log(`- Username: ${config.sip.username}`);
  console.log(`- Password: ${config.sip.password}`);
  console.log(`\nTesting call to: ${TEST_NUMBER}`);
  
  try {
    // Wait for AMI connection
    console.log("Waiting for AMI connection...");
    await waitForConnection();
    console.log("AMI connected successfully!");
    
    // Prepare the call
    const actionId = `test-call-${Date.now()}`;
    const sipChannel = `SIP/${config.sip.username}/${TEST_NUMBER}`;
    
    console.log(`\nInitiating call:`);
    console.log(`- Channel: ${sipChannel}`);
    console.log(`- Context: outbound`);
    console.log(`- Extension: ${TEST_NUMBER}`);
    console.log(`- Action ID: ${actionId}`);
    
    // Make the call using AMI
    ami.action(
      {
        action: "Originate",
        channel: sipChannel,
        context: "outbound",
        exten: TEST_NUMBER,
        priority: 1,
        actionid: actionId,
        CallerID: TEST_NUMBER,
        async: true,
        timeout: 30000,
        variable: "DTMF_ENABLE=true,DTMF_DEBUG=true,DTMF_REPORT=true",
      },
      (err, res) => {
        if (err) {
          console.error("\n❌ CALL FAILED:");
          console.error("Error:", err);
          console.error("Error details:", JSON.stringify(err, null, 2));
          
          if (err.message) {
            console.error("Error message:", err.message);
          }
          
          // Common error interpretations
          if (err.message && err.message.includes("Connection refused")) {
            console.error("\n🔍 DIAGNOSIS: Connection refused - Check if Asterisk is running and accessible");
          } else if (err.message && err.message.includes("timeout")) {
            console.error("\n🔍 DIAGNOSIS: Timeout - Network connectivity issues or server not responding");
          } else if (err.message && err.message.includes("authentication")) {
            console.error("\n🔍 DIAGNOSIS: Authentication failed - Check SIP credentials");
          }
          
          process.exit(1);
        } else {
          console.log("\n✅ CALL RESPONSE RECEIVED:");
          console.log("Response:", res);
          console.log("Response details:", JSON.stringify(res, null, 2));
          
          if (res && res.Response === 'Success') {
            console.log("\n🎉 Call initiated successfully!");
            console.log("The call request was accepted by Asterisk.");
            console.log("Monitor the asterisk instance logs for call progress.");
          } else if (res && res.Response === 'Error') {
            console.error(`\n❌ Call failed with error: ${res.Message}`);
            
            // Common Asterisk error interpretations
            if (res.Message && res.Message.includes("No such context")) {
              console.error("🔍 DIAGNOSIS: Context 'outbound' doesn't exist in Asterisk dialplan");
            } else if (res.Message && res.Message.includes("No such extension")) {
              console.error("🔍 DIAGNOSIS: Extension not found in the specified context");
            } else if (res.Message && res.Message.includes("Channel unavailable")) {
              console.error("🔍 DIAGNOSIS: SIP channel unavailable - check SIP registration");
            } else if (res.Message && res.Message.includes("Permission denied")) {
              console.error("🔍 DIAGNOSIS: AMI user doesn't have permission to originate calls");
            }
          } else {
            console.log("⚠️  Unexpected response format");
          }
          
          // Exit after a short delay to allow for any additional events
          setTimeout(() => {
            console.log("\nTest completed. Exiting...");
            process.exit(0);
          }, 2000);
        }
      }
    );
    
  } catch (error) {
    console.error("\n❌ TEST FAILED:");
    console.error("Error:", error);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  }
}

// Handle process events
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Test interrupted by user');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('\n❌ Uncaught Exception:', error);
  process.exit(1);
});

// Run the test
console.log("Starting SIP call test...");
console.log("Press Ctrl+C to cancel\n");

testCall().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
