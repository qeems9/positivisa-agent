const WAZZUP_API_KEY = process.env.WAZZUP_API_KEY;
const WAZZUP_API = "https://api.wazzup24.com/v3";

/**
 * Send a text message via Wazzup API
 * @param {string} channelId - Wazzup channel UUID
 * @param {string} chatId - recipient phone number (e.g. "77001234567")
 * @param {string} text - message text
 * @returns {boolean}
 */
async function sendMessage(channelId, chatId, text) {
  try {
    const res = await fetch(`${WAZZUP_API}/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WAZZUP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channelId,
        chatType: "whatsapp",
        chatId,
        text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Wazzup sendMessage error:", res.status, errText);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Wazzup sendMessage exception:", err.message);
    return false;
  }
}

/**
 * Send a text message to a WhatsApp group via Wazzup API
 * @param {string} channelId - Wazzup channel UUID
 * @param {string} groupChatId - group chatId (e.g. "120363420486252442")
 * @param {string} text - message text
 * @returns {boolean}
 */
async function sendGroupMessage(channelId, groupChatId, text) {
  try {
    const res = await fetch(`${WAZZUP_API}/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WAZZUP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channelId,
        chatType: "whatsgroup",
        chatId: groupChatId,
        text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Wazzup sendGroupMessage error:", res.status, errText);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Wazzup sendGroupMessage exception:", err.message);
    return false;
  }
}

/**
 * Register webhook URL in Wazzup
 * Call once during setup: POST /api/admin/setup-webhook or manually via curl
 * @param {string} webhookUrl - your webhook URL (https://...)
 */
async function registerWebhook(webhookUrl) {
  const res = await fetch(`${WAZZUP_API}/webhooks`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${WAZZUP_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      webhooksUri: webhookUrl,
      subscriptions: {
        messagesAndStatuses: true,
        contactsAndDealsCreation: false,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Wazzup webhook registration failed: ${res.status} ${errText}`);
  }

  return await res.json();
}

/**
 * Get current webhook settings
 */
async function getWebhookSettings() {
  const res = await fetch(`${WAZZUP_API}/webhooks`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${WAZZUP_API_KEY}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Wazzup get webhooks failed: ${res.status} ${errText}`);
  }

  return await res.json();
}

module.exports = { sendMessage, sendGroupMessage, registerWebhook, getWebhookSettings };
