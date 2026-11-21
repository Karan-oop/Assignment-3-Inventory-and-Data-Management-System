const ApiError = require('../utils/ApiError');

/** 404 for any route that did not match. */
function notFound(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Centralized error handler: converts every error into a consistent JSON shape
 *   { success: false, message, errors? }
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.details;

  if (err.name === 'ValidationError' && err.errors) {
    // Mongoose schema validation
    status = 400;
    message = 'Validation failed';
    errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid value for ${err.path}: ${JSON.stringify(err.value)}`;
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `Duplicate value: a product with ${field} "${err.keyValue?.[field]}" already exists`;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON in request body';
  }

  if (status >= 500) {
    console.error(err);
    if (process.env.NODE_ENV === 'production') message = 'Internal Server Error';
  }

  const payload = { success: false, message };
  if (errors) payload.errors = errors;
  if (process.env.NODE_ENV === 'development' && status >= 500) payload.stack = err.stack;
  res.status(status).json(payload);
}

module.exports = { notFound, errorHandler };
