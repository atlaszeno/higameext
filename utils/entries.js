const Call = require("../models/call");
const { get_bot } = require("../telegram_bot/botInstance");
const { get_settings } = require("./settings");

let entries = [];
let unprocessedData = [];

const get_entry_by_number = (phoneNumber) => {
  return entries.find((entry) => entry.phoneNumber === phoneNumber) || null;
};

exports.add_entry_to_database = async (phoneNumber) => {
  const entry = get_entry_by_number(phoneNumber);
  const settings = get_settings();

  const existingCall = await Call.findOne({
    phoneNumber: `+${phoneNumber}`,
  });

  if (existingCall) {
    console.log(`Call entry for +${entry.phoneNumber} already exists.`);
    return;
  }

  if (!entry?.phoneNumber) {
    console.log("Failed to add entry: ", entry);
  }

  const newCall = new Call({
    phoneNumber: `+${entry?.phoneNumber}` || "",
    rawLine: entry.rawLine,
  });

  await newCall.save();

  const bot = get_bot();
  bot.sendMessage(
    settings.notifications_chat_id,
    `✅ ${entry.phoneNumber} pressed 1. Do /line to retrieve their info.`,
    { parse_mode: "HTML" }
  );
};

exports.add_entry_to_memory = (entry) => {
  if (!entries.some((e) => e.phoneNumber === entry.phoneNumber)) {
    entries.push(entry);
  }
};

exports.set_unprocessed_data = (data) => {
  unprocessedData = data;
};

exports.pop_unprocessed_line = () => {
  return unprocessedData.pop();
};
