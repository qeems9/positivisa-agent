const { kv } = require("../../lib/kv");
const { checkAuth } = require("./_auth");
const defaultKnowledge = require("../../config/knowledge");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      const stored = await kv.get("knowledge");
      return res.status(200).json(stored || defaultKnowledge);
    } catch {
      return res.status(200).json(defaultKnowledge);
    }
  }

  if (req.method === "POST") {
    try {
      const knowledge = req.body;

      // Basic validation
      if (!knowledge || !knowledge.directions || !knowledge.faq || !knowledge.contacts) {
        return res.status(400).json({ error: "Invalid knowledge structure" });
      }

      await kv.set("knowledge", knowledge);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
