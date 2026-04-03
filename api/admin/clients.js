const { kv } = require("../../lib/kv");
const { checkAuth } = require("./_auth");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  // Mark client as paid — bot will stop responding
  if (req.method === "POST") {
    try {
      const { contactId, status } = req.body;
      if (!contactId) {
        return res.status(400).json({ error: "contactId is required" });
      }
      // status: "paid" = bot ignores, "active" = bot responds again
      if (status === "active") {
        await kv.del(`client:${contactId}`);
      } else {
        await kv.set(`client:${contactId}`, "paid", { ex: 365 * 86400 }); // 1 year
      }
      return res.status(200).json({ ok: true, contactId, status: status || "paid" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Get client status
  if (req.method === "GET") {
    try {
      const contactId = req.query.contactId;
      if (!contactId) {
        return res.status(400).json({ error: "contactId query param required" });
      }
      const status = await kv.get(`client:${contactId}`);
      return res.status(200).json({ contactId, status: status || "new" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
