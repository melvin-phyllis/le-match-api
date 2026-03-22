const express = require("express");
const User = require("../models/User");
const requireAuth = require("../middlewares/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.max(parseInt(req.query.limit || "10", 10), 1);
    const lat = req.query.lat != null ? Number(req.query.lat) : null;
    const lng = req.query.lng != null ? Number(req.query.lng) : null;

    const baseQuery = {
      isLive: true,
      _id: { $ne: req.userId },
    };

    if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      baseQuery.location = {
        $near: {
          $geometry: { type: "Point", coordinates: [lng, lat] },
          $maxDistance: 50000,
        },
      };
    }

    const users = await User.find(baseQuery)
      .select("_id name age city avatarUrl isLive")
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      users: users.map((u) => ({
        _id: u._id,
        name: u.name,
        age: u.age,
        city: u.city,
        avatarUrl: u.avatarUrl || "",
        isLive: u.isLive,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

