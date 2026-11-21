const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { buildProductQuery } = require('../utils/buildQuery');

const stockValueExpr = { $round: [{ $multiply: ['$price', '$quantity'] }, 2] };

/**
 * POST /api/products
 * Create a new product.
 */
const createProduct = asyncHandler(async (req, res) => {
  const product = await Product.create(req.body);
  res.status(201).json(product);
});

/**
 * GET /api/products
 * List products with filtering, sorting and pagination.
 * e.g. /api/products?category=Electronics&minPrice=500&sort=-price&page=1&limit=5
 */
const getProducts = asyncHandler(async (req, res) => {
  const { filter, sort, page, limit, skip } = buildProductQuery(req.query);

  const [total, products] = await Promise.all([
    Product.countDocuments(filter),
    Product.find(filter).sort(sort).skip(skip).limit(limit),
  ]);

  res.json({
    total,
    page,
    totalPages: Math.ceil(total / limit),
    count: products.length,
    products,
  });
});

/**
 * GET /api/products/:id
 */
const getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, `Product not found with id ${req.params.id}`);
  res.json(product);
});

/**
 * PUT /api/products/:id   (also PATCH /api/products/:id)
 * Update product details. Only the supplied fields are changed; the full schema
 * validation runs again on save.
 */
const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, `Product not found with id ${req.params.id}`);

  product.set(req.body);
  await product.save();
  res.json(product);
});

/**
 * PATCH /api/products/:id/stock
 * Atomic stock adjustment: { "change": 10 } restocks, { "change": -3 } records a sale.
 * A sale can never push quantity below zero (the condition is part of the update query).
 */
const adjustStock = asyncHandler(async (req, res) => {
  const change = req.stockChange;
  const condition = { _id: req.params.id };
  if (change < 0) condition.quantity = { $gte: -change };

  const product = await Product.findOneAndUpdate(
    condition,
    { $inc: { quantity: change } },
    { new: true, runValidators: true }
  );

  if (!product) {
    const existing = await Product.findById(req.params.id);
    if (!existing) throw new ApiError(404, `Product not found with id ${req.params.id}`);
    throw new ApiError(
      400,
      `Insufficient stock: requested ${-change}, only ${existing.quantity} available`
    );
  }

  const isLow = product.quantity <= product.reorderLevel;
  res.json({
    message: 'Stock updated',
    ...(isLow && { warning: `Stock is at or below reorder level (${product.reorderLevel})` }),
    product,
  });
});

/**
 * DELETE /api/products/:id
 */
const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) throw new ApiError(404, `Product not found with id ${req.params.id}`);
  res.json({ message: 'Product deleted', id: product.id });
});

/**
 * GET /api/products/low-stock
 * Aggregation: every product whose quantity is at or below its own reorderLevel
 * (or at/below ?threshold=N when given), most urgent first.
 * Optional: ?category=Electronics
 */
const getLowStock = asyncHandler(async (req, res) => {
  const match = {};
  if (req.query.threshold !== undefined) {
    const threshold = Number(req.query.threshold);
    if (!Number.isInteger(threshold) || threshold < 0) {
      throw new ApiError(400, '"threshold" must be a non-negative whole number');
    }
    match.quantity = { $lte: threshold };
  } else {
    match.$expr = { $lte: ['$quantity', '$reorderLevel'] };
  }
  if (req.query.category) match.category = String(req.query.category);

  const lowStockItems = await Product.aggregate([
    { $match: match },
    {
      $addFields: {
        stockValue: stockValueExpr,
        shortfall: { $max: [{ $subtract: ['$reorderLevel', '$quantity'] }, 0] },
        id: { $toString: '$_id' },
      },
    },
    { $sort: { quantity: 1, shortfall: -1, name: 1 } },
  ]);

  res.json({ count: lowStockItems.length, lowStockItems });
});

/**
 * GET /api/products/summary
 * Aggregation: category-wise inventory summary, highest stock value first.
 */
const getCategorySummary = asyncHandler(async (req, res) => {
  const summary = await Product.aggregate([
    {
      $group: {
        _id: '$category',
        totalItems: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' },
        totalStockValue: { $sum: { $multiply: ['$price', '$quantity'] } },
        avgPrice: { $avg: '$price' },
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' },
        lowStockCount: {
          $sum: { $cond: [{ $lte: ['$quantity', '$reorderLevel'] }, 1, 0] },
        },
      },
    },
    {
      $project: {
        // expressions (not 1/0) so the output keeps this field order
        totalItems: '$totalItems',
        totalQuantity: '$totalQuantity',
        totalStockValue: { $round: ['$totalStockValue', 2] },
        avgPrice: { $round: ['$avgPrice', 2] },
        minPrice: '$minPrice',
        maxPrice: '$maxPrice',
        lowStockCount: '$lowStockCount',
      },
    },
    { $sort: { totalStockValue: -1, _id: 1 } },
  ]);

  const overall = summary.reduce(
    (acc, c) => ({
      totalItems: acc.totalItems + c.totalItems,
      totalQuantity: acc.totalQuantity + c.totalQuantity,
      totalStockValue: Math.round((acc.totalStockValue + c.totalStockValue) * 100) / 100,
      lowStockCount: acc.lowStockCount + c.lowStockCount,
    }),
    { totalItems: 0, totalQuantity: 0, totalStockValue: 0, lowStockCount: 0 }
  );

  res.json({ categories: summary.length, summary, overall });
});

module.exports = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  adjustStock,
  deleteProduct,
  getLowStock,
  getCategorySummary,
};
