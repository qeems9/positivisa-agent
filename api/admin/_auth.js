/**
 * Basic Auth middleware for admin routes
 * Returns true if authenticated, sends 401 and returns false otherwise
 */
function checkAuth(req, res) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="PositiVisa Admin"');
    res.status(401).json({ error: "Authentication required" });
    return false;
  }

  const base64 = authHeader.slice(6);
  const decoded = Buffer.from(base64, "base64").toString("utf-8");
  // We expect format "admin:password" — only check the password part
  const password = decoded.includes(":") ? decoded.split(":").slice(1).join(":") : decoded;

  if (password !== process.env.ADMIN_PASSWORD) {
    res.setHeader("WWW-Authenticate", 'Basic realm="PositiVisa Admin"');
    res.status(401).json({ error: "Invalid credentials" });
    return false;
  }

  return true;
}

module.exports = { checkAuth };
