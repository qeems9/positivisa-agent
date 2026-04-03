const { sendGroupMessage } = require("./wazzup");
const { kv } = require("./kv");

var GROUP_CHAT_ID = "120363420486252442";

/**
 * Escalate conversation to manager via WhatsApp group notification
 * @param {string} channelId - Wazzup channel UUID
 * @param {string} chatId - client phone number
 * @param {Array} history - conversation messages for context
 * @param {string} reason - optional reason for the notification message
 */
async function escalate(channelId, chatId, history, reason) {
  // 1. Mark as escalated in KV
  try {
    var logKey = "log:" + chatId;
    var existing = await kv.get(logKey);
    if (existing) {
      existing.escalated = true;
      existing.escalatedAt = new Date().toISOString();
      await kv.set(logKey, existing, { ex: 30 * 86400 });
    }
  } catch (err) {
    console.error("Escalation log error:", err.message);
  }

  // 2. Notify group with reason
  var phone = chatId.replace(/\D/g, "");
  var message = reason
    ? "Клиент +" + phone + " — " + reason
    : "Клиент +" + phone + " ждёт ответа специалиста";

  await sendGroupMessage(channelId, GROUP_CHAT_ID, message);
}

module.exports = { escalate };
