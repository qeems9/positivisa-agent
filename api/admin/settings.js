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
    // GET — list all clients
    if (req.method === "GET") {
      try {
        var clients = (await kv.get("clients_list")) || [];
        return res.status(200).json({ clients: clients });
      } catch { return res.status(200).json({ clients: [] }); }
    }
    // POST — add/update/remove client
    if (req.method === "POST") {
      try {
        var { contactId, name, country, status, remove } = req.body;
        if (!contactId) return res.status(400).json({ error: "contactId required" });

        var clients = (await kv.get("clients_list")) || [];

        if (remove) {
          // Remove from list + unmark
          clients = clients.filter(function(c) { return c.contactId !== contactId; });
          await kv.del("client:" + contactId);
        } else {
          // Add or update
          var idx = clients.findIndex(function(c) { return c.contactId === contactId; });
          var entry = {
            contactId: contactId,
            name: name || "",
            country: country || "",
            status: status || "paid",
            addedAt: new Date().toISOString()
          };
          if (idx !== -1) {
            entry.addedAt = clients[idx].addedAt || entry.addedAt;
            clients[idx] = entry;
          } else {
            clients.push(entry);
          }
          // Mark in KV for webhook check
          if (status === "active") {
            await kv.del("client:" + contactId);
            // Remove from list too
            clients = clients.filter(function(c) { return c.contactId !== contactId; });
          } else {
            await kv.set("client:" + contactId, "paid", { ex: 365 * 86400 });
          }
        }

        await kv.set("clients_list", clients);
        return res.status(200).json({ ok: true });
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
