function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error("Erreur:", err);
  const message = err?.message || "Erreur interne";
  res.status(500).json({ error: message });
}

module.exports = errorHandler;

