// Make sure phone number is in the correct format (eg. (703) 239-4244 => 17032394244)

exports.sanitize_phoneNumber = (phoneNumber) => {
  if (typeof phoneNumber !== "string") return "";

  // Remove all non-numeric characters (including parentheses, spaces, hyphens, etc.)
  let cleaned = phoneNumber.trim().replace(/\D/g, "");

  // Check if the number starts with a '+' and remove it
  if (phoneNumber.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }

  // If it's a 10-digit number, add the country code '1'
  if (cleaned.length === 10) {
    cleaned = "1" + cleaned;
  }

  // If it's an 11-digit number and starts with '1', it's valid
  if (cleaned.length !== 11 || !cleaned.startsWith("1")) {
    return ""; // Invalid number
  }

  return cleaned;
};
