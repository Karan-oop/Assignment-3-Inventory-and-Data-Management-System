const ApiError = require('./ApiError');

const SORTABLE_FIELDS = [
  'name', 'sku', 'category', 'price', 'quantity',
  'reorderLevel', 'supplier', 'createdAt', 'updatedAt',
];

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toNumber(value, field) {
  const n = Number(value);
  if (value === '' || Array.isArray(value) || Number.isNaN(n)) {
    throw new ApiError(400, `Query parameter "${field}" must be a number`);
  }
  return n;
}

/**
 * Turns the query string into a Mongo filter, a sort object and pagination values.
 *
 * Filters:  category (comma list), supplier, search (name/sku/supplier),
 *           minPrice, maxPrice, minQty, maxQty, inStock=true|false, lowStock=true
 * Sorting:  sort=price,-name   ("-" prefix = descending; default "-createdAt")
 * Paging:   page (default 1), limit (default 10, capped at MAX_PAGE_LIMIT)
 */
function buildProductQuery(query) {
  const filter = {};

  if (query.category) {
    const cats = String(query.category).split(',').map((c) => c.trim()).filter(Boolean);
    filter.category = { $in: cats.map((c) => new RegExp(`^${escapeRegex(c)}$`, 'i')) };
  }

  if (query.supplier) {
    filter.supplier = new RegExp(escapeRegex(query.supplier), 'i');
  }

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { supplier: rx }];
  }

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.price = {};
    if (query.minPrice !== undefined) filter.price.$gte = toNumber(query.minPrice, 'minPrice');
    if (query.maxPrice !== undefined) filter.price.$lte = toNumber(query.maxPrice, 'maxPrice');
  }

  if (query.minQty !== undefined || query.maxQty !== undefined) {
    filter.quantity = {};
    if (query.minQty !== undefined) filter.quantity.$gte = toNumber(query.minQty, 'minQty');
    if (query.maxQty !== undefined) filter.quantity.$lte = toNumber(query.maxQty, 'maxQty');
  }

  if (query.inStock !== undefined) {
    if (query.inStock === 'true') filter.quantity = { ...(filter.quantity || {}), $gt: 0 };
    else if (query.inStock === 'false') filter.quantity = 0;
    else throw new ApiError(400, 'Query parameter "inStock" must be true or false');
  }

  if (query.lowStock === 'true') {
    filter.$expr = { $lte: ['$quantity', '$reorderLevel'] };
  }

  // ---- Sorting ----
  const sort = {};
  const sortParam = query.sort ? String(query.sort) : '-createdAt';
  for (const raw of sortParam.split(',').map((s) => s.trim()).filter(Boolean)) {
    const desc = raw.startsWith('-');
    const field = desc ? raw.slice(1) : raw;
    if (!SORTABLE_FIELDS.includes(field)) {
      throw new ApiError(400, `Cannot sort by "${field}". Allowed: ${SORTABLE_FIELDS.join(', ')}`);
    }
    sort[field] = desc ? -1 : 1;
  }
  sort._id = 1; // tie-breaker so pages never overlap

  // ---- Pagination ----
  const defaultLimit = Number(process.env.DEFAULT_PAGE_LIMIT) || 10;
  const maxLimit = Number(process.env.MAX_PAGE_LIMIT) || 100;
  const page = query.page !== undefined ? toNumber(query.page, 'page') : 1;
  const limit = query.limit !== undefined ? toNumber(query.limit, 'limit') : defaultLimit;
  if (!Number.isInteger(page) || page < 1) throw new ApiError(400, '"page" must be a positive integer');
  if (!Number.isInteger(limit) || limit < 1) throw new ApiError(400, '"limit" must be a positive integer');

  const safeLimit = Math.min(limit, maxLimit);
  return { filter, sort, page, limit: safeLimit, skip: (page - 1) * safeLimit };
}

module.exports = { buildProductQuery, SORTABLE_FIELDS };
