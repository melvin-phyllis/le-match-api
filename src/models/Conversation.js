const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true },
    sentAt: { type: Date, default: Date.now },
    read: { type: Boolean, default: false },
    type: { type: String, default: "text", enum: ["text", "image", "audio"] },
    duration: { type: Number, default: 0 },
  },
  { _id: true }
);

const ConversationSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
    messages: [MessageSchema],
    lastMessage: { type: String, default: "" },
    lastActivity: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ConversationSchema.index({ participants: 1, lastActivity: -1 });

module.exports = mongoose.model("Conversation", ConversationSchema);

