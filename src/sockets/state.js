const connectedUsers = new Map();
const waitingQueue = [];
const activeSessions = new Map();
const sessionLikes = new Map();

module.exports = { connectedUsers, waitingQueue, activeSessions, sessionLikes };
