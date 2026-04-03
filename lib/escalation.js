const { sendMessage, addNote, setTag, assignToManager } = require("./amocrm");

const MANAGER_USER_ID = process.env.AMO_MANAGER_USER_ID;

/**
 * Escalate conversation to a human manager
 * @param {string} contactId
 * @param {string} leadId
 * @param {Array} history - last messages for context
 */
async function escalate(contactId, leadId, history) {
  // 1. Tag the lead
  await setTag(leadId, "Требует менеджера");

  // 2. Add note with last 5 messages for context
  const recentMessages = history.slice(-5);
  const noteText =
    "AI-агент передал диалог менеджеру.\n\nПоследние сообщения:\n" +
    recentMessages
      .map((m) => `${m.role === "user" ? "Клиент" : "Агент"}: ${m.content}`)
      .join("\n");
  await addNote(leadId, noteText);

  // 3. Assign to manager
  if (MANAGER_USER_ID) {
    await assignToManager(leadId, MANAGER_USER_ID);
  }

  // 4. Notify client
  await sendMessage(
    contactId,
    leadId,
    "Передаю вас специалисту, ответим в течение нескольких минут"
  );
}

module.exports = { escalate };
