const mongoose = require('mongoose');

const STOPLIMIT_TRACKER_CONFIG_ID = 'stoplimit_tracker_config_global';

// Schema for a step in the tracker (P&L threshold → stop price)
const TrackerStepSchema = new mongoose.Schema({
  pnl: {
    type: Number,
    required: true,
    default: 0
  },
  stop: {
    type: Number,
    required: true,
    default: 0
  }
}, { _id: false });

// Schema for a group in the tracker config
const TrackerGroupSchema = new mongoose.Schema({
  groupId: {
    type: String,
    required: true
  },
  minPrice: {
    type: Number,
    required: true,
    default: 0
  },
  maxPrice: {
    type: Number,
    required: true,
    default: 999999
  },
  initialStopPrice: {
    type: Number,
    required: true,
    default: 0,
    // This is an OFFSET from buy price (can be negative, e.g., -0.15)
    // stop_price = buy_price + initialStopPrice
  },
  enabled: {
    type: Boolean,
    default: true
  },
  steps: {
    type: [TrackerStepSchema],
    default: []
  }
}, { _id: false });

// Main schema for StopLimit Tracker Config
const StopLimitTrackerConfigSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: STOPLIMIT_TRACKER_CONFIG_ID
    },
    groups: {
      type: [TrackerGroupSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

const StopLimitTrackerConfig = mongoose.models.StopLimitTrackerConfig || mongoose.model('StopLimitTrackerConfig', StopLimitTrackerConfigSchema);

module.exports = { StopLimitTrackerConfig, STOPLIMIT_TRACKER_CONFIG_ID };
