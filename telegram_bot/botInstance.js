const TelegramBot = require("node-telegram-bot-api");
const config = require("../config");

let bot;
const messageQueue = [];
let isProcessingQueue = false;

function get_bot() {
  return bot;
}

// Rate limiting function to prevent 429 errors
async function processMessageQueue() {
  if (isProcessingQueue || messageQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (messageQueue.length > 0) {
    const { method, args, resolve, reject } = messageQueue.shift();
    
    try {
      let result;
      if (method === 'sendMessage') {
        result = await bot._originalSendMessage(...args);
      } else if (method === 'answerCallbackQuery') {
        result = await bot._originalAnswerCallbackQuery(...args);
      } else {
        result = await bot[method](...args);
      }
      console.log('Message sent successfully:', method);
      resolve(result);
    } catch (error) {
      if (error.code === 'ETELEGRAM' && error.response && error.response.statusCode === 429) {
        const retryAfter = error.response.body?.parameters?.retry_after || 4;
        console.log(`Rate limited. Retrying after ${retryAfter} seconds...`);
        
        // Put the message back at the front of the queue
        messageQueue.unshift({ method, args, resolve, reject });
        
        // Wait for the specified time
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      } else if (error.code === 'ETELEGRAM' && error.response && error.response.statusCode === 403) {
        console.error('Bot was kicked from chat or forbidden:', error.message);
        reject(error);
      } else {
        console.error('Telegram error:', error.message);
        reject(error);
      }
    }
    
    // Small delay between messages to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  isProcessingQueue = false;
}

// Wrapper function for bot methods with rate limiting
function queueBotMethod(method, ...args) {
  return new Promise((resolve, reject) => {
    messageQueue.push({ method, args, resolve, reject });
    processMessageQueue();
  });
}

function start_bot_instance() {
  console.log('Starting Telegram bot with token:', config.telegram_bot_token.substring(0, 20) + '...');
  
  bot = new TelegramBot(config.telegram_bot_token, { 
    polling: {
      interval: 1000,
      autoStart: true,
      params: {
        timeout: 10
      }
    }
  });
  
  console.log('Bot instance created, starting polling...');

  // Store original methods
  const originalSendMessage = bot.sendMessage.bind(bot);
  const originalAnswerCallbackQuery = bot.answerCallbackQuery.bind(bot);
  
  // Store original methods for queue processing
  bot._originalSendMessage = originalSendMessage;
  bot._originalAnswerCallbackQuery = originalAnswerCallbackQuery;

  // Override sendMessage to use rate limiting
  bot.sendMessage = (chatId, text, options = {}) => {
    console.log('Sending message to', chatId, ':', text.substring(0, 50));
    return queueBotMethod('sendMessage', chatId, text, options);
  };

  // Override answerCallbackQuery to use rate limiting
  bot.answerCallbackQuery = (callbackQueryId, options = {}) => {
    return queueBotMethod('answerCallbackQuery', callbackQueryId, options);
  };

  // Handle polling errors
  bot.on('polling_error', (error) => {
    console.error('Polling error:', error.message);
    if (error.code === 'ETELEGRAM' && error.response && error.response.statusCode === 409) {
      console.log('Conflict error - another instance might be running');
    }
  });
  
  // Test bot connection
  bot.getMe().then(info => {
    console.log('Bot connected successfully:', info.username);
  }).catch(error => {
    console.error('Failed to connect bot:', error.message);
  });

  // Handle webhook errors
  bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error.message);
  });

  // Add error handling for unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.code === 'ETELEGRAM') {
      console.error('Unhandled Telegram error:', reason.message);
      return;
    }
    console.error('Unhandled promise rejection:', reason);
  });

  return bot;
}

module.exports = { get_bot, start_bot_instance };
