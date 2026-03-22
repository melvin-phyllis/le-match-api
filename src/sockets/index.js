const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const { computeScore } = require("../utils/compatibility");
const { connectedUsers, waitingQueue, activeSessions, sessionLikes } = require("./state");

/*
FLUX DÉCOUVERTE — Comment ça fonctionne :

1. User A ouvre l'onglet Découverte → émet queue:join
   → Si personne en attente : reçoit queue:waiting → spinner "Recherche..."

2. User B ouvre l'onglet Découverte → émet queue:join
   → Le backend détecte que A attend → crée une session
   → Envoie match:found aux DEUX avec { partnerId, sessionId, isCaller }
   → A reçoit isCaller: true (il crée l'offer WebRTC)
   → B reçoit isCaller: false (il attend l'offer)

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
        console.warn(`[Socket] AUTH REFUSÉ: pas de token`);
        return next(new Error("auth"));
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) return next(new Error("JWT_SECRET manquant"));

      console.log(`[Socket] AUTH tentative, token présent: ${!!token}`);
      const decoded = jwt.verify(token, secret);
      socket.userId = decoded.userId;
      console.log(`[Socket] AUTH OK userId=${socket.userId}`);
      return next();
    } catch (err) {
      console.warn(`[Socket] AUTH REFUSÉ: token invalide (${err.message})`);
      return next(new Error("auth"));
    }
  });

  io.on("connect_error", (err) => {
    console.error(`[Socket] connect_error: ${err.message}`);
  });

  io.on("connection", (socket) => {
    console.log(`[Socket] CONNECT userId=${socket.userId} socketId=${socket.id}`);
    if (socket.userId) connectedUsers.set(String(socket.userId), socket.id);
    console.log(`[Socket] users connectés: ${connectedUsers.size}`);

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

    // Omegle/OmeTV-like queue avec matching par compatibilité
    socket.on("queue:join", async () => {
      if (!currentUserId) return;

      // Vérifier si déjà en session active
      for (const [sessionId, session] of activeSessions.entries()) {
        if (session.user1Id === currentUserId || session.user2Id === currentUserId) {
          console.log(
            `[Queue] userId=${currentUserId} déjà en session ${sessionId}, queue:join ignoré`,
          );
          return;
        }
      }

      const idx = waitingQueue.findIndex((u) => u.userId === currentUserId);
      if (idx !== -1) waitingQueue.splice(idx, 1);

      let userData;
      try {
        userData = await User.findById(currentUserId)
          .select("name age city hobbies language")
          .lean();
      } catch (err) {
        console.error(`[Queue] Erreur chargement profil userId=${currentUserId}:`, err);
        socket.emit("queue:waiting");
        return;
      }

      userData = userData || {};

      if (waitingQueue.length === 0) {
        waitingQueue.push({ userId: currentUserId, socketId: socket.id, userData });
        socket.emit("queue:waiting");
        console.log(`[Queue] join: userId=${currentUserId}, queue size=1, attente`);
        return;
      }

      // Trouver le meilleur match dans la queue
      let bestMatch = null;
      let bestScore = -1;

      for (const candidate of waitingQueue) {
        const score = computeScore(userData, candidate.userData || {});
        console.log(`[Compat] ${currentUserId} ↔ ${candidate.userId} score=${score}%`);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }

      const MIN_SCORE = 30;

      if (bestScore >= MIN_SCORE) {
        const matchIdx = waitingQueue.findIndex((u) => u.userId === bestMatch.userId);
        waitingQueue.splice(matchIdx, 1);

        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 13)}`;
        activeSessions.set(sessionId, {
          user1Id: bestMatch.userId,
          user2Id: currentUserId,
          score: bestScore,
        });

        console.log(
          `[Queue] match:found score=${bestScore}% -> ${bestMatch.userId} ↔ ${currentUserId}`,
        );

        setTimeout(() => {
          const socket1 = connectedUsers.get(bestMatch.userId);
          const socket2 = connectedUsers.get(currentUserId);

          if (!socket1 || !socket2) {
            activeSessions.delete(sessionId);
            if (socket1) waitingQueue.push(bestMatch);
            if (socket2) waitingQueue.push({ userId: currentUserId, socketId: socket.id, userData });
            return;
          }

          activeSessions.set(sessionId, {
            user1Id: bestMatch.userId,
            user2Id: currentUserId,
            user1SocketId: socket1,
            user2SocketId: socket2,
            score: bestScore,
            startedAt: new Date(),
          });

          io.to(socket1).emit("match:found", {
            partnerId: currentUserId,
            sessionId,
            isCaller: true,
            compatibilityScore: bestScore,
          });
          io.to(socket2).emit("match:found", {
            partnerId: bestMatch.userId,
            sessionId,
            isCaller: false,
            compatibilityScore: bestScore,
          });
        }, 500);
      } else {
        console.log(
          `[Queue] Meilleur score disponible=${bestScore}% < ${MIN_SCORE}%, mise en attente`,
        );
        waitingQueue.push({ userId: currentUserId, socketId: socket.id, userData });
        socket.emit("queue:waiting");
      }
    });

    socket.on("queue:leave", () => {
      if (!currentUserId) return;
      const idx = waitingQueue.findIndex((u) => u.userId === currentUserId);
      if (idx !== -1) waitingQueue.splice(idx, 1);
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
      const partnerSocketId =
        session.user1SocketId != null && session.user2SocketId != null
          ? (session.user1Id === partnerId ? session.user1SocketId : session.user2SocketId)
          : connectedUsers.get(partnerId);

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
      const partnerSocketId =
        session.user1SocketId != null && session.user2SocketId != null
          ? (session.user1Id === partnerId ? session.user1SocketId : session.user2SocketId)
          : connectedUsers.get(partnerId);

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
      console.log(
        `[Socket] DISCONNECT userId=${socket.userId} reason=${socket?.reason}`
      );

      // Remove from waiting queue
      if (disconnectedUserId) {
        const idx = waitingQueue.findIndex((u) => u.userId === disconnectedUserId);
        if (idx !== -1) waitingQueue.splice(idx, 1);
      }

      // Notify partner if user was in an active session
      if (disconnectedUserId) {
        for (const [sid, session] of activeSessions.entries()) {
          if (session.user1Id === disconnectedUserId || session.user2Id === disconnectedUserId) {
            sessionLikes.delete(sid);
            activeSessions.delete(sid);

            const partnerId =
              session.user1Id === disconnectedUserId ? session.user2Id : session.user1Id;
            const partnerSocketId =
              session.user1SocketId != null && session.user2SocketId != null
                ? (session.user1Id === partnerId ? session.user1SocketId : session.user2SocketId)
                : connectedUsers.get(partnerId);

            if (partnerSocketId) {
              io.to(partnerSocketId).emit("match:ended", { sessionId: sid });
              console.log(
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

      console.log(`[Socket] users connectés: ${connectedUsers.size}`);
    });

    // WebRTC signaling
    socket.on("rtc:offer", (data) => {
      const to = data?.to;
      const offer = data?.offer;
      console.log(`[RTC] offer DE=${socket.userId} VERS=${to}`);
      if (!to) {
        console.error(`[RTC] ERREUR: champ 'to' manquant dans rtc:offer. keys=${data ? Object.keys(data) : "null"}`);
        return;
      }
      const targetSocket = connectedUsers.get(String(to));
      console.log(`[RTC] target socket trouvé: ${!!targetSocket} (id=${targetSocket})`);
      if (targetSocket) {
        io.to(targetSocket).emit("rtc:offer", { from: socket.userId, offer });
        console.log(`[RTC] offer relayé vers socketId=${targetSocket}`);
      } else {
        console.warn(`[RTC] WARN: userId=${to} pas dans connectedUsers`);
        console.log(`[RTC] connectedUsers actuels:`, JSON.stringify([...connectedUsers.entries()]));
      }
    });

    socket.on("rtc:answer", (data) => {
      const to = data?.to;
      const answer = data?.answer;
      console.log(`[RTC] answer DE=${socket.userId} VERS=${to}`);
      if (!to) {
        console.error(`[RTC] ERREUR: champ 'to' manquant dans rtc:answer. keys=${data ? Object.keys(data) : "null"}`);
        return;
      }
      const targetSocket = connectedUsers.get(String(to));
      console.log(`[RTC] target socket trouvé: ${!!targetSocket} (id=${targetSocket})`);
      if (targetSocket) {
        io.to(targetSocket).emit("rtc:answer", { from: socket.userId, answer });
        console.log(`[RTC] answer relayé`);
      } else {
        console.warn(`[RTC] WARN: userId=${to} pas dans connectedUsers`);
        console.log(`[RTC] connectedUsers actuels:`, JSON.stringify([...connectedUsers.entries()]));
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
        console.error("[Socket] typing:start error:", err);
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
        console.error("[Socket] typing:stop error:", err);
      }
    });

    socket.on("rtc:ice", (data) => {
      const to = data?.to;
      const candidate = data?.candidate;
      console.log(`[RTC] ice DE=${socket.userId} VERS=${to}`);
      if (!to) {
        console.error(`[RTC] ERREUR: champ 'to' manquant dans rtc:ice. keys=${data ? Object.keys(data) : "null"}`);
        return;
      }
      const targetSocket = connectedUsers.get(String(to));
      if (targetSocket) {
        io.to(targetSocket).emit("rtc:ice", { from: socket.userId, candidate });
      } else {
        console.warn(`[RTC] WARN ice: userId=${to} pas connecté`);
      }
    });

    socket.on("error", (err) => {
      console.error(`[Socket] ERROR userId=${socket.userId}:`, err);
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

