const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const callSchema = new Schema({
  phoneNumber: { type: String },
  rawLine: { type: String },
  used: { type: Boolean, default: false },
});

module.exports = mongoose.model("Call", callSchema);
