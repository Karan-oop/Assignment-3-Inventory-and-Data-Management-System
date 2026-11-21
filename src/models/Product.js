const mongoose = require('mongoose');

const CATEGORIES = [
  'Electronics',
  'Apparel',
  'Furniture',
  'Stationery',
  'Grocery',
  'Home & Kitchen',
  'Sports',
  'Other',
];

const integerValidator = (label) => ({
  validator: Number.isInteger,
  message: `${label} must be a whole number`,
});

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      minlength: [2, 'Product name must be at least 2 characters'],
      maxlength: [100, 'Product name cannot exceed 100 characters'],
    },
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: [30, 'SKU cannot exceed 30 characters'],
      match: [
        /^[A-Z0-9]+(-[A-Z0-9]+)*$/,
        'SKU may contain only letters, digits and single hyphens (e.g. STNY-PN-713)',
      ],
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      enum: {
        values: CATEGORIES,
        message: `Category must be one of: ${CATEGORIES.join(', ')}`,
      },
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [0, 'Quantity cannot be negative'],
      validate: integerValidator('Quantity'),
    },
    reorderLevel: {
      type: Number,
      default: 10,
      min: [0, 'Reorder level cannot be negative'],
      validate: integerValidator('Reorder level'),
    },
    supplier: {
      type: String,
      trim: true,
      default: 'Unknown',
      maxlength: [100, 'Supplier name cannot exceed 100 characters'],
    },
  },
  {
    timestamps: true, // adds createdAt / updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Derived field: total value of the stock currently held for this product.
productSchema.virtual('stockValue').get(function stockValue() {
  return Math.round(this.price * this.quantity * 100) / 100;
});

// Indexes for the most common filters / sorts.
productSchema.index({ category: 1, price: 1 });
productSchema.index({ quantity: 1 });

productSchema.statics.CATEGORIES = CATEGORIES;

module.exports = mongoose.model('Product', productSchema);
