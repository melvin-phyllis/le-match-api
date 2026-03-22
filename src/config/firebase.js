const admin = require("firebase-admin");

function initFirebaseAdmin() {
  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
  } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    // Permet de démarrer le backend même si Firebase n'est pas configuré
    // (hors routes /auth/google).
    console.warn("Firebase config manquante (initFirebaseAdmin).");
    return admin;
  }

  const privateKey = FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });

  return admin;
}

module.exports = initFirebaseAdmin();

