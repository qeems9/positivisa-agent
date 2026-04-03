const { checkAuth } = require("./_auth");
const { getReply } = require("../../lib/claude");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, history = [] } = req.body;

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
    console.error("Admin test error:", err);
    return res.status(500).json({ error: err.message });
  }
};
