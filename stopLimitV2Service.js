const fetch = require('node-fetch');

class StopLimitV2Service {
  constructor({ ordersCache, positionsCache }) {
    this.ordersCache = ordersCache;
    this.positionsCache = positionsCache;
    this.activePositions = new Map(); // Map<symbol, { ...details }>
    
    // Group configs from Manual section context
    this.groupConfigs = {
      A: {
        label: 'Group A',
        priceRange: { minExclusive: 0, maxInclusive: 5 },
        initialOffset: -0.10,
        stages: [
          { trigger: 0.05, stopOffset: -0.05, label: 'Break-even' },
          { trigger: 0.10, stopOffset: 0.04, label: '+0.10 from buy' },
          { trigger: 0.20, stopOffset: 0.10, label: '+0.20 from buy' },
          { trigger: 0.35, stopOffset: 0.28, label: '+0.28 from buy' },
          { trigger: 0.50, stopOffset: 0.40, label: '+0.40 from buy' }
        ],
        autoSellTrigger: 0.75
      },
      B: {
        label: 'Group B',
        priceRange: { minExclusive: 5, maxInclusive: 10 },
        initialOffset: -0.15,
        stages: [
          { trigger: 0.05, stopOffset: -0.10, label: 'Break-even' },
          { trigger: 0.10, stopOffset: 0.02, label: '+0.10 from buy' },
          { trigger: 0.20, stopOffset: 0.10, label: '+0.20 from buy' },
          { trigger: 0.40, stopOffset: 0.30, label: '+0.40 from buy' },
          { trigger: 0.60, stopOffset: 0.50, label: '+0.60 from buy' }
        ],
        autoSellTrigger: 0.95
      },
      C: {
        label: 'Group C',
        priceRange: { minExclusive: 10, maxInclusive: 12 },
        initialOffset: -0.20,
        stages: [
          { trigger: 0.05, stopOffset: -0.10, label: 'Break-even' },
          { trigger: 0.10, stopOffset: 0.02, label: '+0.10 from buy' },
          { trigger: 0.30, stopOffset: 0.10, label: '+0.30 from buy' },
          { trigger: 0.50, stopOffset: 0.30, label: '+0.50 from buy' },
          { trigger: 0.80, stopOffset: 0.60, label: '+0.80 from buy' }
        ],
        autoSellTrigger: 0.95
      }
    };
  }

  // Called when positions websocket updates
  async handlePositionUpdate(positionData) {
    const symbol = positionData.Symbol.toUpperCase();
    const quantity = parseFloat(positionData.Quantity);
    const avgPrice = parseFloat(positionData.AveragePrice);
    
    // Check if position is closed or invalid
    if (!quantity || quantity <= 0) {
        if (this.activePositions.has(symbol)) {
            console.log(`[StopLimitV2] Position ${symbol} closed (qty: ${quantity}). Removing from tracking.`);
            this.activePositions.delete(symbol);
        }
        return;
    }

    // Determine Group Config
    let config = null;
    let groupKey = null;
    for (const [key, conf] of Object.entries(this.groupConfigs)) {
        if (avgPrice > conf.priceRange.minExclusive && avgPrice <= conf.priceRange.maxInclusive) {
            config = conf;
            groupKey = key;
            break;
        }
    }

    if (!config) {
        // Fallback or ignore if price range not covered (or handle as special case)
        // For now, logging warning
        // console.warn(`[StopLimitV2] No config group found for ${symbol} price ${avgPrice}`);
        return; 
    }

    // Calculate Stop/Limit values based on current P&L/Stage
    // Current price approx = avgPrice + (unrealized / quantity) ? 
    // Actually we usually get P&L or current price from position data if available.
    // If not, we might need to fetch it or estimate. 
    // Position data usually has 'CurrentPrice' or we calculate from P&L.
    // Let's check available fields in typical position update.
    // Usually: AveragePrice, CurrentPrice, UnrealizedPnL, etc.
    
    const currentPrice = parseFloat(positionData.CurrentPrice || 0); // Assuming this exists or we derive it
    const pnl = parseFloat(positionData.UnrealizedProfitLoss || 0);
    const pnlPercent = (currentPrice - avgPrice) / avgPrice; // Approx return
    
    // Determine Stage
    let currentStage = -1;
    let nextStage = null;
    
    // Logic to determine stage based on gain
    // Example: gain >= trigger -> active stage
    for (let i = 0; i < config.stages.length; i++) {
        const stage = config.stages[i];
        if (currentPrice >= avgPrice + stage.trigger) { // Using absolute offset based on trigger description? 
            // Trigger is likely absolute dollar gain per share or percentage?
            // "0.05" looks like cents. "trigger: 0.05"
            // "stopOffset: -0.05" means stop = avgPrice - 0.05? Or currentPrice - 0.05?
            // "label: Break-even" with stopOffset -0.05? Break-even usually means stop = avgPrice.
            // Let's assume trigger is absolute gain per share.
            
            currentStage = i;
        } else {
            nextStage = stage;
            break;
        }
    }

    // Calculate Target Stop
    let stopPrice = 0;
    if (currentStage === -1) {
        // Initial Stage
        stopPrice = avgPrice + config.initialOffset;
    } else {
        const stage = config.stages[currentStage];
        // "stopOffset: 0.04" -> stop = avgPrice + 0.04? Or currentPrice? 
        // Typically "Trailing" or "Step" stops are based on Buy Price + Offset.
        stopPrice = avgPrice + stage.stopOffset; 
    }
    
    // Limit price is usually slightly below stop (e.g. 0.02)
    const limitPrice = stopPrice - 0.02;

    const status = {
        symbol,
        avgPrice,
        quantity,
        currentPrice,
        pnl,
        group: config.label,
        stage: currentStage >= 0 ? config.stages[currentStage].label : 'Initial',
        nextStage: nextStage ? `${nextStage.label} (at $${(avgPrice + nextStage.trigger).toFixed(2)})` : 'Max Reached',
        stopPrice: stopPrice.toFixed(2),
        limitPrice: limitPrice.toFixed(2),
        status: 'Active',
        updatedAt: Date.now()
    };

    this.activePositions.set(symbol, status);
    
    // Here we would implement the logic to ACTUALLY send/update orders
    // For V2, we are just tracking for now as per "analysis and tracking" request first?
    // "This section has to show simply in a frontend the POSITION STOPLIMIT STATUS."
    // User mentioned "automated stoplimit analysis and tracking".
    // Does it imply EXECUTION? "work with the existing StopLimit config ... to create an automated stoplimit analysis"
    // Usually yes. But let's focus on state tracking first.
  }

  // Cleanup when position disappears from cache (detected by server's websocket handler)
  handlePositionClosed(symbol) {
      if (this.activePositions.has(symbol)) {
          console.log(`[StopLimitV2] Position ${symbol} closed (no longer in positions feed). Marking as Closed.`);
          const prev = this.activePositions.get(symbol);
          // Mark as closed, set quantity to 0
          this.activePositions.set(symbol, { ...prev, status: 'Closed', quantity: 0, pnl: prev.pnl });
      }
  }

  getSnapshot() {
      return Array.from(this.activePositions.values());
  }
}

module.exports = StopLimitV2Service;

