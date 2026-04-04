var { checkAuth } = require("./_auth");
var { sendMessage } = require("../../lib/wazzup");
var { kv } = require("../../lib/kv");
var { addMessage, getHistory } = require("../../lib/conversation");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    var { channelId, chatId, text } = req.body;

    if (!channelId || !chatId || !text) {
      return res.status(400).json({ error: "channelId, chatId, and text are required" });
    }

    // Send via Wazzup
    var sentId = await sendMessage(channelId, chatId, text);
    if (!sentId) {
      return res.status(500).json({ error: "Failed to send message" });
    }

    // Mark as bot-sent to avoid saving echo
    if (typeof sentId === "string") {
      try { await kv.set("sent:" + sentId, 1, { ex: 300 }); } catch {}
    }

    // Save to conversation history as "admin" role
    await addMessage(chatId, "admin", text);

    // Sync log from conversation history (single source of truth)
    try {
      var logKey = "log:" + chatId;
      var log = await kv.get(logKey);
      if (log) {
        log.messages = await getHistory(chatId);
        log.needsReply = false;
        log.escalated = false;
        log.updatedAt = new Date().toISOString();
        await kv.set(logKey, log, { ex: 30 * 86400 });
      }
    } catch (err) {
      console.error("Log update error:", err.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Send message error:", err);
    return res.status(500).json({ error: err.message });
  }
};
