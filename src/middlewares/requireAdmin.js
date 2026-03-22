const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      return res.status(401).json({ message: "Token manquant" });

    const token = header.split(" ")[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.userId).select("isAdmin");

    if (!user?.isAdmin)
      return res.status(403).json({ message: "Accès refusé" });

    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ message: "Token invalide" });
  }
};
