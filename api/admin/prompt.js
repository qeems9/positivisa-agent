const { kv } = require("../../lib/kv");
const { checkAuth } = require("./_auth");
const { DEFAULT_SYSTEM_PROMPT } = require("../../lib/claude");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      const stored = await kv.get("system_prompt");
      return res.status(200).json({ prompt: stored || DEFAULT_SYSTEM_PROMPT });
    } catch {
      return res.status(200).json({ prompt: DEFAULT_SYSTEM_PROMPT });
    }
  }

  if (req.method === "POST") {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt must be a non-empty string" });
      }
      await kv.set("system_prompt", prompt);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
