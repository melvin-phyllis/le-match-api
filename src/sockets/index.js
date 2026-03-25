const jwt = require("jsonwebtoken");
const Conversation = require("../models/Conversation");
const { connectedUsers, waitingQueue, activeSessions, sessionLikes } = require("./state");
const logger = require("../utils/logger");

/** ICE (STUN/TURN) envoyé aux apps Android au connect — évite de recompiler l’APK pour ajouter un TURN. */
function buildIceServersPayload() {
  const raw = process.env.ICE_SERVERS_JSON;
  if (!raw || !String(raw).trim()) {
    return { iceServers: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { iceServers: parsed };
    }
    if (parsed && Array.isArray(parsed.iceServers)) {
      return { iceServers: parsed.iceServers };
    }
    return { iceServers: [] };
  } catch (e) {
    logger.warn(`[RTC] ICE_SERVERS_JSON invalide: ${e.message}`);
    return { iceServers: [] };
  }
}

/*
FLUX DÉCOUVERTE — Matching FIFO (style Omegle) :

1. User A ouvre Découverte → queue:join → personne en attente → queue:waiting

2. User B ouvre Découverte → queue:join → A attend → match immédiat (FIFO)
   → match:found aux DEUX, pas de filtre hobbies/âge/ville
   → A crée l'offer WebRTC (isCaller: true), B attend

3. Connexion vidéo :
   → A crée l'offer SDP → l'envoie via rtc:offer au backend
   → Backend relaie à B
   → B crée l'answer → l'envoie via rtc:answer
   → Échange ICE candidates des deux côtés
   → Connexion P2P établie → vidéo bidirectionnelle

4. Pendant la session :
   → Like : match:like → si les deux ont liké → match:mutual → conversation créée
   → Dislike : match:skip → match:ended aux deux → requeue automatique
   → Fermer app : disconnect détecté → match:ended au partenaire → partenaire requeue

IMPORTANT : Les deux users doivent être sur des COMPTES DIFFÉRENTS
pour que le matching fonctionne. Même compte = même userId = pas de match.
*/

module.exports = function initSockets(io) {
  io.use((socket, next) => {
    try {
      const token =
        socket?.handshake?.auth?.token ||
        socket?.handshake?.headers?.authorization?.replace(/^Bearer\s+/i, "");

      if (!token) {
        logger.warn(`[Socket] AUTH REFUSÉ: pas de token`);
        return next(new Error("auth"));
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) return next(new Error("JWT_SECRET manquant"));

      logger.info(`[Socket] AUTH tentative, token présent: ${!!token}`);
      const decoded = jwt.verify(token, secret);
      socket.userId = decoded.userId;
      logger.info(`[Socket] AUTH OK userId=${socket.userId}`);
      return next();
    } catch (err) {
      logger.warn(`[Socket] AUTH REFUSÉ: token invalide (${err.message})`);
      return next(new Error("auth"));
    }
  });

  io.on("connect_error", (err) => {
    logger.error(`[Socket] connect_error: ${err.message}`);
  });

  io.on("connection", (socket) => {
    logger.info(`[Socket] CONNECT userId=${socket.userId} socketId=${socket.id}`);
    if (socket.userId) connectedUsers.set(String(socket.userId), socket.id);
    logger.info(`[Socket] users connectés: ${connectedUsers.size}`);

    const icePayload = buildIceServersPayload();
    if (icePayload.iceServers.length > 0) {
      socket.emit("rtc:iceServers", icePayload);
      logger.info(
        `[RTC] rtc:iceServers → userId=${socket.userId} (${icePayload.iceServers.length} entrée(s))`,
      );
    }

    // Notifier tous les autres users connectés que ce user vient d'arriver.
    // Utile pour relancer l'offre quand un peer arrive après le premier signaling.
    if (socket.userId) {
      const currentUserId = String(socket.userId);
      connectedUsers.forEach((socketId, userId) => {
        if (userId !== currentUserId) {
          io.to(socketId).emit("user:connected", { userId: currentUserId });
        }
      });
    }

    const currentUserId = socket.userId ? String(socket.userId) : null;

    const QUEUE_TIMEOUT_MS = 60 * 1000; // 1 minute

    function addToQueueWithTimeout(userId, socketId) {
      const entry = { userId, socketId };
      entry.timeoutId = setTimeout(() => {
        const idx = waitingQueue.findIndex((u) => u.userId === userId);
        if (idx !== -1) {
          waitingQueue.splice(idx, 1);
          io.to(socketId).emit("queue:timeout");
          logger.info(`[Queue] timeout: userId=${userId} après 1 min sans partenaire`);
        }
      }, QUEUE_TIMEOUT_MS);
      return entry;
    }

    function removeFromQueueAndClearTimeout(userId) {
      const idx = waitingQueue.findIndex((u) => u.userId === userId);
      if (idx !== -1) {
        const entry = waitingQueue[idx];
        if (entry.timeoutId) clearTimeout(entry.timeoutId);
        waitingQueue.splice(idx, 1);
      }
    }

    // Queue FIFO : dès qu'une personne attend, le prochain qui rejoint matche immédiatement.
    socket.on("queue:join", async () => {
      if (!currentUserId) return;

      // Vérifier si déjà en session active
      for (const [sessionId, session] of activeSessions.entries()) {
        if (session.user1Id === currentUserId || session.user2Id === currentUserId) {
          logger.info(
            `[Queue] userId=${currentUserId} déjà en session ${sessionId}, queue:join ignoré`,
          );
          return;
        }
      }

      removeFromQueueAndClearTimeout(currentUserId);

      if (waitingQueue.length === 0) {
        waitingQueue.push(addToQueueWithTimeout(currentUserId, socket.id));
        socket.emit("queue:waiting");
        logger.info(`[Queue] join: userId=${currentUserId}, queue size=1, attente (timeout 1min)`);
        return;
      }

      // Premier en attente = match immédiat (FIFO)
      const partner = waitingQueue.shift();
      if (partner.timeoutId) clearTimeout(partner.timeoutId);

      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 13)}`;
      activeSessions.set(sessionId, {
        user1Id: partner.userId,
        user2Id: currentUserId,
      });

      logger.info(`[Queue] match:found (FIFO) -> ${partner.userId} ↔ ${currentUserId}`);

      setTimeout(() => {
        const socket1 = connectedUsers.get(partner.userId);
        const socket2 = connectedUsers.get(currentUserId);

        if (!socket1 || !socket2) {
          activeSessions.delete(sessionId);
          if (socket1) waitingQueue.unshift(addToQueueWithTimeout(partner.userId, partner.socketId));
          if (socket2) waitingQueue.push(addToQueueWithTimeout(currentUserId, socket.id));
          return;
        }

        activeSessions.set(sessionId, {
          user1Id: partner.userId,
          user2Id: currentUserId,
          user1SocketId: socket1,
          user2SocketId: socket2,
          startedAt: new Date(),
        });

        io.to(socket1).emit("match:found", {
          partnerId: currentUserId,
          sessionId,
          isCaller: true,
          compatibilityScore: 0,
        });
        io.to(socket2).emit("match:found", {
          partnerId: partner.userId,
          sessionId,
          isCaller: false,
          compatibilityScore: 0,
        });
      }, 500);
    });

    socket.on("queue:leave", () => {
      if (!currentUserId) return;
      removeFromQueueAndClearTimeout(currentUserId);
    });

    // Dislike => end the call and re-queue.
    socket.on("match:skip", ({ sessionId }) => {
      if (!currentUserId) return;
      if (!sessionId) return;

      const sid = String(sessionId);
      sessionLikes.delete(sid);
      const session = activeSessions.get(sid);
      if (!session) return;

      activeSessions.delete(sid);

      const partnerId = session.user1Id === currentUserId ? session.user2Id : session.user1Id;
      let partnerSocketId = connectedUsers.get(partnerId);
      if (!partnerSocketId && session.user1SocketId != null && session.user2SocketId != null) {
        partnerSocketId = session.user1Id === partnerId ? session.user1SocketId : session.user2SocketId;
      }

      if (partnerSocketId) {
        io.to(partnerSocketId).emit("match:ended", { sessionId: sid });
      }
      socket.emit("match:ended", { sessionId: sid });
    });

    socket.on("match:like", ({ sessionId }) => {
      if (!currentUserId) return;
      if (!sessionId) return;

      const sid = String(sessionId);
      const session = activeSessions.get(sid);
      if (!session) return;

      if (!sessionLikes.has(sid)) {
        sessionLikes.set(sid, new Set());
      }
      const likes = sessionLikes.get(sid);
      likes.add(currentUserId);

      const partnerId = session.user1Id === currentUserId ? session.user2Id : session.user1Id;
      let partnerSocketId = connectedUsers.get(partnerId);
      if (!partnerSocketId && session.user1SocketId != null && session.user2SocketId != null) {
        partnerSocketId = session.user1Id === partnerId ? session.user1SocketId : session.user2SocketId;
      }

      if (likes.size >= 2) {
        sessionLikes.delete(sid);
        activeSessions.delete(sid);

        socket.emit("match:mutual", { sessionId: sid, partnerId });
        if (partnerSocketId) {
          io.to(partnerSocketId).emit("match:mutual", { sessionId: sid, partnerId: currentUserId });
        }
      } else {
        if (partnerSocketId) {
          io.to(partnerSocketId).emit("match:liked_by_partner", { sessionId: sid });
        }
        socket.emit("match:like_sent", { sessionId: sid });
      }
    });

    socket.on("disconnect", () => {
      const disconnectedUserId = currentUserId ? String(currentUserId) : null;
      logger.info(
        `[Socket] DISCONNECT userId=${socket.userId} reason=${socket?.reason}`
      );

      // Remove from waiting queue + clear timeout
      if (disconnectedUserId) {
        removeFromQueueAndClearTimeout(disconnectedUserId);
      }

      // Notify partner if user was in an active session
      if (disconnectedUserId) {
        for (const [sid, session] of activeSessions.entries()) {
          if (session.user1Id === disconnectedUserId || session.user2Id === disconnectedUserId) {
            sessionLikes.delete(sid);
            activeSessions.delete(sid);

            const partnerId =
              session.user1Id === disconnectedUserId ? session.user2Id : session.user1Id;
            let partnerSocketId = connectedUsers.get(partnerId);
            if (!partnerSocketId && session.user1SocketId != null && session.user2SocketId != null) {
              partnerSocketId = session.user1Id === partnerId ? session.user1SocketId : session.user2SocketId;
            }

            if (partnerSocketId) {
              io.to(partnerSocketId).emit("match:ended", { sessionId: sid });
              logger.info(
                `[Session] ${disconnectedUserId} déconnecté, match:ended → ${partnerId}`
              );
            }
            break;
          }
        }
      }

      if (disconnectedUserId) {
        connectedUsers.delete(disconnectedUserId);
      }

      logger.info(`[Socket] users connectés: ${connectedUsers.size}`);
    });

    // WebRTC signaling
    socket.on("rtc:offer", (data) => {
      const to = data?.to;
      const offer = data?.offer;
      logger.info(`[RTC] offer DE=${socket.userId} VERS=${to}`);
      if (!to) {
        logger.error(`[RTC] ERREUR: champ 'to' manquant dans rtc:offer. keys=${data ? Object.keys(data) : "null"}`);
        return;
      }
      const targetSocket = connectedUsers.get(String(to));
      logger.info(`[RTC] target socket trouvé: ${!!targetSocket} (id=${targetSocket})`);
      if (targetSocket) {
        io.to(targetSocket).emit("rtc:offer", { from: socket.userId, offer });
        logger.info(`[RTC] offer relayé vers socketId=${targetSocket}`);
      } else {
        logger.warn(`[RTC] WARN: userId=${to} pas dans connectedUsers`);
        logger.info(`[RTC] connectedUsers actuels:`, JSON.stringify([...connectedUsers.entries()]));
      }
    });

    socket.on("rtc:answer", (data) => {
      const to = data?.to;
      const answer = data?.answer;
      logger.info(`[RTC] answer DE=${socket.userId} VERS=${to}`);
      if (!to) {
        logger.error(`[RTC] ERREUR: champ 'to' manquant dans rtc:answer. keys=${data ? Object.keys(data) : "null"}`);
        return;
      }
      const targetSocket = connectedUsers.get(String(to));
      logger.info(`[RTC] target socket trouvé: ${!!targetSocket} (id=${targetSocket})`);
      if (targetSocket) {
        io.to(targetSocket).emit("rtc:answer", { from: socket.userId, answer });
        logger.info(`[RTC] answer relayé`);
      } else {
        logger.warn(`[RTC] WARN: userId=${to} pas dans connectedUsers`);
        logger.info(`[RTC] connectedUsers actuels:`, JSON.stringify([...connectedUsers.entries()]));
      }
    });

    socket.on("typing:start", async ({ convId }) => {
      if (!currentUserId || !convId) return;
      try {
        const conv = await Conversation.findById(convId).select("participants").lean();
        if (!conv || !conv.participants) return;
        const partnerId = conv.participants.find((p) => String(p) !== String(currentUserId));
        if (!partnerId) return;
        const partnerSocketId = connectedUsers.get(String(partnerId));
        if (partnerSocketId) {
          io.to(partnerSocketId).emit("typing:start", { userId: currentUserId, convId });
        }
      } catch (err) {
        logger.error("[Socket] typing:start error:", err);
      }
    });

    socket.on("typing:stop", async ({ convId }) => {
      if (!currentUserId || !convId) return;
      try {
        const conv = await Conversation.findById(convId).select("participants").lean();
        if (!conv || !conv.participants) return;
        const partnerId = conv.participants.find((p) => String(p) !== String(currentUserId));
        if (!partnerId) return;
        const partnerSocketId = connectedUsers.get(String(partnerId));
        if (partnerSocketId) {
          io.to(partnerSocketId).emit("typing:stop", { userId: currentUserId, convId });
        }
      } catch (err) {
        logger.error("[Socket] typing:stop error:", err);
      }
    });

    socket.on("rtc:ice", (data) => {
      const to = data?.to;
      const candidate = data?.candidate;
      logger.info(`[RTC] ice DE=${socket.userId} VERS=${to}`);
      if (!to) {
        logger.error(`[RTC] ERREUR: champ 'to' manquant dans rtc:ice. keys=${data ? Object.keys(data) : "null"}`);
        return;
      }
      const targetSocket = connectedUsers.get(String(to));
      if (targetSocket) {
        io.to(targetSocket).emit("rtc:ice", { from: socket.userId, candidate });
      } else {
        logger.warn(`[RTC] WARN ice: userId=${to} pas connecté`);
      }
    });

    socket.on("error", (err) => {
      logger.error(`[Socket] ERROR userId=${socket.userId}:`, err);
    });
  });

  return {
    emitToUser: (userId, event, data) => {
      const socketId = connectedUsers.get(String(userId));
      if (socketId) io.to(socketId).emit(event, data);
    },
    emitToAll: (event, data) => io.emit(event, data),
  };
};

