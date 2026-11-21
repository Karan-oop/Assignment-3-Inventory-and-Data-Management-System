const express = require('express');
const ctrl = require('../controllers/productController');
const { validateObjectId, validateProduct, validateStockChange } = require('../middleware/validate');

const router = express.Router();

// Reports (declared before "/:id" so they are not treated as ids)
router.get('/low-stock', ctrl.getLowStock);
router.get('/summary', ctrl.getCategorySummary);

// Collection
router
  .route('/')
  .get(ctrl.getProducts)
  .post(validateProduct('create'), ctrl.createProduct);

// Stock adjustment (restock / sale)
router.patch('/:id/stock', validateObjectId, validateStockChange, ctrl.adjustStock);

// Single product
router
  .route('/:id')
  .all(validateObjectId)
  .get(ctrl.getProductById)
  .put(validateProduct('update'), ctrl.updateProduct)
  .patch(validateProduct('update'), ctrl.updateProduct)
  .delete(ctrl.deleteProduct);

module.exports = router;
