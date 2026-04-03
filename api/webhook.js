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



    // --- Check if bot is enabled ---
    try {
      const enabled = await kv.get("bot_enabled");
      if (enabled === false) {
        return res.status(200).json({ ok: true, skipped: "bot_disabled" });
      }
    } catch {
      // KV error — bot continues working by default
    }

    // --- Wazzup webhook: messages array ---
    const messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      // Status updates or other webhook types — acknowledge
      return res.status(200).json({ ok: true, skipped: "no_messages" });
    }

    // Process each incoming message
    for (const msg of messages) {
      await processMessage(msg);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    // Always return 200 to avoid Wazzup retries
    return res.status(200).json({ ok: false, error: err.message });
  }
};

async function processMessage(msg) {
  // --- Parse Wazzup message fields ---
  const messageId = msg.messageId || "";
  const channelId = msg.channelId || "";
  const chatId = msg.chatId || "";          // phone number for WhatsApp
  const chatType = msg.chatType || "";       // "whatsapp"
  const messageType = msg.type || "text";    // "text", "image", "voice", "audio", "video", "document"
  const isEcho = msg.isEcho || false;        // true = sent by operator/bot
  const text = (msg.text || "").trim();
  const contentUrl = msg.content || "";      // media URL for non-text messages
  const authorType = msg.authorType || "";   // "client", "manager", "bot"

  // Use chatId as contact identifier (phone number)
  const contactId = chatId;

  // Skip if not WhatsApp
  if (chatType && chatType !== "whatsapp") {
    return;
  }

  // Skip outgoing messages (sent by us or manager)
  if (isEcho || authorType === "manager" || authorType === "bot") {
    return;
  }

  // Skip empty text messages
  if (!text && messageType === "text") {
    return;
  }

  // Skip if no contact
  if (!contactId) {
    return;
  }

  // --- Dedup ---
  if (messageId) {
    if (processedIds.has(messageId)) return;
    try {
      const kvKey = `dedup:${messageId}`;
      const exists = await kv.get(kvKey);
      if (exists) return;
      await kv.set(kvKey, 1, { ex: 3600 }); // 1h TTL
    } catch {
      // KV not available, in-memory only
    }
    processedIds.add(messageId);
  }

  // --- Skip paid/existing clients (let manager handle) ---
  try {
    const clientStatus = await kv.get(`client:${contactId}`);
    if (clientStatus === "paid") {
      return; // Don't respond — manager handles paid clients
    }
  } catch {
    // KV error — continue
  }

  // --- Handle message by type ---
  let messageText = text;

  // Voice / audio messages — transcribe
  if ((messageType === "voice" || messageType === "audio") && contentUrl) {
    const transcribed = await transcribeVoice(contentUrl);
    if (!transcribed) {
      await sendMessage(channelId, chatId, "Не смог распознать голосовое, напишите текстом пожалуйста");
      return;
    }
    messageText = `[Голосовое] ${transcribed}`;
  }

  // Non-text media without text (image, video, document, sticker, location)
  if (!messageText && messageType !== "text") {
    await sendMessage(channelId, chatId, "Получил! Напишите пожалуйста текстом, чем могу помочь?");
    return;
  }

  // Final check: no text to process
  if (!messageText) return;

  // --- Main AI flow ---

  const history = await getHistory(contactId);

  // Call Claude with timeout
  let reply;
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Claude timeout")), 10000)
    );
    reply = await Promise.race([
      getReply(contactId, history, messageText),
      timeoutPromise,
    ]);
  } catch (err) {
    console.error("Claude error/timeout:", err.message);
    await sendMessage(channelId, chatId, "Секунду, уточняю информацию...");
    return;
  }

  // Save to conversation history
  await addMessage(contactId, "user", messageText);
  await addMessage(contactId, "assistant", reply.text);

  // Log to KV
  try {
    const updatedHistory = await getHistory(contactId);
    const logKey = `log:${contactId}`;
    await kv.set(
      logKey,
      {
        contactId,
        phone: chatId,
        channelId,
        messages: updatedHistory,
        escalated: reply.shouldEscalate,
        updatedAt: new Date().toISOString(),
      },
      { ex: 30 * 86400 } // 30 days TTL
    );
    await kv.zadd("log:index", {
      score: Date.now(),
      member: logKey,
    });
  } catch (err) {
    console.error("Log save error:", err.message);
  }

  // Send reply or escalate
  if (reply.shouldEscalate) {
    const fullHistory = await getHistory(contactId);
    await escalate(channelId, chatId, fullHistory);
  } else {
    await sendMessage(channelId, chatId, reply.text);
  }
}
