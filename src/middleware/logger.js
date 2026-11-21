/** Minimal request logger: METHOD URL STATUS - ms (no third-party packages needed). */
module.exports = function logger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} - ${ms.toFixed(1)} ms`);
    }
  });
  next();
};
