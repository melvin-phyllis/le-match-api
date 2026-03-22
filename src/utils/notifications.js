const admin = require("../config/firebase");

async function sendNotification(userId, { title, body, data = {} }) {
  try {
    const User = require("../models/User");
    const user = await User.findById(userId).select("fcmToken");
    if (!user?.fcmToken) return;

    const dataStrings = Object.fromEntries(
      Object.entries({ ...data, type: data.type || "" }).map(([k, v]) => [
        k,
        v == null ? "" : String(v),
      ]),
    );

    await admin.messaging().send({
      token: user.fcmToken,
      notification: { title, body },
      data: dataStrings,
      android: {
        priority: "high",
        notification: { sound: "default" },
      },
    });
    console.log(`[FCM] Notification envoyée à ${userId}`);
  } catch (err) {
    console.warn(`[FCM] Erreur envoi notification: ${err.message}`);
  }
}

module.exports = { sendNotification };

