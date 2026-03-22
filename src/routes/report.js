const express = require("express");
const router = express.Router();
const Report = require("../models/Report");
const requireAuth = require("../middlewares/auth");

router.post("/", requireAuth, async (req, res) => {
  try {
    const { reportedUser, conversationId, reason } = req.body;
    if (!reportedUser || !reason)
      return res.status(400).json({ message: "reportedUser et reason sont requis" });

    const report = await Report.create({
      reportedBy: req.userId,
      reportedUser,
      conversationId: conversationId ?? null,
      reason,
    });
    res.status(201).json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
