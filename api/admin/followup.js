var { checkAuth } = require("./_auth");
var { kv } = require("../../lib/kv");
var { sendMessage } = require("../../lib/wazzup");
var { addMessage, getHistory } = require("../../lib/conversation");

var FOLLOWUP_TEXT = "Здравствуйте! К сожалению, не получили от вас никакого ответа. Подскажите вопрос по визе еще актуален?";
var THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Get all conversation keys
    var keys = await kv.zrange("log:index", 0, -1, { rev: true });
    if (!keys || keys.length === 0) return res.status(200).json({ sent: 0 });

    var sent = 0;
    for (var i = 0; i < keys.length && i < 100; i++) {
      try {
        var log = await kv.get(keys[i]);
        if (!log || !log.channelId || !log.contactId) continue;
        if (log.isPaid || log.needsReply || log.followupSent) continue;

        var msgs = log.messages || [];
        if (msgs.length === 0) continue;

        // Find last user msg and last outgoing msg indices
        var lastUserIdx = -1, lastOutIdx = -1;
        for (var j = msgs.length - 1; j >= 0; j--) {
          if (msgs[j].role === "user" && lastUserIdx === -1) lastUserIdx = j;
          if ((msgs[j].role === "assistant" || msgs[j].role === "manager" || msgs[j].role === "admin") && lastOutIdx === -1) lastOutIdx = j;
          if (lastUserIdx !== -1 && lastOutIdx !== -1) break;
        }

        // Client silent: last outgoing after last user msg, 3+ days ago
        if (lastOutIdx > lastUserIdx && log.updatedAt) {
          var silence = Date.now() - new Date(log.updatedAt).getTime();
          if (silence >= THREE_DAYS) {
            // Send follow-up
            var chatId = log.phone || log.contactId;
            var sentId = await sendMessage(log.channelId, chatId, FOLLOWUP_TEXT);
            if (sentId) {
              // Mark sent in KV
              if (sentId && typeof sentId === "string") {
                try { await kv.set("sent:" + sentId, 1, { ex: 300 }); } catch {}
              }
              await addMessage(log.contactId, "assistant", FOLLOWUP_TEXT);
              log.followupSent = true;
              log.messages = await getHistory(log.contactId);
              log.updatedAt = new Date().toISOString();
              await kv.set(keys[i], log, { ex: 30 * 86400 });
              sent++;
            }
          }
        }
      } catch (err) {
        console.error("Followup check error:", err.message);
      }
    }

    return res.status(200).json({ ok: true, sent: sent });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
