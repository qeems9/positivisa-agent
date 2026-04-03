const { kv } = require("./kv");

const MAX_MESSAGES = 20;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory store for fast access during single invocation
const memoryStore = new Map();

async function getHistory(contactId) {
  // Try memory first
  let entry = memoryStore.get(contactId);

  // Fall back to KV for persistence across invocations
  if (!entry) {
    try {
      entry = await kv.get(`conv:${contactId}`);
    } catch {
      entry = null;
    }
  }

  if (!entry) return [];

  // Auto-clear if last message older than 24h
  if (Date.now() - entry.updatedAt > TTL_MS) {
    await clearHistory(contactId);
    return [];
  }

  return entry.messages;
}

async function addMessage(contactId, role, text) {
  let entry = memoryStore.get(contactId);

  if (!entry) {
    try {
      entry = await kv.get(`conv:${contactId}`);
    } catch {
      entry = null;
    }
  }

  if (!entry || Date.now() - entry.updatedAt > TTL_MS) {
    entry = { messages: [], updatedAt: Date.now() };
  }

  entry.messages.push({ role, content: text });

  // Trim to last MAX_MESSAGES
  if (entry.messages.length > MAX_MESSAGES) {
    entry.messages = entry.messages.slice(-MAX_MESSAGES);
  }

  entry.updatedAt = Date.now();
  memoryStore.set(contactId, entry);

  // Persist to KV
  try {
    await kv.set(`conv:${contactId}`, entry, { ex: 86400 }); // 24h TTL
  } catch (err) {
    console.error("KV write error (conversation):", err.message);
  }
}

async function clearHistory(contactId) {
  memoryStore.delete(contactId);
  try {
    await kv.del(`conv:${contactId}`);
  } catch {
    // ignore
  }
}

module.exports = { getHistory, addMessage, clearHistory };
