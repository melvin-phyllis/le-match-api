const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    age: { type: Number },
    bio: { type: String },
    email: { type: String, unique: true, required: true },
    passwordHash: { type: String },
    googleId: { type: String },
    avatarUrl: { type: String },
    city: { type: String },
    hobbies: [{ type: String }],
    gender: { type: String, enum: ["homme", "femme", "autre"] },
    lookingFor: { type: String, enum: ["homme", "femme", "tous"], default: "tous" },
    language: { type: String, default: "fr" },
    ageMin: { type: Number, default: 18 },
    ageMax: { type: Number, default: 99 },
    location: {
      type: { type: String, default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },
    fcmToken: { type: String },
    isBanned: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

UserSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("User", UserSchema);

