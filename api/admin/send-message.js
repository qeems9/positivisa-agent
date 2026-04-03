const { checkAuth } = require("./_auth");
const { sendMessage } = require("../../lib/wazzup");
const { kv } = require("../../lib/kv");
const { addMessage } = require("../../lib/conversation");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { channelId, chatId, text } = req.body;

    if (!channelId || !chatId || !text) {
      return res.status(400).json({ error: "channelId, chatId, and text are required" });
    }

    // Send via Wazzup
    const sent = await sendMessage(channelId, chatId, text);
    if (!sent) {
      return res.status(500).json({ error: "Failed to send message" });
    }

    // Update conversation history (so bot has context)
    await addMessage(chatId, "assistant", text);

    // Update log entry
    try {
      const logKey = `log:${chatId}`;
      const log = await kv.get(logKey);
      if (log) {
        log.messages = log.messages || [];
        log.messages.push({ role: "admin", content: text });
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
