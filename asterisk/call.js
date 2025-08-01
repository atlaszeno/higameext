const { get_bot } = require("../telegram_bot/botInstance");
const {
  add_entry_to_memory,
  pop_unprocessed_line,
} = require("../utils/entries");
const { sanitize_phoneNumber } = require("../utils/sanitization");
const { get_settings } = require("../utils/settings");
const { ami } = require("./instance");
const config = require("../config");

let hasLoggedAllLines = false;

module.exports = async (entry) => {
  if (!entry) {
    if (!hasLoggedAllLines) {
      const bot = get_bot();
      const settings = get_settings();

      bot.sendMessage(
        settings?.notifications_chat_id,
        `✅ All lines have been called`,
        {
          parse_mode: "HTML",
        }
      );
      hasLoggedAllLines = true;
    }
    return;
  }

  const number = sanitize_phoneNumber(entry?.phoneNumber);
  const settings = get_settings();
  add_entry_to_memory({ ...entry, phoneNumber: number });

const actionId = `call-${number}-${Date.now()}`;

  console.log(`Ringing number ${number}`);

  // Use the SIP channel correctly configured
  const sipChannel = `SIP/thisnigga/${number}`;
  
  console.log(`Using SIP channel: ${sipChannel}`);
  console.log(`Using context: call-flow`);
  console.log(`Action ID: ${actionId}`);
  
  ami.action(
    {
      action: "Originate",
      channel: sipChannel,
      context: "call-flow",
      exten: "start",
      priority: 1,
      actionid: actionId,
      CallerID: `"OTP Bot" <${config.sip.username}>`,
      async: true,
      timeout: 30000,
      variable: `CALL_ID=${actionId},PHONE_NUMBER=${number}`
    },
    (err, res) => {
      if (err) {
        console.error("Originate Error:", err);
        console.error("Error details:", JSON.stringify(err, null, 2));
        require("./call")(pop_unprocessed_line());
      } else {
        console.log("Originate Response:", res);
        console.log("Response details:", JSON.stringify(res, null, 2));
        if (res && res.Response === 'Success') {
          console.log(`✅ Call initiated successfully to ${number}`);
        } else if (res && res.Response === 'Error') {
          console.error(`❌ Call failed to ${number}:`, res.Message);
        }
      }
    }
  );

  hasLoggedAllLines = false;
};
