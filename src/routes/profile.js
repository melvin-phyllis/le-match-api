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
    const b = req.body || {};
    const updates = {};

    if (b.name !== undefined && b.name !== null) updates.name = String(b.name);
    if (b.age !== undefined && b.age !== null && b.age !== "") {
      const n = Number(b.age);
      if (!Number.isNaN(n)) updates.age = n;
    }
    if (b.bio !== undefined) updates.bio = b.bio == null ? "" : String(b.bio);
    if (b.city !== undefined) updates.city = b.city == null ? "" : String(b.city);
    if (b.avatarUrl !== undefined && b.avatarUrl !== null) updates.avatarUrl = String(b.avatarUrl);
    if (b.language !== undefined && b.language !== null) updates.language = String(b.language);
    if (b.ageMin !== undefined && b.ageMin !== null) {
      const n = Number(b.ageMin);
      if (!Number.isNaN(n)) updates.ageMin = n;
    }
    if (b.ageMax !== undefined && b.ageMax !== null) {
      const n = Number(b.ageMax);
      if (!Number.isNaN(n)) updates.ageMax = n;
    }
    // Toujours traiter si la clé est présente (tableau JSON explicite côté Android).
    if (Object.prototype.hasOwnProperty.call(b, "hobbies")) {
      updates.hobbies = Array.isArray(b.hobbies) ? b.hobbies.map((x) => String(x)) : [];
    }

    const user = await User.findByIdAndUpdate(req.userId, updates, { new: true, runValidators: true }).select(
      "-passwordHash",
    );
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

