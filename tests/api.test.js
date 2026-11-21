/**
 * End-to-end API tests using only Node's built-in test runner and fetch.
 * Needs a reachable MongoDB (MONGO_URI from .env, or MONGO_URI_TEST).
 * Uses a separate database "inventory_test" so your real data is untouched.
 *
 *   npm test
 */
require('dotenv').config();
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const app = require('../src/app');
const Product = require('../src/models/Product');
const seedData = require('../scripts/seedData');

let server;
let base;

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  const uri = process.env.MONGO_URI_TEST || process.env.MONGO_URI;
  await mongoose.connect(uri, { dbName: 'inventory_test', serverSelectionTimeoutMS: 5000 });
  await Product.deleteMany({});
  await Product.syncIndexes();
  await Product.insertMany(seedData);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await new Promise((resolve) => server.close(resolve));
});

describe('Schema & validation', () => {
  test('rejects missing required fields', async () => {
    const r = await api('POST', '/api/products', { name: 'X' });
    assert.equal(r.status, 400);
    assert.equal(r.body.success, false);
    const fields = r.body.errors.map((e) => e.field);
    for (const f of ['sku', 'category', 'price', 'quantity']) assert.ok(fields.includes(f), f);
  });

  test('rejects negative price, fractional quantity, bad category', async () => {
    const r = await api('POST', '/api/products', {
      name: 'Bad', sku: 'BAD-1', category: 'Toys', price: -5, quantity: 1.5,
    });
    assert.equal(r.status, 400);
    const fields = r.body.errors.map((e) => e.field);
    assert.ok(fields.includes('price'));
    assert.ok(fields.includes('quantity'));
    assert.ok(fields.includes('category'));
  });

  test('mongoose schema validation catches invalid SKU format', async () => {
    const r = await api('POST', '/api/products', {
      name: 'Bad SKU', sku: 'has spaces!', category: 'Other', price: 1, quantity: 1,
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.errors[0].field, 'sku');
  });

  test('duplicate SKU returns 409', async () => {
    const r = await api('POST', '/api/products', {
      name: 'Dup', sku: 'furn-tb-812', category: 'Furniture', price: 1, quantity: 1,
    });
    assert.equal(r.status, 409);
  });

  test('malformed JSON returns 400', async () => {
    const r = await api('POST', '/api/products', '{"name": ');
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Malformed JSON/);
  });
});

describe('CRUD', () => {
  let id;

  test('POST creates a product (201) with virtual stockValue', async () => {
    const r = await api('POST', '/api/products', {
      name: 'Gel Pen Pack of 15', sku: 'stny-pn-713', category: 'Stationery',
      price: 120, quantity: 40, reorderLevel: 20, supplier: 'Cello Pens',
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.sku, 'STNY-PN-713'); // uppercased by schema
    assert.equal(r.body.stockValue, 4800);
    assert.ok(r.body.id && r.body._id && r.body.createdAt && r.body.updatedAt);
    id = r.body._id;
  });

  test('GET /:id returns the product', async () => {
    const r = await api('GET', `/api/products/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'Gel Pen Pack of 15');
  });

  test('GET /:id with invalid id returns 400, unknown id returns 404', async () => {
    assert.equal((await api('GET', '/api/products/123')).status, 400);
    assert.equal((await api('GET', `/api/products/${new mongoose.Types.ObjectId()}`)).status, 404);
  });

  test('PUT updates details and keeps untouched fields', async () => {
    const r = await api('PUT', `/api/products/${id}`, {
      name: 'Gel Pen Pack of 15', sku: 'STNY-PN-713', category: 'Stationery', price: 140, quantity: 60,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.price, 140);
    assert.equal(r.body.quantity, 60);
    assert.equal(r.body.reorderLevel, 20);
    assert.equal(r.body.supplier, 'Cello Pens');
    assert.equal(r.body.stockValue, 8400);
  });

  test('PUT with invalid data is rejected', async () => {
    const r = await api('PUT', `/api/products/${id}`, { price: -1 });
    assert.equal(r.status, 400);
  });

  test('DELETE removes the product', async () => {
    const r = await api('DELETE', `/api/products/${id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { message: 'Product deleted', id });
    assert.equal((await api('GET', `/api/products/${id}`)).status, 404);
    assert.equal((await api('DELETE', `/api/products/${id}`)).status, 404);
  });
});

describe('Filtering, sorting & pagination', () => {
  test('default listing is paginated (limit 10)', async () => {
    const r = await api('GET', '/api/products');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 12);
    assert.equal(r.body.page, 1);
    assert.equal(r.body.totalPages, 2);
    assert.equal(r.body.count, 10);
    assert.equal(r.body.products.length, 10);
  });

  test('page 2 returns the remaining items without overlap', async () => {
    const p1 = await api('GET', '/api/products?page=1&limit=5&sort=name');
    const p2 = await api('GET', '/api/products?page=2&limit=5&sort=name');
    const ids1 = p1.body.products.map((p) => p.id);
    const ids2 = p2.body.products.map((p) => p.id);
    assert.equal(ids2.length, 5);
    assert.ok(ids2.every((x) => !ids1.includes(x)));
  });

  test('filter by category (case-insensitive)', async () => {
    const r = await api('GET', '/api/products?category=electronics');
    assert.equal(r.body.total, 4);
    assert.ok(r.body.products.every((p) => p.category === 'Electronics'));
  });

  test('filter by price range and sort by price descending', async () => {
    const r = await api('GET', '/api/products?minPrice=500&maxPrice=5000&sort=-price');
    const prices = r.body.products.map((p) => p.price);
    assert.ok(prices.every((p) => p >= 500 && p <= 5000));
    assert.deepEqual(prices, [...prices].sort((a, b) => b - a));
  });

  test('search by name / supplier', async () => {
    const r = await api('GET', '/api/products?search=cello');
    assert.equal(r.body.total, 1);
    assert.equal(r.body.products[0].supplier, 'Cello Pens');
  });

  test('lowStock filter on listing', async () => {
    const r = await api('GET', '/api/products?lowStock=true');
    assert.equal(r.body.total, 4);
  });

  test('invalid sort field / page values are rejected', async () => {
    assert.equal((await api('GET', '/api/products?sort=password')).status, 400);
    assert.equal((await api('GET', '/api/products?page=0')).status, 400);
    assert.equal((await api('GET', '/api/products?minPrice=abc')).status, 400);
  });
});

describe('Stock adjustment', () => {
  let tableId;
  before(async () => {
    tableId = (await Product.findOne({ sku: 'FURN-TB-812' })).id;
  });

  test('restock with { change: 10 }', async () => {
    const r = await api('PATCH', `/api/products/${tableId}/stock`, { change: 10 });
    assert.equal(r.status, 200);
    assert.equal(r.body.message, 'Stock updated');
    assert.equal(r.body.product.quantity, 12);
    assert.equal(r.body.product.stockValue, 47988);
  });

  test('sale with { type: "sale", amount: 3 }', async () => {
    const r = await api('PATCH', `/api/products/${tableId}/stock`, { type: 'sale', amount: 3 });
    assert.equal(r.status, 200);
    assert.equal(r.body.product.quantity, 9);
  });

  test('cannot sell more than available (stock never negative)', async () => {
    const r = await api('PATCH', `/api/products/${tableId}/stock`, { change: -100 });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Insufficient stock/);
    const after = await api('GET', `/api/products/${tableId}`);
    assert.equal(after.body.quantity, 9);
  });

  test('concurrent sales cannot oversell', async () => {
    // 9 in stock, fire 15 parallel sales of 1 -> exactly 9 succeed
    const results = await Promise.all(
      Array.from({ length: 15 }, () => api('PATCH', `/api/products/${tableId}/stock`, { change: -1 }))
    );
    assert.equal(results.filter((r) => r.status === 200).length, 9);
    const after = await api('GET', `/api/products/${tableId}`);
    assert.equal(after.body.quantity, 0);
  });

  test('invalid change values are rejected', async () => {
    assert.equal((await api('PATCH', `/api/products/${tableId}/stock`, { change: 0 })).status, 400);
    assert.equal((await api('PATCH', `/api/products/${tableId}/stock`, { change: 'ten' })).status, 400);
    assert.equal((await api('PATCH', `/api/products/${tableId}/stock`, {})).status, 400);
  });

  after(async () => {
    await Product.updateOne({ sku: 'FURN-TB-812' }, { quantity: 2 });
  });
});

describe('Aggregation reports', () => {
  test('low-stock report lists items at or below reorder level', async () => {
    const r = await api('GET', '/api/products/low-stock');
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 4);
    assert.equal(r.body.lowStockItems.length, 4);
    for (const p of r.body.lowStockItems) {
      assert.ok(p.quantity <= p.reorderLevel);
      assert.equal(p.stockValue, Math.round(p.price * p.quantity * 100) / 100);
      assert.equal(typeof p.id, 'string');
    }
    const qty = r.body.lowStockItems.map((p) => p.quantity);
    assert.deepEqual(qty, [...qty].sort((a, b) => a - b));
  });

  test('low-stock report supports ?threshold and ?category', async () => {
    const r = await api('GET', '/api/products/low-stock?threshold=10&category=Furniture');
    assert.ok(r.body.lowStockItems.every((p) => p.quantity <= 10 && p.category === 'Furniture'));
    assert.equal(r.body.count, 2);
  });

  test('category summary groups by category with totals', async () => {
    const r = await api('GET', '/api/products/summary');
    assert.equal(r.status, 200);
    assert.equal(r.body.categories, 5);
    const elec = r.body.summary.find((s) => s._id === 'Electronics');
    assert.equal(elec.totalItems, 4);
    assert.equal(elec.totalQuantity, 45 + 18 + 3 + 30);
    assert.equal(elec.totalStockValue, 799 * 45 + 3499 * 18 + 14999 * 3 + 1299 * 30);
    assert.equal(elec.avgPrice, (799 + 3499 + 14999 + 1299) / 4);
    const values = r.body.summary.map((s) => s.totalStockValue);
    assert.deepEqual(values, [...values].sort((a, b) => b - a));
    assert.equal(r.body.overall.totalItems, 12);
  });
});

describe('Misc', () => {
  test('unknown route returns JSON 404', async () => {
    const r = await api('GET', '/api/nope');
    assert.equal(r.status, 404);
    assert.equal(r.body.success, false);
  });

  test('health endpoint reports database connected', async () => {
    const r = await api('GET', '/api/health');
    assert.equal(r.body.database, 'connected');
  });
});
