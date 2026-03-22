const bcrypt = require("bcryptjs");
const User = require("../models/User");

const DEFAULT_ADMIN_EMAIL = "guehiphilippe@ya-consulting.com";
const DEFAULT_ADMIN_PASSWORD = "9Tc+L1MC8e}f";

async function seedAdmin() {
  const email = process.env.ADMIN_SEED_EMAIL || DEFAULT_ADMIN_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD || DEFAULT_ADMIN_PASSWORD;

  const existing = await User.findOne({ email });
  if (existing) {
    if (!existing.isAdmin) {
      existing.isAdmin = true;
      await existing.save();
      console.log("[Seed] Compte admin mis à jour:", email);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({
    name: "Admin Le Match",
    email,
    passwordHash,
    isAdmin: true,
  });
  console.log("[Seed] Compte admin créé:", email);
}

module.exports = seedAdmin;
