const fs = require("fs");
const path = require("path");

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), "logs");
const LOG_FILE = process.env.LOG_FILE || path.join(LOG_DIR, "app.log");

function ensureLogDir() {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    // Ignore si impossible de créer le dossier (permissions, etc.)
  }
}

function formatMessage(level, ...args) {
  const timestamp = new Date().toISOString();
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  return `[${timestamp}] [${level}] ${msg}\n`;
}

function writeToFile(level, ...args) {
  ensureLogDir();
  try {
    fs.appendFileSync(LOG_FILE, formatMessage(level, ...args));
  } catch (e) {
    // Ne pas crasher l'app si écriture impossible (permissions, disque plein)
    process.stderr.write(`[Logger] Impossible d'écrire dans ${LOG_FILE}: ${e.message}\n`);
  }
}

const logger = {
  info(...args) {
    console.log(...args);
    writeToFile("INFO", ...args);
  },
  warn(...args) {
    console.warn(...args);
    writeToFile("WARN", ...args);
  },
  error(...args) {
    console.error(...args);
    writeToFile("ERROR", ...args);
  },
};

module.exports = logger;
