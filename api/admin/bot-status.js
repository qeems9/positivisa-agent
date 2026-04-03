const { kv } = require("../../lib/kv");
const { checkAuth } = require("./_auth");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      const enabled = await kv.get("bot_enabled");
      // Default: enabled (null means never set = enabled)
      return res.status(200).json({ enabled: enabled !== false });
    } catch {
      return res.status(200).json({ enabled: true });
    }
  }

  if (req.method === "POST") {
    try {
      const { enabled } = req.body;
      await kv.set("bot_enabled", !!enabled);
      return res.status(200).json({ ok: true, enabled: !!enabled });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
