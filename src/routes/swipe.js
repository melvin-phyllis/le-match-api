const express = require("express");
const requireAuth = require("../middlewares/auth");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const { sendNotification } = require("../utils/notifications");

const router = express.Router();

// Map in-memory: `${userId}:${targetId}` => true
const likes = new Map();

function likeKey(userId, targetId) {
  return `${String(userId)}:${String(targetId)}`;
}

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { targetId, action } = req.body || {};
    if (!targetId || !action) {
      return res.status(400).json({ error: "targetId et action requis" });
    }

    if (action === "dislike") {
      return res.json({ matched: false });
    }

    if (action !== "like") {
      return res.status(400).json({ error: "action invalide" });
    }

    const userId = req.userId;
    const otherLikedYouKey = likeKey(targetId, userId);
    const hasMatch = likes.get(otherLikedYouKey) === true;

    // Si match : créer conversation + nettoyer likes
    if (hasMatch) {
      likes.delete(otherLikedYouKey);
      likes.delete(likeKey(userId, targetId));

      let conversation = await Conversation.findOne({
        participants: { $all: [userId, targetId] },
      });

      if (!conversation) {
        conversation = await Conversation.create({
          participants: [userId, targetId],
          messages: [],
          lastMessage: "",
          lastActivity: new Date(),
        });
      }

      const [targetUser, myUser] = await Promise.all([
        User.findById(targetId).select("name"),
        User.findById(userId).select("name"),
      ]);

      const matchedUserName = targetUser?.name || "Match";

      const socketEmitter = req.app.get("socketEmitter");
      if (socketEmitter?.emitToUser) {
        socketEmitter.emitToUser(String(userId), "match", {
          conversationId: String(conversation._id),
          matchedUserName,
        });
        socketEmitter.emitToUser(String(targetId), "match", {
          conversationId: String(conversation._id),
          matchedUserName: myUser?.name || "Match",
        });
      }

      await sendNotification(String(targetId), {
        title: "C'est un match ! 🎉",
        body: `Tu matches avec ${myUser?.name || "un profil"} !`,
        data: { type: "match", conversationId: String(conversation._id) },
      });

      return res.json({
        matched: true,
        conversationId: String(conversation._id),
        matchedUserName,
      });
    }

    // Sinon : stocker le like
    likes.set(likeKey(userId, targetId), true);
    return res.json({ matched: false });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

