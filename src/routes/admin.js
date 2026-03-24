const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const router = express.Router();
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Report = require("../models/Report");
const AppVersion = require("../models/AppVersion");
const requireAdmin = require("../middlewares/requireAdmin");
const { activeSessions, connectedUsers } = require("../sockets/state");

const APP_DIR = path.join(process.cwd(), "uploads", "app");
const LATEST_FILENAME = "app-latest.apk";

if (!fs.existsSync(APP_DIR)) {
  fs.mkdirSync(APP_DIR, { recursive: true });
}

const appStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, APP_DIR),
  filename: (req, file, cb) => cb(null, LATEST_FILENAME),
});
const uploadApp = multer({
  storage: appStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".apk")) {
      return cb(new Error("Seuls les fichiers .apk sont autorisés"));
    }
    cb(null, true);
  },
});

const TODAY_START = new Date();
TODAY_START.setHours(0, 0, 0, 0);

// POST /admin/login — pas de auth
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email et mot de passe requis" });

    const user = await User.findOne({ email });
    if (!user)
      return res.status(401).json({ message: "Identifiants invalides" });
    if (!user.isAdmin)
      return res.status(403).json({ message: "Accès refusé" });

    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok)
      return res.status(401).json({ message: "Identifiants invalides" });

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, name: user.name });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /admin/stats
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const pendingReports = await Report.countDocuments({ status: "En attente" });

    const todayConvs = await Conversation.find({
      createdAt: { $gte: TODAY_START },
    }).lean();
    const matchesToday = todayConvs.length;

    const allConvs = await Conversation.find({
      "messages.sentAt": { $gte: TODAY_START },
    }).select("messages").lean();
    const messagesToday = allConvs.reduce((acc, c) => {
      if (!c.messages) return acc;
      return acc + c.messages.filter((m) => {
        const d = m.sentAt ? new Date(m.sentAt) : null;
        return d && d >= TODAY_START;
      }).length;
    }, 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const signupsAgg = await User.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    const recentUsers = await User.find()
      .select("name email createdAt")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const recentReports = await Report.find()
      .populate("reportedBy", "name")
      .populate("reportedUser", "name")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const recentActivity = [];
    for (const u of recentUsers) {
      recentActivity.push({
        type: "Nouvel utilisateur",
        detail: u.name,
        heure: u.createdAt,
        statut: "Complété",
      });
    }
    for (const r of recentReports) {
      recentActivity.push({
        type: "Signalement reçu",
        detail: `${r.reportedBy?.name || "?"} → ${r.reportedUser?.name || "?"}`,
        heure: r.createdAt,
        statut: r.status,
      });
    }
    recentActivity.sort((a, b) => new Date(b.heure) - new Date(a.heure));
    const activity = recentActivity.slice(0, 10);

    res.json({
      totalUsers,
      matchesToday,
      messagesToday,
      pendingReports,
      sessionsLiveToday: activeSessions.size,
      signupsByDay: signupsAgg,
      recentActivity: activity.map((a) => ({
        ...a,
        heure: formatRelative(a.heure),
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

function formatRelative(d) {
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  return `Il y a ${h} h`;
}

// GET /admin/users
router.get("/users", requireAdmin, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 15;
    const skip = (page - 1) * limit;

    const filter = {};
    if (search) {
      filter.$or = [
        { name: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
        { city: new RegExp(search, "i") },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter).select("name email city age avatarUrl hobbies bio isBanned createdAt").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    const convCounts = await Promise.all(
      users.map(async (u) => {
        const count = await Conversation.countDocuments({ participants: u._id });
        return count;
      })
    );

    const result = users.map((u, i) => ({
      _id: u._id.toString(),
      name: u.name,
      email: u.email,
      city: u.city || "",
      age: u.age || 0,
      avatarUrl: u.avatarUrl,
      hobbies: u.hobbies || [],
      bio: u.bio || "",
      isBanned: !!u.isBanned,
      createdAt: u.createdAt,
      totalMatches: convCounts[i] || 0,
    }));

    res.json({ users: result, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /admin/users/export — tous les utilisateurs pour export Excel
router.get("/users/export", requireAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .select("name email city age avatarUrl hobbies bio isBanned createdAt gender lookingFor language")
      .sort({ createdAt: -1 })
      .lean();

    const convCounts = await Promise.all(
      users.map((u) => Conversation.countDocuments({ participants: u._id }))
    );

    const result = users.map((u, i) => ({
      _id: u._id.toString(),
      name: u.name,
      email: u.email,
      city: u.city || "",
      age: u.age ?? "",
      avatarUrl: u.avatarUrl || "",
      hobbies: Array.isArray(u.hobbies) ? u.hobbies.join(", ") : "",
      bio: u.bio || "",
      statut: u.isBanned ? "Banni" : "Actif",
      genre: u.gender || "",
      recherche: u.lookingFor || "",
      langue: u.language || "",
      dateInscription: u.createdAt,
      totalMatches: convCounts[i] || 0,
    }));

    res.json({ users: result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /admin/users/:id
router.get("/users/:id", requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-passwordHash").lean();
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });

    const totalMatches = await Conversation.countDocuments({ participants: user._id });
    let totalMessages = 0;
    const convs = await Conversation.find({ participants: user._id }).select("messages").lean();
    for (const c of convs) {
      totalMessages += (c.messages || []).length;
    }

    res.json({
      ...user,
      _id: user._id.toString(),
      totalMatches,
      totalMessages,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /admin/users/:id/ban — toggle ban
router.patch("/users/:id/ban", requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
    user.isBanned = !user.isBanned;
    await user.save();
    res.json({ isBanned: user.isBanned });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /admin/users/:id
router.delete("/users/:id", requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /admin/reports
router.get("/reports", requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || "";
    const filter = status ? { status } : {};
    const reports = await Report.find(filter)
      .populate("reportedBy", "name email")
      .populate("reportedUser", "name email")
      .populate({
        path: "conversationId",
        select: "messages",
        populate: { path: "messages.senderId", select: "name" },
      })
      .sort({ createdAt: -1 })
      .lean();

    const result = reports.map((r) => ({
      _id: r._id.toString(),
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      reportedBy: r.reportedBy ? { _id: r.reportedBy._id.toString(), name: r.reportedBy.name, email: r.reportedBy.email } : null,
      reportedUser: r.reportedUser ? { _id: r.reportedUser._id.toString(), name: r.reportedUser.name, email: r.reportedUser.email } : null,
      conversationId: r.conversationId
        ? {
            _id: r.conversationId._id.toString(),
            messages: (r.conversationId.messages || []).map((m) => ({
              senderId: m.senderId?._id?.toString() || m.senderId,
              senderName: m.senderId?.name,
              content: m.content,
              type: m.type || "text",
              createdAt: m.sentAt || m.createdAt,
            })),
          }
        : null,
    }));

    res.json({ reports: result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /admin/reports/:id
router.patch("/reports/:id", requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["En attente", "Résolu", "Ignoré"].includes(status))
      return res.status(400).json({ message: "Statut invalide" });

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    );
    if (!report) return res.status(404).json({ message: "Signalement introuvable" });
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /admin/sessions
router.get("/sessions", requireAdmin, async (req, res) => {
  try {
    const sessions = [];
    for (const [sessionId, sess] of activeSessions) {
      if (sess.user1SocketId && sess.user2SocketId) {
        sessions.push({
          sessionId,
          user1Id: sess.user1Id,
          user2Id: sess.user2Id,
          score: sess.score || 0,
          startedAt: sess.startedAt || new Date(),
        });
      }
    }

    const sessionsWithNames = await Promise.all(
      sessions.map(async (s) => {
        const [u1, u2] = await Promise.all([
          User.findById(s.user1Id).select("name").lean(),
          User.findById(s.user2Id).select("name").lean(),
        ]);
        return {
          ...s,
          user1Name: u1?.name || "?",
          user2Name: u2?.name || "?",
        };
      })
    );

    res.json({
      connectedUsersCount: connectedUsers.size,
      activeSessions: sessionsWithNames,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /admin/app
router.get("/app", requireAdmin, async (req, res) => {
  try {
    const latest = await AppVersion.findOne()
      .sort({ createdAt: -1 })
      .populate("uploadedBy", "name")
      .lean();
    const manualPath = path.join(APP_DIR, LATEST_FILENAME);
    const onDisk = fs.existsSync(manualPath);
    if (!latest && !onDisk) return res.json({ hasApp: false });
    const stat = onDisk ? fs.statSync(manualPath) : null;
    const manualVersion = process.env.APP_MANUAL_VERSION || "local";
    res.json({
      hasApp: true,
      version: latest?.version ?? manualVersion,
      filename: latest?.filename ?? LATEST_FILENAME,
      uploadedAt: latest?.createdAt ?? stat?.mtime,
      uploadedBy: latest?.uploadedBy?.name ?? (onDisk && !latest ? "(fichier manuel)" : undefined),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /admin/app/upload
router.post("/app/upload", requireAdmin, uploadApp.single("apk"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });
    const version = req.body.version || `1.0.${Date.now()}`;
    await AppVersion.create({
      version,
      filename: req.file.originalname,
      filePath: req.file.path,
      uploadedBy: req.userId,
    });
    res.json({ success: true, version, message: "Application mise à jour" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
