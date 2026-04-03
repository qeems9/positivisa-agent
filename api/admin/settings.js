const { kv } = require("../../lib/kv");
const { checkAuth } = require("./_auth");
const { getRates } = require("../../lib/rates");

// Combined endpoint: /api/admin/settings?action=bot-status|clients|rates
module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  var action = req.query.action || req.body?.action;

  // --- Bot Status ---
  if (action === "bot-status") {
    if (req.method === "GET") {
      try {
        var enabled = await kv.get("bot_enabled");
        return res.status(200).json({ enabled: enabled !== false });
      } catch { return res.status(200).json({ enabled: true }); }
    }
    if (req.method === "POST") {
      try {
        await kv.set("bot_enabled", !!req.body.enabled);
        return res.status(200).json({ ok: true, enabled: !!req.body.enabled });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
  }

  // --- Clients ---
  if (action === "clients") {
    if (req.method === "POST") {
      try {
        var { contactId, status } = req.body;
        if (!contactId) return res.status(400).json({ error: "contactId required" });
        if (status === "active") { await kv.del("client:" + contactId); }
        else { await kv.set("client:" + contactId, "paid", { ex: 365 * 86400 }); }
        return res.status(200).json({ ok: true, contactId: contactId, status: status || "paid" });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
    if (req.method === "GET") {
      try {
        var cid = req.query.contactId;
        if (!cid) return res.status(400).json({ error: "contactId param required" });
        var st = await kv.get("client:" + cid);
        return res.status(200).json({ contactId: cid, status: st || "new" });
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
  }

  // --- Rates ---
  if (action === "rates") {
    if (req.method === "GET") {
      try {
        var rates = await getRates();
        return res.status(200).json(rates);
      } catch (err) { return res.status(500).json({ error: err.message }); }
    }
  }

  return res.status(400).json({ error: "Unknown action. Use ?action=bot-status|clients|rates" });
};
