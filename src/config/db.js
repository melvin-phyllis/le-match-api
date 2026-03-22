const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    const err = new Error("MONGODB_URI manquant dans .env");
    err.code = "MONGODB_URI_MISSING";
    throw err;
  }

  try {
    await mongoose.connect(uri);
    console.log("MongoDB connecté");
  } catch (err) {
    const msg =
      err.name === "MongooseServerSelectionError" ||
      err.message?.includes("connect") ||
      err.message?.includes("ECONNREFUSED")
        ? "Impossible de se connecter à la base de données. Vérifiez MONGODB_URI et l'accès réseau (whitelist IP sur Atlas)."
        : err.message || "Erreur MongoDB";
    console.error("\n❌ " + msg + "\n");
    const e = new Error(msg);
    e.originalError = err;
    throw e;
  }
}

module.exports = connectDB;

