const express = require("express");
const requireAuth = require("../middlewares/auth");
const upload = require("../middlewares/upload");
const { uploadAudio } = require("../middlewares/upload");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const { sendNotification } = require("../utils/notifications");

const router = express.Router();

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.userId;

    const conversations = await Conversation.find({ participants: userId })
      .populate("participants", "_id name avatarUrl")
      .sort({ lastActivity: -1 });

    const result = conversations.map((conv) => {
      const participantDtos = conv.participants.map((p) => ({
        _id: p._id.toString(),
        name: p.name,
        avatarUrl: p.avatarUrl || "",
      }));

      const unreadCount = (conv.messages || []).filter((m) => {
        const senderDiffers = String(m.senderId) !== String(userId);
        return senderDiffers && m.read === false;
      }).length;

      return {
        _id: conv._id.toString(),
        participants: participantDtos,
        lastMessage: conv.lastMessage || "",
        lastActivity: conv.lastActivity ? conv.lastActivity.getTime() : 0,
        unreadCount,
      };
    });

    return res.json({ conversations: result });
  } catch (err) {
    return next(err);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const userId = req.userId;
    const conversationId = req.params.id;

    const conv = await Conversation.findById(conversationId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });

    const isMember = conv.participants.some((p) => String(p) === String(userId));
    if (!isMember) return res.status(403).json({ error: "Forbidden" });

    const messages = (conv.messages || []).map((m) => ({
      _id: m._id.toString(),
      senderId: m.senderId.toString(),
      content: m.content,
      sentAt: m.sentAt ? m.sentAt.getTime() : 0,
      type: m.type || "text",
      duration: m.duration || 0,
    }));

    return res.json({ messages });
  } catch (err) {
    return next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.userId;
    const { targetId } = req.body || {};
    if (!targetId) return res.status(400).json({ error: "targetId requis" });

    let conv = await Conversation.findOne({
      participants: { $all: [userId, targetId] },
    });

    if (conv) {
      return res.json({ conversationId: conv._id.toString() });
    }

    conv = await Conversation.create({
      participants: [userId, targetId],
      messages: [],
      lastMessage: "",
      lastActivity: new Date(),
    });

    return res.json({ conversationId: conv._id.toString() });
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/messages", requireAuth, async (req, res, next) => {
  try {
    const userId = req.userId;
    const conversationId = req.params.id;
    const { content } = req.body || {};
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: "content requis" });
    }

    const conv = await Conversation.findById(conversationId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });

    const isMember = conv.participants.some((p) => String(p) === String(userId));
    if (!isMember) return res.status(403).json({ error: "Forbidden" });

    const message = {
      senderId: userId,
      content: String(content),
      sentAt: new Date(),
      read: false,
    };

    conv.messages.push(message);
    conv.lastMessage = String(content);
    conv.lastActivity = message.sentAt;

    await conv.save();

    const populatedParticipants = await User.find({ _id: { $in: conv.participants } }).select("_id name avatarUrl");
    const senderProfile = populatedParticipants.find((u) => String(u._id) === String(userId));

    const msg = conv.messages[conv.messages.length - 1];
    const payload = {
      conversationId: conversationId,
      _id: msg._id.toString(),
      senderId: String(userId),
      content: msg.content,
      sentAt: msg.sentAt ? msg.sentAt.getTime() : Date.now(),
    };

    const socketEmitter = req.app.get("socketEmitter");
    // req.userId vient du JWT (équivalent req.user._id si le middleware attachait le document User)
    const senderStr = String(userId);

    for (const participantId of conv.participants) {
      if (String(participantId) === senderStr) continue;

      if (socketEmitter?.emitToUser) {
        socketEmitter.emitToUser(String(participantId), "message", payload);
      }

      await sendNotification(String(participantId), {
        title: senderProfile?.name || "Le Match",
        body: String(content).substring(0, 200),
        data: {
          type: "message",
          conversationId: conv._id.toString(),
          senderId: senderStr,
        },
      });
    }

    // Réponse
    return res.json({
      message: {
        _id: msg._id.toString(),
        senderId: msg.senderId.toString(),
        content: msg.content,
        sentAt: msg.sentAt ? msg.sentAt.getTime() : Date.now(),
        type: "text",
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/upload-image", requireAuth, upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Image requise" });
    }

    const userId = req.userId;
    const conversationId = req.params.id;

    const conv = await Conversation.findById(conversationId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });

    const isMember = conv.participants.some((p) => String(p) === String(userId));
    if (!isMember) return res.status(403).json({ error: "Forbidden" });

    const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const imageUrl = `${base}/uploads/messages/${req.file.filename}`;

    const msg = {
      senderId: userId,
      content: imageUrl,
      sentAt: new Date(),
      read: false,
      type: "image",
    };

    conv.messages.push(msg);
    conv.lastMessage = "📷 Photo";
    conv.lastActivity = msg.sentAt;
    await conv.save();

    const populatedParticipants = await User.find({ _id: { $in: conv.participants } }).select("_id name avatarUrl");
    const senderProfile = populatedParticipants.find((u) => String(u._id) === String(userId));

    const savedMsg = conv.messages[conv.messages.length - 1];
    const payload = {
      conversationId: conversationId,
      _id: savedMsg._id.toString(),
      senderId: String(userId),
      content: imageUrl,
      sentAt: savedMsg.sentAt ? savedMsg.sentAt.getTime() : Date.now(),
      type: "image",
    };

    const socketEmitter = req.app.get("socketEmitter");
    const senderStr = String(userId);

    for (const participantId of conv.participants) {
      if (String(participantId) === senderStr) continue;

      if (socketEmitter?.emitToUser) {
        socketEmitter.emitToUser(String(participantId), "message", payload);
      }

      await sendNotification(String(participantId), {
        title: senderProfile?.name || "Le Match",
        body: "📷 Photo",
        data: {
          type: "message",
          conversationId: conv._id.toString(),
          senderId: senderStr,
        },
      });
    }

    return res.json({
      message: {
        _id: savedMsg._id.toString(),
        senderId: savedMsg.senderId.toString(),
        content: imageUrl,
        sentAt: savedMsg.sentAt ? savedMsg.sentAt.getTime() : Date.now(),
        type: "image",
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/upload-audio", requireAuth, uploadAudio.single("audio"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Audio requis" });
    }

    const userId = req.userId;
    const conversationId = req.params.id;

    const conv = await Conversation.findById(conversationId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });

    const isMember = conv.participants.some((p) => String(p) === String(userId));
    if (!isMember) return res.status(403).json({ error: "Forbidden" });

    const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const audioUrl = `${base}/uploads/audio/${req.file.filename}`;
    const duration = parseInt(req.body.duration, 10) || 0;

    const msg = {
      senderId: userId,
      content: audioUrl,
      sentAt: new Date(),
      read: false,
      type: "audio",
      duration,
    };

    conv.messages.push(msg);
    conv.lastMessage = "🎤 Message vocal";
    conv.lastActivity = msg.sentAt;
    await conv.save();

    const populatedParticipants = await User.find({ _id: { $in: conv.participants } }).select("_id name avatarUrl");
    const senderProfile = populatedParticipants.find((u) => String(u._id) === String(userId));

    const savedMsg = conv.messages[conv.messages.length - 1];
    const payload = {
      conversationId,
      _id: savedMsg._id.toString(),
      senderId: String(userId),
      content: audioUrl,
      sentAt: savedMsg.sentAt ? savedMsg.sentAt.getTime() : Date.now(),
      type: "audio",
      duration,
    };

    const socketEmitter = req.app.get("socketEmitter");
    const senderStr = String(userId);

    for (const participantId of conv.participants) {
      if (String(participantId) === senderStr) continue;

      if (socketEmitter?.emitToUser) {
        socketEmitter.emitToUser(String(participantId), "message", payload);
      }

      await sendNotification(String(participantId), {
        title: senderProfile?.name || "Le Match",
        body: "🎤 Message vocal",
        data: {
          type: "message",
          conversationId: conv._id.toString(),
          senderId: senderStr,
        },
      });
    }

    return res.json({
      message: {
        _id: savedMsg._id.toString(),
        senderId: savedMsg.senderId.toString(),
        content: audioUrl,
        sentAt: savedMsg.sentAt ? savedMsg.sentAt.getTime() : Date.now(),
        type: "audio",
        duration,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

