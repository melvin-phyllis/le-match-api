const express = require("express");
const requireAuth = require("../middlewares/auth");
const User = require("../models/User");

const router = express.Router();

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select("-passwordHash");
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    return res.json({
      _id: user._id.toString(),
      name: user.name,
      age: user.age || 0,
      city: user.city || "",
      bio: user.bio || "",
      avatarUrl: user.avatarUrl || null,
      hobbies: user.hobbies || [],
      language: user.language || "fr",
      isLive: false,
      matchCount: 0,
      conversationCount: 0,
      score: 0,
    });
  } catch (err) {
    return next(err);
  }
});

router.put("/", requireAuth, async (req, res, next) => {
  try {
    const {
      name,
      age,
      bio,
      city,
      avatarUrl,
      hobbies,
      language,
      ageMin,
      ageMax,
    } = req.body || {};

    const updates = {
      name,
      age,
      bio,
      city,
      avatarUrl,
      hobbies,
      language,
      ageMin,
      ageMax,
    };
    Object.keys(updates).forEach((k) => {
      if (updates[k] === undefined || updates[k] === null) delete updates[k];
    });

    const user = await User.findByIdAndUpdate(req.userId, updates, { new: true }).select("-passwordHash");
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    return res.json({
      _id: user._id.toString(),
      name: user.name,
      age: user.age || 0,
      city: user.city || "",
      bio: user.bio || "",
      avatarUrl: user.avatarUrl || null,
      hobbies: user.hobbies || [],
      language: user.language || "fr",
      isLive: false,
      matchCount: 0,
      conversationCount: 0,
      score: 0,
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/fcm-token", requireAuth, async (req, res, next) => {
  try {
    const { fcmToken } = req.body || {};
    await User.findByIdAndUpdate(req.userId, { fcmToken });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// Fetch profile by id (used for Discover queue matches)
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-passwordHash");
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    return res.json({
      _id: user._id.toString(),
      name: user.name,
      age: user.age || 0,
      city: user.city || "",
      bio: user.bio || "",
      avatarUrl: user.avatarUrl || null,
      hobbies: user.hobbies || [],
      language: user.language || "fr",
      isLive: false,
      matchCount: 0,
      conversationCount: 0,
      score: 0,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

