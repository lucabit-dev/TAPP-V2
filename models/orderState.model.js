const mongoose = require('mongoose');

/**
 * Order State Schema - Persists active orders to prevent duplicate submissions
 * after restarts/redeploys
 */
const OrderStateSchema = new mongoose.Schema(
  {
    brokerOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    clientOrderId: {
      type: String,
      index: true
    },
    symbol: {
      type: String,
      required: true,
      index: true,
      uppercase: true
    },
    side: {
      type: String,
      required: true,
      enum: ['buy', 'sell'],
      index: true
    },
    statusRaw: {
      type: String,
      required: true
      // e.g., DON, REJ, FILLED, ACK, CAN, FIL, EXP
    },
    statusNorm: {
      type: String,
      required: true,
      enum: ['ACTIVE', 'INACTIVE'],
      index: true
    },
    type: {
      type: String,
      required: true
      // e.g., 'limit', 'stop_limit', 'market', 'StopLimit', 'Limit', 'Market'
    },
    limitPrice: {
      type: Number
    },
    stopPrice: {
      type: Number
    },
    qty: {
      type: Number,
      required: true
    },
    remainingQty: {
      type: Number
    },
    openedAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    },
    source: {
      type: String,
      enum: ['ws', 'rest_snapshot'],
      default: 'ws'
    },
    // Store full order object for reference
    fullOrderData: {
      type: mongoose.Schema.Types.Mixed
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
OrderStateSchema.index({ symbol: 1, side: 1, statusNorm: 1 });
OrderStateSchema.index({ symbol: 1, side: 1 });
OrderStateSchema.index({ statusNorm: 1, side: 1 });
OrderStateSchema.index({ updatedAt: -1 });

const OrderState = mongoose.models.OrderState || mongoose.model('OrderState', OrderStateSchema);

module.exports = { OrderState };
