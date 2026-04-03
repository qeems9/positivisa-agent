const { kv } = require("@vercel/kv");
const { checkAuth } = require("./_auth");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      // Get all log keys
      const keys = await kv.zrange("log:index", 0, -1, { rev: true });

      if (!keys || keys.length === 0) {
        return res.status(200).json({ escalations: [] });
      }

      // Fetch all and filter escalated + unresolved
      const allLogs = await Promise.all(
        keys.map(async (key) => {
          try {
            const log = await kv.get(key);
            if (log) log._key = key;
            return log;
          } catch {
            return null;
          }
        })
      );

      const escalations = allLogs.filter(
        (log) => log && log.escalated && !log.resolved
      );

      return res.status(200).json({ escalations });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST to mark escalation as resolved
  if (req.method === "POST") {
    try {
      const { contactId } = req.body;
      if (!contactId) {
        return res.status(400).json({ error: "contactId is required" });
      }

      const logKey = `log:${contactId}`;
      const log = await kv.get(logKey);
      if (!log) {
        return res.status(404).json({ error: "Log not found" });
      }

      log.resolved = true;
      log.resolvedAt = new Date().toISOString();
      await kv.set(logKey, log, { ex: 30 * 86400 });

      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
