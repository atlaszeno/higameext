const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const allowedSchema = new Schema({
  telegram_id: { type: String },
});

module.exports = mongoose.model("Allowed", allowedSchema);
