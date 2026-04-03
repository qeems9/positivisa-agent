const { getReply } = require("../lib/claude");
const { sendMessage } = require("../lib/wazzup");
const { getHistory, addMessage } = require("../lib/conversation");
const { escalate } = require("../lib/escalation");
const { transcribeVoice } = require("../lib/voice");
const { kv } = require("../lib/kv");

// Dedup: track processed message IDs in-memory per invocation
const processedIds = new Set();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;

    // --- Wazzup test webhook ---
    if (body.test === true) {
      return res.status(200).json({ ok: true });
    }

    // --- Wazzup webhook: messages array ---
    const messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(200).json({ ok: true, skipped: "no_messages" });
    }

    // Check if bot is enabled (messages are always saved regardless)
    let botEnabled = true;
    try {
      const enabled = await kv.get("bot_enabled");
      if (enabled === false) botEnabled = false;
    } catch {}

    // Process each incoming message
    for (const msg of messages) {
      await processMessage(msg, botEnabled);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};

async function processMessage(msg, botEnabled) {
  const messageId = msg.messageId || "";
  const channelId = msg.channelId || "";
  const chatId = msg.chatId || "";
  const chatType = msg.chatType || "";
  const messageType = msg.type || "text";
  const isEcho = msg.isEcho || false;
  const text = (msg.text || "").trim();
  const contentUrl = msg.content || "";
  const authorType = msg.authorType || "";
  const contactId = chatId;

  if (chatType && chatType !== "whatsapp") return;
  if (isEcho || authorType === "manager" || authorType === "bot") return;
  if (!text && messageType === "text") return;
  if (!contactId) return;

  // --- Dedup ---
  if (messageId) {
    if (processedIds.has(messageId)) return;
    try {
      const kvKey = `dedup:${messageId}`;
      const exists = await kv.get(kvKey);
      if (exists) return;
      await kv.set(kvKey, 1, { ex: 3600 });
    } catch {}
    processedIds.add(messageId);
  }

  // --- Skip paid/existing clients ---
  try {
    const clientStatus = await kv.get(`client:${contactId}`);
    if (clientStatus === "paid") return;
  } catch {}

  // --- Handle message by type ---
  let messageText = text;

  if ((messageType === "voice" || messageType === "audio") && contentUrl) {
    if (!botEnabled) {
      // Save raw info, don't transcribe when bot is off
      messageText = "[Голосовое сообщение]";
    } else {
      const transcribed = await transcribeVoice(contentUrl);
      if (!transcribed) {
        await sendMessage(channelId, chatId, "Не смог распознать голосовое, напишите текстом пожалуйста");
        return;
      }
      messageText = `[Голосовое] ${transcribed}`;
    }
  }

  if (!messageText && messageType !== "text") {
    if (botEnabled) {
      await sendMessage(channelId, chatId, "Получил! Напишите пожалуйста текстом, чем могу помочь?");
    }
    return;
  }

  if (!messageText) return;

  // --- Always save incoming message ---
  await addMessage(contactId, "user", messageText);

  // --- Log to KV (always, even when bot is off) ---
  try {
    const updatedHistory = await getHistory(contactId);
    const logKey = `log:${contactId}`;
    await kv.set(logKey, {
      contactId,
      phone: chatId,
      channelId,
      messages: updatedHistory,
      escalated: false,
      updatedAt: new Date().toISOString(),
    }, { ex: 30 * 86400 });
    await kv.zadd("log:index", { score: Date.now(), member: logKey });
  } catch (err) {
    console.error("Log save error:", err.message);
  }

  // --- If bot is disabled, stop here (message is saved but no reply) ---
  if (!botEnabled) return;

  // --- Main AI flow ---
  const history = await getHistory(contactId);

  let reply;
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 10000)
    );
    reply = await Promise.race([getReply(contactId, history, messageText), timeoutPromise]);
  } catch (err) {
    console.error("AI error/timeout:", err.message);
    await sendMessage(channelId, chatId, "Секунду, уточняю информацию...");
    return;
  }

  // Save bot reply to history
  await addMessage(contactId, "assistant", reply.text);

  // Update log with reply
  try {
    const fullHistory = await getHistory(contactId);
    const logKey = `log:${contactId}`;
    await kv.set(logKey, {
      contactId,
      phone: chatId,
      channelId,
      messages: fullHistory,
      escalated: reply.shouldEscalate,
      updatedAt: new Date().toISOString(),
    }, { ex: 30 * 86400 });
  } catch {}

  // Send reply or escalate
  if (reply.shouldEscalate) {
    const fullHistory = await getHistory(contactId);
    await escalate(channelId, chatId, fullHistory);
  } else {
    await sendMessage(channelId, chatId, reply.text);
  }
}
