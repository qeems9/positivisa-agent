const { getReply } = require("../lib/claude");
const { sendMessage, addNote } = require("../lib/amocrm");
const { getHistory, addMessage } = require("../lib/conversation");
const { escalate } = require("../lib/escalation");
const { transcribeVoice } = require("../lib/voice");
const { kv } = require("@vercel/kv");

// Simple dedup: track processed message IDs (in-memory per invocation + KV)
const processedIds = new Set();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;

    // --- Parse incoming webhook from AmoCRM ---
    // AmoCRM webhook structure varies by WA integration.
    // This handles the common AmoCRM chat webhook format.
    // Adjust field names based on your specific integration (wazzup/green-api/built-in).

    const message = body?.message || body;
    const contactId = String(
      message.contact_id || message.chat_id || message.receiver?.id || ""
    );
    const leadId = String(message.lead_id || message.entity_id || "");
    const messageId = String(message.message_id || message.id || "");
    const phone = String(message.phone || message.sender?.phone || "");

    // Determine message type and extract text
    const messageType = message.type || message.message_type || "text";
    const mediaUrl = message.media_url || message.media || message.file_url || "";
    let messageText = String(message.text || message.message || "").trim();

    // Ignore empty messages
    if (!messageText && messageType === "text") {
      return res.status(200).json({ ok: true, skipped: "empty" });
    }

    // Ignore if no contact
    if (!contactId) {
      return res.status(200).json({ ok: true, skipped: "no_contact" });
    }

    // Dedup check
    if (messageId) {
      if (processedIds.has(messageId)) {
        return res.status(200).json({ ok: true, skipped: "duplicate" });
      }
      try {
        const kvKey = `dedup:${messageId}`;
        const exists = await kv.get(kvKey);
        if (exists) {
          return res.status(200).json({ ok: true, skipped: "duplicate" });
        }
        await kv.set(kvKey, 1, { ex: 3600 }); // 1h TTL
      } catch {
        // KV not available, use in-memory only
      }
      processedIds.add(messageId);
    }

    // Ignore outgoing messages (sent by us / manager)
    if (
      message.direction === "out" ||
      message.is_incoming === false ||
      message.created_by !== undefined
    ) {
      return res.status(200).json({ ok: true, skipped: "outgoing" });
    }

    // Handle voice/audio messages
    if (
      (messageType === "audio" || messageType === "voice") &&
      mediaUrl
    ) {
      const transcribed = await transcribeVoice(mediaUrl);
      if (!transcribed) {
        await sendMessage(
          contactId,
          leadId,
          "Не смог распознать голосовое, напишите текстом пожалуйста"
        );
        return res.status(200).json({ ok: true, type: "voice_failed" });
      }
      messageText = `[Голосовое] ${transcribed}`;
    }

    // Handle non-text media (images, files, etc.)
    if (!messageText && messageType !== "text") {
      await sendMessage(
        contactId,
        leadId,
        "Получил! Напишите пожалуйста текстом, чем могу помочь?"
      );
      return res.status(200).json({ ok: true, type: "media_no_text" });
    }

    // --- Main flow ---

    // Get conversation history
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

      // Auto-escalate on timeout/error
      await sendMessage(contactId, leadId, "Секунду, уточняю информацию...");
      await addNote(
        leadId,
        `AI-агент: ошибка (${err.message}). Требуется ручная обработка.`
      );
      return res.status(200).json({ ok: true, error: "claude_failure" });
    }

    // Save messages to history
    await addMessage(contactId, "user", messageText);
    await addMessage(contactId, "assistant", reply.text);

    // Log conversation to KV
    try {
      const updatedHistory = await getHistory(contactId);
      const logKey = `log:${contactId}`;
      await kv.set(
        logKey,
        {
          contactId,
          phone,
          leadId,
          startedAt: updatedHistory[0]
            ? new Date().toISOString()
            : new Date().toISOString(),
          messages: updatedHistory,
          escalated: reply.shouldEscalate,
          updatedAt: new Date().toISOString(),
        },
        { ex: 30 * 86400 } // 30 days TTL
      );

      // Add to log index for listing
      await kv.zadd("log:index", {
        score: Date.now(),
        member: logKey,
      });
    } catch (err) {
      console.error("Log save error:", err.message);
    }

    // Handle escalation or send reply
    if (reply.shouldEscalate) {
      const fullHistory = await getHistory(contactId);

      // Send the AI reply first (if it has content)
      if (reply.text) {
        await sendMessage(contactId, leadId, reply.text);
      }

      await escalate(contactId, leadId, fullHistory);
    } else {
      await sendMessage(contactId, leadId, reply.text);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
