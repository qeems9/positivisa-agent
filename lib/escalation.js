const { sendMessage, sendGroupMessage } = require("./wazzup");
const { kv } = require("./kv");

const GROUP_CHAT_ID = "120363420486252442";

/**
 * Escalate conversation to a human manager
 * 1. Marks conversation as escalated in KV
 * 2. Sends notification to WhatsApp group
 * 3. Notifies client
 *
 * @param {string} channelId - Wazzup channel UUID
 * @param {string} chatId - client phone number
 * @param {Array} history - conversation messages for context
 */
async function escalate(channelId, chatId, history) {
  // 1. Log escalation context to KV
  try {
    const recentMessages = history.slice(-5);
    const noteText =
      "AI-агент передал диалог менеджеру.\n\nПоследние сообщения:\n" +
      recentMessages
        .map((m) => `${m.role === "user" ? "Клиент" : "Агент"}: ${m.content}`)
        .join("\n");

    const logKey = `log:${chatId}`;
    const existing = await kv.get(logKey);
    if (existing) {
      existing.escalated = true;
      existing.escalatedAt = new Date().toISOString();
      existing.escalationNote = noteText;
      await kv.set(logKey, existing, { ex: 30 * 86400 });
    }
  } catch (err) {
    console.error("Escalation log error:", err.message);
  }

  // 2. Notify group chat (client gets NO message — manager responds personally)
  const phone = chatId.replace(/\D/g, "");
  await sendGroupMessage(
    channelId,
    GROUP_CHAT_ID,
    `Клиент +${phone} ждёт ответа специалиста`
  );
}

module.exports = { escalate };
