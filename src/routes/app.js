const express = require("express");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const AppVersion = require("../models/AppVersion");

const APP_DIR = path.join(process.cwd(), "uploads", "app");
const LATEST_FILENAME = "app-latest.apk";

// GET /api/app/info — public
router.get("/info", async (req, res) => {
  try {
    const latest = await AppVersion.findOne().sort({ createdAt: -1 }).lean();
    if (!latest) {
      return res.json({ hasApp: false });
    }
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    res.json({
      hasApp: true,
      version: latest.version,
      uploadedAt: latest.createdAt,
      downloadUrl: `${baseUrl}/uploads/app/${LATEST_FILENAME}`,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/app/download — redirection vers le fichier
router.get("/download", async (req, res) => {
  try {
    const latest = await AppVersion.findOne().sort({ createdAt: -1 });
    const filePath = path.join(APP_DIR, LATEST_FILENAME);
    if (!latest || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Application non disponible" });
    }
    const baseUrl = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
    res.redirect(`${baseUrl}/uploads/app/${LATEST_FILENAME}`);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
