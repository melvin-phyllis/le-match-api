const mongoose = require("mongoose");

const ReportSchema = new mongoose.Schema(
  {
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
    reason: {
      type: String,
      enum: ["Contenu inapproprié", "Harcèlement", "Spam", "Comportement suspect"],
      required: true,
    },
    status: {
      type: String,
      enum: ["En attente", "Résolu", "Ignoré"],
      default: "En attente",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Report", ReportSchema);
