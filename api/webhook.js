const { getHistory, addMessage } = require("../lib/conversation");
const { transcribeVoice } = require("../lib/voice");
const { kv } = require("../lib/kv");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var body = req.body;
    if (body.test === true) return res.status(200).json({ ok: true });

    var messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0)
      return res.status(200).json({ ok: true, skipped: "no_messages" });

    var botEnabled = true;
    try { if ((await kv.get("bot_enabled")) === false) botEnabled = false; } catch {}

    for (var i = 0; i < messages.length; i++) {
      await processMessage(messages[i], botEnabled, req.headers.host);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};

async function saveLog(contactId, chatId, channelId, opts) {
  try {
    var history = await getHistory(contactId);
    var logKey = "log:" + contactId;
    var existing = (await kv.get(logKey)) || {};
    var log = {
      contactId: contactId,
      phone: chatId,
      channelId: channelId,
      messages: history,
      escalated: (opts && opts.escalated) || false,
      needsReply: (opts && opts.needsReply) || false,
      isPaid: (opts && opts.isPaid) || existing.isPaid || false,
      thinkingClient: existing.thinkingClient || false,
      followup2dSent: existing.followup2dSent || false,
      followup3dSent: (opts && (opts.escalated || opts.needsReply)) ? existing.followup3dSent : false,
      followup7dSent: (opts && (opts.escalated || opts.needsReply)) ? existing.followup7dSent : false,
      updatedAt: new Date().toISOString(),
    };
    await kv.set(logKey, log, { ex: 30 * 86400 });
    await kv.zadd("log:index", { score: Date.now(), member: logKey });
  } catch (err) {
    console.error("Log save error:", err.message);
  }
}

async function processMessage(msg, botEnabled, host) {
  var messageId = msg.messageId || "";
  var channelId = msg.channelId || "";
  var chatId = msg.chatId || "";
  var chatType = msg.chatType || "";
  var messageType = msg.type || "text";
  var isEcho = msg.isEcho || false;
  var text = (msg.text || "").trim();
  var contentUrl = msg.content || "";
  var authorType = msg.authorType || "";
  var contactId = chatId;

  if (chatType && chatType !== "whatsapp") return;
  if (!contactId) return;

  // --- Outgoing messages (echo) ---
  if (isEcho || authorType === "manager" || authorType === "bot") {
    if (text) {
      var isBotMessage = authorType === "bot";
      if (!isBotMessage && messageId) {
        try {
          var sentKey = "sent:" + messageId;
          var wasSent = await kv.get(sentKey);
          if (wasSent) isBotMessage = true;
        } catch {}
      }
      if (!isBotMessage) {
        await addMessage(contactId, "manager", text);
        try {
          var logKey = "log:" + contactId;
          var log = await kv.get(logKey);
          if (log) {
            log.needsReply = false;
            log.escalated = false;
            log.messages = await getHistory(contactId);
            log.updatedAt = new Date().toISOString();
            await kv.set(logKey, log, { ex: 30 * 86400 });
          }
        } catch {}
      }
    }
    return;
  }

  if (!text && messageType === "text") return;

  // --- Dedup ---
  if (messageId) {
    try {
      var dedupKey = "dedup:" + messageId;
      var exists = await kv.get(dedupKey);
      if (exists) return;
      await kv.set(dedupKey, 1, { ex: 3600 });
    } catch {}
  }

  // --- Paid clients ---
  try {
    var clientStatus = await kv.get("client:" + contactId);
    if (clientStatus === "paid") {
      if (text) await addMessage(contactId, "user", text);
      else await addMessage(contactId, "user", "[Медиа: " + messageType + "]");
      await saveLog(contactId, chatId, channelId, { needsReply: true, isPaid: true });
      return;
    }
  } catch {}

  // --- Voice ---
  var messageText = text;
  if ((messageType === "voice" || messageType === "audio") && contentUrl) {
    if (!botEnabled) {
      messageText = "[Голосовое сообщение]";
    } else {
      var transcribed = await transcribeVoice(contentUrl);
      if (!transcribed) return;
      messageText = "[Голосовое] " + transcribed;
    }
  }

  // --- Media ---
  if (!messageText && messageType !== "text") {
    await addMessage(contactId, "user", "[Медиа: " + messageType + "]");
    await saveLog(contactId, chatId, channelId, { needsReply: true });
    return;
  }

  if (!messageText) return;

  // --- Save incoming message to conversation history ---
  await addMessage(contactId, "user", messageText);

  // --- Bot disabled ---
  if (!botEnabled) {
    await saveLog(contactId, chatId, channelId, { needsReply: true });
    return;
  }

  // --- Add to buffer (debounce: wait 30s for more messages) ---
  var now = Date.now();
  try {
    var bufferKey = "buffer:" + contactId;
    var existing = (await kv.get(bufferKey)) || [];
    existing.push({ text: messageText, ts: now });
    await kv.set(bufferKey, existing, { ex: 120 });
    await kv.set("buffer_ts:" + contactId, now, { ex: 120 });
  } catch (err) {
    console.error("Buffer save error:", err.message);
  }

  // --- Trigger delayed processing (fire and forget) ---
  try {
    var protocol = "https";
    var processUrl = protocol + "://" + host + "/api/process-buffer";
    fetch(processUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: contactId, chatId: chatId, channelId: channelId, ts: now }),
    }).catch(function() {});
  } catch {}
}
