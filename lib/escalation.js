const { sendMessage } = require("./wazzup");
const { kv } = require("./kv");

/**
 * Escalate conversation to a human manager
 * Marks the conversation as escalated in KV and notifies the client.
 * Manager sees escalations in the admin panel (/admin → Диалоги → Требуют ответа).
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

  // 2. Notify client
  await sendMessage(
    channelId,
    chatId,
    "Передаю вас специалисту, ответим в течение нескольких минут"
  );
}

module.exports = { escalate };
