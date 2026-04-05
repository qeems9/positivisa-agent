const { getReply } = require("../lib/claude");
const { sendMessage } = require("../lib/wazzup");
const { getHistory, addMessage } = require("../lib/conversation");
const { escalate } = require("../lib/escalation");
const { kv } = require("../lib/kv");

const WAIT_SECONDS = 30;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  var { contactId, chatId, channelId, ts } = req.body || {};
  if (!contactId || !ts) return res.status(400).json({ error: "missing params" });

  // Wait 30 seconds
  await new Promise(function(resolve) { setTimeout(resolve, WAIT_SECONDS * 1000); });

  // Check if this is still the latest batch (no new messages arrived)
  var currentTs;
  try { currentTs = await kv.get("buffer_ts:" + contactId); } catch {}
  if (String(currentTs) !== String(ts)) {
    // Newer messages arrived — another invocation will handle them
    return res.status(200).json({ ok: true, skipped: "newer_batch" });
  }

  // Grab all buffered messages
  var buffer;
  try { buffer = await kv.get("buffer:" + contactId); } catch {}
  if (!buffer || !Array.isArray(buffer) || buffer.length === 0) {
    return res.status(200).json({ ok: true, skipped: "empty_buffer" });
  }

  // Clear buffer
  try {
    await kv.del("buffer:" + contactId);
    await kv.del("buffer_ts:" + contactId);
  } catch {}

  // Combine all messages into one text
  var combinedText = buffer.map(function(m) { return m.text; }).filter(Boolean).join("\n");
  if (!combinedText) return res.status(200).json({ ok: true, skipped: "empty_text" });

  // Check bot enabled
  var botEnabled = true;
  try { if ((await kv.get("bot_enabled")) === false) botEnabled = false; } catch {}

  if (!botEnabled) {
    await saveLog(contactId, chatId, channelId, { needsReply: true });
    return res.status(200).json({ ok: true, skipped: "bot_disabled" });
  }

  // Check if escalated
  try {
    var existingLog = await kv.get("log:" + contactId);
    if (existingLog && existingLog.escalated) {
      await saveLog(contactId, chatId, channelId, { escalated: true, needsReply: true });
      return res.status(200).json({ ok: true, skipped: "escalated" });
    }
  } catch {}

  // AI flow
  var history = await getHistory(contactId);
  var reply;
  try {
    var timeout = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error("timeout")); }, 15000);
    });
    reply = await Promise.race([getReply(contactId, history, combinedText), timeout]);
  } catch (err) {
    console.error("AI error:", err.message);
    await saveLog(contactId, chatId, channelId, { needsReply: true });
    return res.status(200).json({ ok: false, error: err.message });
  }

  await addMessage(contactId, "assistant", reply.text);

  if (reply.shouldEscalate) {
    if (reply.text) {
      var sentId = await sendMessage(channelId, chatId, reply.text);
      if (sentId && typeof sentId === "string") try { await kv.set("sent:" + sentId, 1, { ex: 300 }); } catch {}
    }
    var escReason = "требуется менеджер";
    var combinedLower = combinedText.toLowerCase();
    if (combinedLower.includes("на этот") || combinedLower.match(/\+?\d{10,}/) || combinedLower.includes("выставь") || combinedLower.includes("выставите")) {
      escReason = "ждёт счёт на оплату";
    }
    await saveLog(contactId, chatId, channelId, { escalated: true, needsReply: true });
    await escalate(channelId, chatId, await getHistory(contactId), escReason);
  } else {
    var sentId2 = await sendMessage(channelId, chatId, reply.text);
    if (sentId2 && typeof sentId2 === "string") try { await kv.set("sent:" + sentId2, 1, { ex: 300 }); } catch {}

    // Detect "thinking" client — set flag for 2-day follow-up
    var combinedLower = combinedText.toLowerCase();
    // Only "подумаю" / "надо подумать" triggers 2-day follow-up (strict)
    var isThinking = combinedLower.includes("подумаю") || combinedLower.includes("надо подумать") || combinedLower.includes("ойланамын") || combinedLower.includes("ойланып");
    await saveLog(contactId, chatId, channelId, { thinkingClient: isThinking || undefined });
  }

  return res.status(200).json({ ok: true, processed: true });
};

async function saveLog(contactId, chatId, channelId, opts) {
  try {
    var history = await getHistory(contactId);
    var logKey = "log:" + contactId;
    var existing = (await kv.get(logKey)) || {};
    var log = {
      contactId: contactId,
      phone: chatId,
      channelId: channelId,
      messages: history,
      escalated: (opts && opts.escalated) || false,
      needsReply: (opts && opts.needsReply) || false,
      isPaid: (opts && opts.isPaid) || existing.isPaid || false,
      thinkingClient: (opts && opts.thinkingClient) || existing.thinkingClient || false,
      followup2dSent: existing.followup2dSent || false,
      followup3dSent: (opts && (opts.escalated || opts.needsReply)) ? existing.followup3dSent : false,
      followup7dSent: (opts && (opts.escalated || opts.needsReply)) ? existing.followup7dSent : false,
      updatedAt: new Date().toISOString(),
    };
    await kv.set(logKey, log, { ex: 30 * 86400 });
    await kv.zadd("log:index", { score: Date.now(), member: logKey });
  } catch (err) {
    console.error("Log save error:", err.message);
  }
}
