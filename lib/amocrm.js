const AMO_DOMAIN = process.env.AMO_DOMAIN;
const AMO_TOKEN = process.env.AMO_ACCESS_TOKEN;

function amoFetch(path, options = {}) {
  const url = `https://${AMO_DOMAIN}/api/v4${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AMO_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

/**
 * Send a message to a contact in WhatsApp via AmoCRM chat API
 */
async function sendMessage(contactId, leadId, text) {
  // AmoCRM uses the Talk API to send outgoing messages
  // The exact endpoint depends on the WA integration (wazzup, green-api, built-in)
  // This uses the generic AmoCRM chat API
  try {
    const res = await fetch(`https://${AMO_DOMAIN}/api/v4/contacts/${contactId}/chats`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${AMO_TOKEN}`,
      },
    });
    const chatsData = await res.json();

    // Get the first active chat (WhatsApp)
    const chat = chatsData._embedded?.chats?.[0];
    if (!chat) {
      console.error("No active chat found for contact", contactId);
      return false;
    }

    const chatId = chat.chat_id;
    const scope_id = chat.id;

    // Send message via Talk API
    const sendRes = await fetch(
      `https://${AMO_DOMAIN}/api/v4/chats/${chatId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AMO_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          type: "text",
        }),
      }
    );

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error("AmoCRM sendMessage error:", sendRes.status, errText);
      return false;
    }

    return true;
  } catch (err) {
    console.error("AmoCRM sendMessage exception:", err.message);
    return false;
  }
}

/**
 * Add a note to a lead
 */
async function addNote(leadId, text) {
  try {
    const res = await amoFetch(`/leads/${leadId}/notes`, {
      method: "POST",
      body: JSON.stringify([
        {
          note_type: "common",
          params: { text },
        },
      ]),
    });
    return res.ok;
  } catch (err) {
    console.error("AmoCRM addNote error:", err.message);
    return false;
  }
}

/**
 * Set a tag on a lead
 */
async function setTag(leadId, tag) {
  try {
    const res = await amoFetch(`/leads`, {
      method: "PATCH",
      body: JSON.stringify([
        {
          id: Number(leadId),
          _embedded: {
            tags: [{ name: tag }],
          },
        },
      ]),
    });
    return res.ok;
  } catch (err) {
    console.error("AmoCRM setTag error:", err.message);
    return false;
  }
}

/**
 * Assign a lead to a specific manager
 */
async function assignToManager(leadId, managerId) {
  try {
    const res = await amoFetch(`/leads`, {
      method: "PATCH",
      body: JSON.stringify([
        {
          id: Number(leadId),
          responsible_user_id: Number(managerId),
        },
      ]),
    });
    return res.ok;
  } catch (err) {
    console.error("AmoCRM assignToManager error:", err.message);
    return false;
  }
}

module.exports = { sendMessage, addNote, setTag, assignToManager };
