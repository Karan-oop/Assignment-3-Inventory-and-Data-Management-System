const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const Product = require('../models/Product');

const ALLOWED_FIELDS = ['name', 'sku', 'category', 'price', 'quantity', 'reorderLevel', 'supplier'];
const REQUIRED_ON_CREATE = ['name', 'sku', 'category', 'price', 'quantity'];
const STRING_FIELDS = ['name', 'sku', 'category', 'supplier'];
const NUMBER_FIELDS = ['price', 'quantity', 'reorderLevel'];
const INTEGER_FIELDS = ['quantity', 'reorderLevel'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Rejects any :id that is not a valid MongoDB ObjectId before it reaches the DB. */
function validateObjectId(req, res, next) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return next(new ApiError(400, `Invalid product id: ${req.params.id}`));
  }
  return next();
}

/**
 * Request-body validation for products (runs before Mongoose's own schema validation).
 * mode "create" requires all mandatory fields; mode "update" accepts any subset.
 */
const validateProduct = (mode) => (req, res, next) => {
  const body = req.body;
  if (!isPlainObject(body)) {
    return next(new ApiError(400, 'Request body must be a JSON object'));
  }

  const errors = [];

  const unknown = Object.keys(body).filter((k) => !ALLOWED_FIELDS.includes(k));
  if (unknown.length) {
    errors.push({ field: unknown.join(', '), message: `Unknown field(s). Allowed: ${ALLOWED_FIELDS.join(', ')}` });
  }

  if (mode === 'create') {
    for (const field of REQUIRED_ON_CREATE) {
      if (body[field] === undefined || body[field] === null || body[field] === '') {
        errors.push({ field, message: `${field} is required` });
      }
    }
  } else if (Object.keys(body).length === 0) {
    errors.push({ field: 'body', message: 'Provide at least one field to update' });
  }

  for (const field of STRING_FIELDS) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
      errors.push({ field, message: `${field} must be a string` });
    } else if (typeof body[field] === 'string' && body[field].trim() === '' && mode === 'update') {
      errors.push({ field, message: `${field} cannot be empty` });
    }
  }

  for (const field of NUMBER_FIELDS) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push({ field, message: `${field} must be a number` });
    } else if (v < 0) {
      errors.push({ field, message: `${field} cannot be negative` });
    } else if (INTEGER_FIELDS.includes(field) && !Number.isInteger(v)) {
      errors.push({ field, message: `${field} must be a whole number` });
    }
  }

  if (typeof body.category === 'string' && body.category.trim() && !Product.CATEGORIES.includes(body.category.trim())) {
    errors.push({ field: 'category', message: `Category must be one of: ${Product.CATEGORIES.join(', ')}` });
  }

  if (errors.length) return next(new ApiError(400, 'Validation failed', errors));
  return next();
};

/**
 * Validates a stock adjustment. Accepts either
 *   { "change": 10 }  (positive = restock, negative = sale)  or
 *   { "type": "restock" | "sale", "amount": 5 }
 * and normalises it to req.stockChange (a non-zero integer).
 */
function validateStockChange(req, res, next) {
  const body = req.body;
  if (!isPlainObject(body)) return next(new ApiError(400, 'Request body must be a JSON object'));

  let change;
  if (body.change !== undefined) {
    change = body.change;
  } else if (body.type !== undefined || body.amount !== undefined) {
    if (!['restock', 'sale'].includes(body.type)) {
      return next(new ApiError(400, 'Validation failed', [{ field: 'type', message: 'type must be "restock" or "sale"' }]));
    }
    if (typeof body.amount !== 'number' || !Number.isInteger(body.amount) || body.amount <= 0) {
      return next(new ApiError(400, 'Validation failed', [{ field: 'amount', message: 'amount must be a positive whole number' }]));
    }
    change = body.type === 'sale' ? -body.amount : body.amount;
  } else {
    return next(new ApiError(400, 'Validation failed', [
      { field: 'change', message: 'Provide "change" (e.g. 10 or -3) or "type" + "amount"' },
    ]));
  }

  if (typeof change !== 'number' || !Number.isInteger(change) || change === 0) {
    return next(new ApiError(400, 'Validation failed', [{ field: 'change', message: 'change must be a non-zero whole number' }]));
  }

  req.stockChange = change;
  return next();
}

module.exports = { validateObjectId, validateProduct, validateStockChange };
