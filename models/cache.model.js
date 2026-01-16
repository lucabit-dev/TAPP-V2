const mongoose = require('mongoose');

// Schema for storing orders cache
const OrderCacheSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    orderData: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    lastUpdated: {
      type: Number,
      default: () => Date.now()
    }
  },
  {
    timestamps: true
  }
);

// Schema for storing positions cache
const PositionCacheSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true
    },
    positionData: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    lastUpdated: {
      type: Number,
      default: () => Date.now()
    }
  },
  {
    timestamps: true
  }
);

// Schema for cache metadata (to track last sync, etc.)
const CacheMetadataSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'global'
    },
    lastOrdersSync: {
      type: Number,
      default: 0
    },
    lastPositionsSync: {
      type: Number,
      default: 0
    },
    ordersCount: {
      type: Number,
      default: 0
    },
    positionsCount: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

const OrderCache = mongoose.models.OrderCache || mongoose.model('OrderCache', OrderCacheSchema);
const PositionCache = mongoose.models.PositionCache || mongoose.model('PositionCache', PositionCacheSchema);
const CacheMetadata = mongoose.models.CacheMetadata || mongoose.model('CacheMetadata', CacheMetadataSchema);

module.exports = {
  OrderCache,
  PositionCache,
  CacheMetadata
};
