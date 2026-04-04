const { getReply } = require("../lib/claude");
const { sendMessage } = require("../lib/wazzup");
const { getHistory, addMessage } = require("../lib/conversation");
const { escalate } = require("../lib/escalation");
const { transcribeVoice } = require("../lib/voice");
const { kv } = require("../lib/kv");

var processedIds = new Set();

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

    for (var i = 0; i < messages.length; i++) await processMessage(messages[i], botEnabled);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};

// Save log with optional needsReply flag
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
      updatedAt: new Date().toISOString(),
    };
    await kv.set(logKey, log, { ex: 30 * 86400 });
    await kv.zadd("log:index", { score: Date.now(), member: logKey });
  } catch (err) {
    console.error("Log save error:", err.message);
  }
}

async function processMessage(msg, botEnabled) {
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

  // Debug: log all messages
  try {
    var debugList = (await kv.get("debug:msgs")) || [];
    debugList.unshift({ chatId: chatId, msgId: messageId, isEcho: isEcho, authorType: authorType, text: (text||'').substring(0,30), ts: new Date().toISOString() });
    await kv.set("debug:msgs", debugList.slice(0, 30), { ex: 3600 });
  } catch {}

  // --- Outgoing messages ---
  if (isEcho || authorType === "manager" || authorType === "bot") {
    if (text) {
      // Check if this message was sent by our bot (dedup with sent messages)
      var isBotMessage = authorType === "bot";
      if (!isBotMessage && messageId) {
        try {
          var sentKey = "sent:" + messageId;
          var wasSent = await kv.get(sentKey);
          if (wasSent) isBotMessage = true;
        } catch {}
      }

      if (!isBotMessage) {
        // Manager wrote from WhatsApp — save and clear flags
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
    if (processedIds.has(messageId)) return;
    try {
      var exists = await kv.get("dedup:" + messageId);
      if (exists) return;
      await kv.set("dedup:" + messageId, 1, { ex: 3600 });
    } catch {}
    processedIds.add(messageId);
  }

  // --- Paid clients → save + mark needsReply (NO group notification) ---
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

  // --- Media (photo/video) → save + mark needsReply (NO group notification) ---
  if (!messageText && messageType !== "text") {
    await addMessage(contactId, "user", "[Медиа: " + messageType + "]");
    await saveLog(contactId, chatId, channelId, { needsReply: true });
    return;
  }

  if (!messageText) return;

  // --- Save incoming ---
  await addMessage(contactId, "user", messageText);

  // --- Bot disabled ---
  if (!botEnabled) {
    await saveLog(contactId, chatId, channelId, { needsReply: true });
    return;
  }

  // --- Check if already escalated (manager handles) ---
  try {
    var logKey = "log:" + contactId;
    var existingLog = await kv.get(logKey);
    if (existingLog && existingLog.escalated) {
      // Bot already handed off to manager — don't respond, mark needsReply
      await saveLog(contactId, chatId, channelId, { escalated: true, needsReply: true });
      return;
    }
  } catch {}

  // --- AI flow ---
  var history = await getHistory(contactId);
  var reply;
  try {
    var timeout = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error("timeout")); }, 10000);
    });
    reply = await Promise.race([getReply(contactId, history, messageText), timeout]);
  } catch (err) {
    // AI timeout → mark needsReply (NO group notification)
    console.error("AI error:", err.message);
    await saveLog(contactId, chatId, channelId, { needsReply: true });
    return;
  }

  await addMessage(contactId, "assistant", reply.text);

  if (reply.shouldEscalate) {
    // Send reply to client, then notify group
    if (reply.text) {
      var sentId = await sendMessage(channelId, chatId, reply.text);
      if (sentId && typeof sentId === "string") try { await kv.set("sent:" + sentId, 1, { ex: 300 }); } catch {}
    }
    var msgLower = messageText.toLowerCase();
    var escReason = "требуется менеджер";
    if (msgLower.includes("оплат") || msgLower.includes("переводить") || msgLower.includes("начнем") || msgLower.includes("начать") || msgLower.includes("счёт") || msgLower.includes("счет") || msgLower.includes("kaspi")) {
      escReason = "хочет оплатить";
    }
    await saveLog(contactId, chatId, channelId, { escalated: true, needsReply: true });
    await escalate(channelId, chatId, await getHistory(contactId), escReason);
  } else {
    var sentId2 = await sendMessage(channelId, chatId, reply.text);
    if (sentId2 && typeof sentId2 === "string") try { await kv.set("sent:" + sentId2, 1, { ex: 300 }); } catch {}
    await saveLog(contactId, chatId, channelId, {});
  }
}
