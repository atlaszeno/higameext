const AMI = require("asterisk-manager");
const config = require("./config");

console.log('🔍 DTMF Detection Test Script');
console.log('==============================');

// Test AMI connection
const ami = new AMI(config.asterisk.port, config.asterisk.host, config.asterisk.username, config.asterisk.password, false);

ami.on("connect", () => {
  console.log("✅ AMI Connected Successfully!");
  console.log(`   Host: ${config.asterisk.host}`);
  console.log(`   Port: ${config.asterisk.port}`);
  console.log(`   Username: ${config.asterisk.username}`);
  
  // Test getting SIP peers
  ami.action({
    action: "SIPpeers"
  }, (err, res) => {
    if (err) {
      console.error("❌ SIPpeers Error:", err);
    } else {
      console.log("📞 SIP Peers Response:", res);
    }
  });
  
  // Test getting channels
  ami.action({
    action: "CoreShowChannels"
  }, (err, res) => {
    if (err) {
      console.error("❌ CoreShowChannels Error:", err);
    } else {
      console.log("📡 Active Channels:", res);
    }
  });
});

ami.on("error", (err) => {
  console.error("❌ AMI Connection Error:", err);
  console.log("\n🔧 Troubleshooting Steps:");
  console.log("1. Check if Asterisk Docker container is running");
  console.log("2. Verify AMI is enabled in manager.conf");
  console.log("3. Check if port 5038 is accessible");
  console.log("4. Verify credentials in manager.conf");
});

ami.on("disconnect", () => {
  console.log("⚠️  AMI Disconnected");
});

// Listen for ALL events
ami.on("managerevent", (data) => {
  console.log(`\n🔔 ASTERISK EVENT: ${data?.event}`);
  console.log(`📄 Full Data:`, JSON.stringify(data, null, 2));
  
  // Specifically highlight DTMF events
  if (data?.event === "DTMFBegin" || data?.event === "DTMFEnd" || data?.event === "DTMF") {
    console.log(`\n🎯 === DTMF EVENT DETECTED ===`);
    console.log(`🔢 Digit: ${data?.digit}`);
    console.log(`📺 Channel: ${data?.channel}`);
    console.log(`🔄 Event Type: ${data?.event}`);
    console.log(`🎭 Direction: ${data?.direction || 'N/A'}`);
    console.log(`⚙️  SubClass: ${data?.subclass || 'N/A'}`);
    console.log(`================================\n`);
  }
  
  // Show originate responses
  if (data?.event === "OriginateResponse") {
    console.log(`\n📞 === ORIGINATE RESPONSE ===`);
    console.log(`✅ Response: ${data?.response}`);
    console.log(`📺 Channel: ${data?.channel}`);
    console.log(`🆔 Action ID: ${data?.actionid}`);
    console.log(`🔑 Unique ID: ${data?.uniqueid}`);
    console.log(`===============================\n`);
  }
  
  // Show new channels
  if (data?.event === "Newchannel") {
    console.log(`\n📡 === NEW CHANNEL ===`);
    console.log(`📺 Channel: ${data?.channel}`);
    console.log(`🔑 Unique ID: ${data?.uniqueid}`);
    console.log(`📋 Context: ${data?.context}`);
    console.log(`📞 Extension: ${data?.exten}`);
    console.log(`====================\n`);
  }
});

console.log(`\n🔌 Attempting to connect to Asterisk AMI...`);
console.log(`   Host: ${config.asterisk.host}:${config.asterisk.port}`);
console.log(`   Credentials: ${config.asterisk.username}/${config.asterisk.password}`);
console.log(`\n⏳ Waiting for events... (Press Ctrl+C to exit)`);

// Keep the script running
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  ami.disconnect();
  process.exit(0);
});
