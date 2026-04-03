const { getReply } = require("../lib/claude");
const { sendMessage } = require("../lib/wazzup");
const { getHistory, addMessage } = require("../lib/conversation");
const { escalate } = require("../lib/escalation");
const { transcribeVoice } = require("../lib/voice");
const { kv } = require("../lib/kv");

const processedIds = new Set();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    var body = req.body;
    if (body.test === true) return res.status(200).json({ ok: true });

    var messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(200).json({ ok: true, skipped: "no_messages" });
    }

    var botEnabled = true;
    try {
      var enabled = await kv.get("bot_enabled");
      if (enabled === false) botEnabled = false;
    } catch {}

    for (var i = 0; i < messages.length; i++) {
      await processMessage(messages[i], botEnabled);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};

async function saveLog(contactId, chatId, channelId, escalated) {
  try {
    var history = await getHistory(contactId);
    var logKey = "log:" + contactId;
    await kv.set(logKey, {
      contactId: contactId,
      phone: chatId,
      channelId: channelId,
      messages: history,
      escalated: escalated,
      updatedAt: new Date().toISOString(),
    }, { ex: 30 * 86400 });
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

  // --- Outgoing messages (manager/bot) — save to log only ---
  if (isEcho || authorType === "manager" || authorType === "bot") {
    if (text) {
      var role = (authorType === "manager") ? "manager" : "assistant";
      await addMessage(contactId, role, text);
      await saveLog(contactId, chatId, channelId, false);
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

  // --- Paid clients → save message + escalate silently ---
  try {
    var clientStatus = await kv.get("client:" + contactId);
    if (clientStatus === "paid") {
      if (text) await addMessage(contactId, "user", text);
      else await addMessage(contactId, "user", "[Медиа: " + messageType + "]");
      await saveLog(contactId, chatId, channelId, true);
      await escalate(channelId, chatId, await getHistory(contactId));
      return;
    }
  } catch {}

  // --- Voice messages ---
  var messageText = text;
  if ((messageType === "voice" || messageType === "audio") && contentUrl) {
    if (!botEnabled) {
      messageText = "[Голосовое сообщение]";
    } else {
      var transcribed = await transcribeVoice(contentUrl);
      if (!transcribed) return; // Silent — voice not recognized
      messageText = "[Голосовое] " + transcribed;
    }
  }

  // --- Media without text (photo/video/file) → save + escalate silently ---
  if (!messageText && messageType !== "text") {
    await addMessage(contactId, "user", "[Медиа: " + messageType + "]");
    await saveLog(contactId, chatId, channelId, true);
    await escalate(channelId, chatId, await getHistory(contactId));
    return;
  }

  if (!messageText) return;

  // --- Save incoming message ---
  await addMessage(contactId, "user", messageText);
  await saveLog(contactId, chatId, channelId, false);

  // --- Bot disabled — message saved, no reply ---
  if (!botEnabled) return;

  // --- AI flow ---
  var history = await getHistory(contactId);
  var reply;
  try {
    var timeout = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error("timeout")); }, 10000);
    });
    reply = await Promise.race([getReply(contactId, history, messageText), timeout]);
  } catch (err) {
    // AI timeout → escalate silently (no message to client)
    console.error("AI error:", err.message);
    await saveLog(contactId, chatId, channelId, true);
    await escalate(channelId, chatId, await getHistory(contactId));
    return;
  }

  // Save bot reply
  await addMessage(contactId, "assistant", reply.text);

  if (reply.shouldEscalate) {
    // Send bot's reply to client first, then notify group
    if (reply.text) await sendMessage(channelId, chatId, reply.text);
    await saveLog(contactId, chatId, channelId, true);
    await escalate(channelId, chatId, await getHistory(contactId));
  } else {
    await sendMessage(channelId, chatId, reply.text);
    await saveLog(contactId, chatId, channelId, false);
  }
}
