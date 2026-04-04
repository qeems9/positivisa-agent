var { checkAuth } = require("./_auth");
var { kv } = require("../../lib/kv");
var { sendMessage } = require("../../lib/wazzup");
var { addMessage, getHistory } = require("../../lib/conversation");

var FOLLOWUP_3D = "Здравствуйте! К сожалению, не получили от вас никакого ответа. Подскажите вопрос по визе еще актуален?";
var FOLLOWUP_7D = "Здравствуйте! Не получили от вас никакого ответа. Сохраните наш номер на будущее \u{1F607}\nИ обращайтесь если понадобится наша помощь, а пока закрываем вашу заявку";
var THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
var SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var keys = await kv.zrange("log:index", 0, -1, { rev: true });
    if (!keys || keys.length === 0) return res.status(200).json({ sent: 0 });

    var sent = 0;
    for (var i = 0; i < keys.length && i < 100; i++) {
      try {
        var log = await kv.get(keys[i]);
        if (!log || !log.channelId || !log.contactId) continue;
        if (log.isPaid || log.needsReply) continue;

        var msgs = log.messages || [];
        if (msgs.length === 0) continue;

        // Find last user msg and last outgoing msg indices
        var lastUserIdx = -1, lastOutIdx = -1;
        for (var j = msgs.length - 1; j >= 0; j--) {
          if (msgs[j].role === "user" && lastUserIdx === -1) lastUserIdx = j;
          if ((msgs[j].role === "assistant" || msgs[j].role === "manager" || msgs[j].role === "admin") && lastOutIdx === -1) lastOutIdx = j;
          if (lastUserIdx !== -1 && lastOutIdx !== -1) break;
        }

        // Client silent: last outgoing after last user msg
        if (lastOutIdx <= lastUserIdx || !log.updatedAt) continue;
        var silence = Date.now() - new Date(log.updatedAt).getTime();

        var chatId = log.phone || log.contactId;
        var textToSend = null;

        // 7+ days: final closure (if 3-day followup was already sent)
        if (silence >= SEVEN_DAYS && log.followup3dSent && !log.followup7dSent) {
          textToSend = FOLLOWUP_7D;
          log.followup7dSent = true;
        }
        // 3+ days: first reminder
        else if (silence >= THREE_DAYS && !log.followup3dSent) {
          textToSend = FOLLOWUP_3D;
          log.followup3dSent = true;
        }

        if (textToSend) {
          var sentId = await sendMessage(log.channelId, chatId, textToSend);
          if (sentId) {
            if (typeof sentId === "string") try { await kv.set("sent:" + sentId, 1, { ex: 300 }); } catch {}
            await addMessage(log.contactId, "assistant", textToSend);
            log.messages = await getHistory(log.contactId);
            log.updatedAt = new Date().toISOString();
            await kv.set(keys[i], log, { ex: 30 * 86400 });
            sent++;
          }
        }
      } catch (err) {
        console.error("Followup error:", err.message);
      }
    }

    return res.status(200).json({ ok: true, sent: sent });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
