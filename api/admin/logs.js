const { kv } = require("@vercel/kv");
const { checkAuth } = require("./_auth");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;

    // Get log keys from sorted set (newest first)
    const keys = await kv.zrange("log:index", offset, offset + limit - 1, {
      rev: true,
    });

    if (!keys || keys.length === 0) {
      return res.status(200).json({ logs: [], total: 0 });
    }

    // Fetch all logs in parallel
    const logs = await Promise.all(
      keys.map(async (key) => {
        try {
          return await kv.get(key);
        } catch {
          return null;
        }
      })
    );

    const total = await kv.zcard("log:index");

    return res.status(200).json({
      logs: logs.filter(Boolean),
      total: total || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("Logs error:", err);
    return res.status(500).json({ error: err.message });
  }
};
