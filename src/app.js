const path = require("path");
const http = require("http");
const express = require("express");
const logger = require("./utils/logger");
const helmet = require("helmet");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

require("dotenv").config();

const BASE_PATH = process.env.BASE_PATH || "";

// Init Firebase + MongoDB (même si .env manquant: app démarre mais certaines routes échoueront)
const connectDB = require("./config/db");
const seedAdmin = require("./config/seedAdmin");
require("./config/firebase");

const authRouter = require("./routes/auth");
const swipeRouter = require("./routes/swipe");
const conversationsRouter = require("./routes/conversations");
const profileRouter = require("./routes/profile");
const adminRouter = require("./routes/admin");
const reportRouter = require("./routes/report");
const appRouter = require("./routes/app");
const errorHandler = require("./middlewares/errorHandler");
const initSockets = require("./sockets");

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isDev = process.env.NODE_ENV !== "production";

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    // En dev : accepter toutes les origines (localhost, IP privées, WSL, VM...)
    if (isDev) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("CORS non autorisé"));
  },
  credentials: true,
};

async function start() {
  await connectDB();
  try {
    await seedAdmin();
  } catch (err) {
    logger.warn("[Seed] Erreur création admin:", err?.message);
  }

  const app = express();
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json());

  app.use(`${BASE_PATH}/uploads`, express.static("uploads"));

  // Logger toutes les requêtes HTTP (utile pour debug endpoints + payload).
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info(
        `[HTTP] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`
      );
    });
    next();
  });

  app.use(`${BASE_PATH}/auth`, authRouter);
  app.use(`${BASE_PATH}/admin`, adminRouter);
  app.use(`${BASE_PATH}/api/app`, appRouter);
  app.use(`${BASE_PATH}/api/swipe`, swipeRouter);
  app.use(`${BASE_PATH}/api/conversations`, conversationsRouter);
  app.use(`${BASE_PATH}/api/profile`, profileRouter);
  app.use(`${BASE_PATH}/api/report`, reportRouter);

  // Server HTTP + Socket.io
  const server = http.createServer(app);
  const io = new Server(server, {
    path: BASE_PATH ? `${BASE_PATH}/socket.io` : "/socket.io",
    cors: {
      origin: (origin, callback) => {
        // Apps mobiles : pas d'Origin ou Origin: null → autoriser
        if (!origin || origin === "null") return callback(null, true);
        if (allowedOrigins.length === 0) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error("CORS non autorisé"));
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  const socketEmitter = initSockets(io);
  app.set("socketEmitter", socketEmitter);

  // Logger brut pour voir si les requêtes Socket.io atteignent le serveur
  server.on("request", (req) => {
    if (req.url?.includes("socket.io")) {
      logger.info(`[RAW] Socket.io request: ${req.method} ${req.url}`);
    }
  });

  app.use(errorHandler);

  const port = process.env.PORT || 3000;
  const socketPath = BASE_PATH ? `${BASE_PATH}/socket.io` : "/socket.io";
  server.listen(port, () => {
    logger.info(`Serveur prêt sur le port ${port} | Socket.io: ${socketPath} | Logs: logs/app.log`);
  });
}

start().catch((err) => {
  const isDbError =
    err?.message?.includes("base de données") ||
    err?.message?.includes("MONGODB") ||
    err?.code === "MONGODB_URI_MISSING" ||
    err?.name === "MongooseServerSelectionError";

  if (isDbError) {
    console.error("\n❌ Impossible de se connecter à la base de données.");
    console.error("   Vérifiez MONGODB_URI dans .env et l'accès réseau (whitelist IP sur Atlas).\n");
  } else {
    console.error("Startup backend échoué:", err?.message || err);
  }
  try {
    const logger = require("./utils/logger");
    logger.error("Startup échoué:", err?.message || err);
  } catch (_) {}
  process.exit(1);
});

