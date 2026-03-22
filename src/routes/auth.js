const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const admin = require("../config/firebase");
const User = require("../models/User");

const router = express.Router();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, avatarUrl } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, password requis" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "email invalide" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "password >= 6" });
    }

    if (avatarUrl) {
      console.log(
        `[Auth] register avatarUrl received len=${String(avatarUrl).length} prefix=${String(avatarUrl).slice(0, 50)}`
      );
    } else {
      console.log(`[Auth] register avatarUrl empty`);
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: "Email déjà utilisé" });

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      passwordHash,
      age: req.body.age,
      city: req.body.city,
      bio: req.body.bio,
      avatarUrl: req.body.avatarUrl,
      hobbies: req.body.hobbies || [],
      language: req.body.language || "fr",
    });

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return res.status(500).json({ error: "JWT_SECRET manquant" });

    const token = jwt.sign({ userId: user._id }, jwtSecret, { expiresIn: "30d" });
    return res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl || null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email et password requis" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok) return res.status(401).json({ error: "Identifiants invalides" });

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return res.status(500).json({ error: "JWT_SECRET manquant" });

    const token = jwt.sign({ userId: user._id }, jwtSecret, { expiresIn: "30d" });
    return res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl || null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/google", async (req, res, next) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: "idToken requis" });

    const firebaseProjectConfigured = !!process.env.FIREBASE_PROJECT_ID;
    if (!firebaseProjectConfigured) {
      return res.status(503).json({ error: "Firebase non configuré" });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const email = decoded.email;
    const name = decoded.name || "User Google";
    const googleId = decoded.uid;
    const avatarUrl = decoded.picture || null;

    if (!email) return res.status(400).json({ error: "email manquant" });

    const existingUser = await User.findOne({ googleId });
    const isNewUser = !existingUser;

    const user = await User.findOneAndUpdate(
      { googleId },
      {
        $set: {
          name,
          email,
          googleId,
          avatarUrl,
        },
      },
      { upsert: true, new: true }
    );

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return res.status(500).json({ error: "JWT_SECRET manquant" });

    const token = jwt.sign({ userId: user._id }, jwtSecret, { expiresIn: "30d" });
    return res.json({
      token,
      isNewUser,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl || null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

