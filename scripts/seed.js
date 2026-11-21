/**
 * Seeds the database with sample products.
 *   npm run seed            -> clears the products collection and inserts sample data
 *   npm run seed -- --keep  -> inserts only, without clearing first
 */
require('dotenv').config();

const { connectDB, disconnectDB } = require('../src/config/db');
const Product = require('../src/models/Product');
const products = require('./seedData');

(async () => {
  try {
    await connectDB();
    if (!process.argv.includes('--keep')) {
      const { deletedCount } = await Product.deleteMany({});
      console.log(`Cleared ${deletedCount} existing product(s)`);
    }
    await Product.syncIndexes();
    const inserted = await Product.insertMany(products);
    console.log(`Inserted ${inserted.length} sample products`);
  } catch (err) {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
})();
