const mongoose = require("mongoose");

const AppVersionSchema = new mongoose.Schema(
  {
    version: { type: String, required: true },
    filename: { type: String, required: true },
    filePath: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppVersion", AppVersionSchema);
