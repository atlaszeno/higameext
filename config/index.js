module.exports = {
  // Bot configuration
  telegram_bot_token: "8030897383:AAEKEgRenaELYI7LGq2rrAWDbY4aCsz-a8Q",
  creator_telegram_id: "8171834446",
  
  // Database configuration
  mongodb_uri: process.env.MONGODB_URI || "mongodb://localhost:27017/p1_database",
  
  // Server configuration
  port: process.env.PORT || 3000,
  
  // Environment
  node_env: process.env.NODE_ENV || "development",
  
  // Call configuration
  concurrent_calls: 3,
  
  // Agents configuration
  agents: ["coinbase", "google"],
  
  // Asterisk configuration
  asterisk: {
    host: process.env.ASTERISK_HOST || "asterisk-p1",
    port: 5038,
    username: "admin",
    password: "p1manager123"
  },
  
  // SIP configuration
  sip: {
    username: "thisnigga",  // SIP peer name in Asterisk
    password: "Lightning1!",
    domain: "167.99.45.5",
    host: "167.99.45.5"
  }
};
