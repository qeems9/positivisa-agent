const { checkAuth } = require("./_auth");
const { getReply } = require("../../lib/claude");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, history = [] } = req.body;

    // Debug: check env
    if (message === "__debug_env__") {
      return res.status(200).json({
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        openAIPrefix: (process.env.OPENAI_API_KEY || "").substring(0, 10),
        hasKVUrl: !!process.env.KV_REST_API_URL,
        kvUrlPrefix: (process.env.KV_REST_API_URL || "").substring(0, 20),
        nodeVersion: process.version,
      });
    }

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    const reply = await getReply("test-admin", history, message);
    return res.status(200).json({
      reply: reply.text,
      shouldEscalate: reply.shouldEscalate,
      tokensUsed: reply.tokensUsed,
    });
  } catch (err) {
    console.error("Admin test error:", err.message, err.status, err.code, err.type);
    return res.status(500).json({
      error: err.message,
      status: err.status,
      code: err.code,
      type: err.type,
    });
  }
};
