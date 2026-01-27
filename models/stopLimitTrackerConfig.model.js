const mongoose = require('mongoose');

const STOPLIMIT_TRACKER_CONFIG_ID = 'stoplimit_tracker_config';

const StopLimitTrackerStepSchema = new mongoose.Schema({
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

const StopLimitTrackerGroupSchema = new mongoose.Schema({
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
    default: 0
  },
  enabled: {
    type: Boolean,
    default: true
  },
  steps: {
    type: [StopLimitTrackerStepSchema],
    default: []
  }
}, { _id: false });

const StopLimitTrackerConfigSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: STOPLIMIT_TRACKER_CONFIG_ID
    },
    groups: {
      type: [StopLimitTrackerGroupSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

const StopLimitTrackerConfig = mongoose.models.StopLimitTrackerConfig || mongoose.model('StopLimitTrackerConfig', StopLimitTrackerConfigSchema);

module.exports = { StopLimitTrackerConfig, STOPLIMIT_TRACKER_CONFIG_ID };
