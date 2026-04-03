const { kv } = require("../../lib/kv");
const { checkAuth } = require("./_auth");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      const logs = await kv.get("debug:webhooks") || [];
      return res.status(200).json({ webhooks: logs });
    } catch {
      return res.status(200).json({ webhooks: [] });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
