const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const parts = authHeader.split(" ");
    const token = parts.length === 2 && /^Bearer$/i.test(parts[0]) ? parts[1] : null;

    if (!token) {
      return res.status(401).json({ error: "Token manquant" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: "JWT_SECRET manquant" });
    }

    const decoded = jwt.verify(token, secret);
    req.userId = decoded.userId;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalide" });
  }
}

module.exports = requireAuth;

