const { checkAuth } = require("./_auth");
const { getRates } = require("../../lib/rates");

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rates = await getRates();
    return res.status(200).json(rates);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
