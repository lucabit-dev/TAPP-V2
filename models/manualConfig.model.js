const mongoose = require('mongoose');

const MANUAL_CONFIG_ID = '692117e2b7bb6ba7a6ae6f6c';

const ManualConfigSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: MANUAL_CONFIG_ID
    },
    weights: {
      type: Map,
      of: Number,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

const ManualConfig = mongoose.models.ManualConfig || mongoose.model('ManualConfig', ManualConfigSchema);

module.exports = { ManualConfig, MANUAL_CONFIG_ID };




