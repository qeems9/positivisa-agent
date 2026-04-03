const { kv } = require("../../lib/kv");
const { checkAuth } = require("./_auth");
const { DEFAULT_SYSTEM_PROMPT } = require("../../lib/claude");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      var v2 = await kv.get("system_prompt_v2");
      if (v2 && v2.text && v2.text.length > 50) return res.status(200).json({ prompt: v2.text });
      var stored = await kv.get("system_prompt");
      if (stored && typeof stored === "string" && stored.length > 50) return res.status(200).json({ prompt: stored });
    } catch {}
    return res.status(200).json({ prompt: DEFAULT_SYSTEM_PROMPT });
  }

  if (req.method === "POST") {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt must be a non-empty string" });
      }
      // Save as v2 (wrapped in object to avoid Upstash pattern issues)
      await kv.set("system_prompt_v2", { text: prompt });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
