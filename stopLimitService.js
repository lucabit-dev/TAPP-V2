const fetch = require('node-fetch');

const ACTIVE_ORDER_STATUSES = new Set(['ACK', 'DON', 'REC', 'QUE', 'QUEUED']);
const NON_ACTIVE_STATUSES = new Set(['CAN', 'FIL', 'EXP', 'OUT', 'REJ', 'FLL']);

class StopLimitService {
  constructor({ ordersCache, positionsCache }) {
    this.ordersCache = ordersCache;
    this.positionsCache = positionsCache || null;
    this.trackedPositions = new Map(); // Map<symbol, PositionState>
    this.soldPositions = new Map(); // Map<symbol, SoldPositionState>
    this.orderWaiters = new Map(); // Map<symbol, Set<OrderWaiter>>
    this.analysisEnabled = true;
    this.analysisChangedAt = Date.now();

    this.limitOffset = 0.02; // limit price always stays $0.02 below stop (stop_price = limit_price + 0.02)
    console.log(`⚙️ StopLimitService initialized with limitOffset=${this.limitOffset} (limit will be ${this.limitOffset} below stop price)`);
    this.apiBaseUrl = 'https://sections-bot.inbitme.com';

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

  async handlePositionUpdate(position) {
    const symbol = (position?.Symbol || '').toUpperCase();
    if (!symbol) return;

    const quantity = this.parseNumber(position?.Quantity);
    const avgPrice = this.parseNumber(position?.AveragePrice);
    const unrealizedQty = this.parseNumber(position?.UnrealizedProfitLossQty);
    const longShort = (position?.LongShort || '').toUpperCase();
    
    // Debug logging for stage evaluation
    if (unrealizedQty !== null && unrealizedQty !== undefined) {
      console.log(`📊 StopLimitService: ${symbol} position update - unrealizedQty=${unrealizedQty.toFixed(4)}, quantity=${quantity}, avgPrice=${avgPrice?.toFixed(2)}`);
    }

    if (!quantity || quantity <= 0) {
      this.cleanupPosition(symbol);
      return;
    }

    if (!avgPrice || avgPrice <= 0) {
      console.warn(`⚠️ StopLimitService: Skipping ${symbol} - invalid average price: ${position?.AveragePrice}`);
      return;
    }

    if (longShort !== 'LONG') {
      // Only manage long positions for this automation
      // If we were tracking this position, cleanup since it's no longer LONG
      if (this.trackedPositions.has(symbol)) {
        console.log(`🧹 StopLimitService: Position ${symbol} is no longer LONG (${longShort}), cleaning up tracking`);
        this.cleanupPosition(symbol);
      }
      return;
    }

    // CRITICAL: If quantity is 0 or negative, position is closed - cleanup immediately
    if (!quantity || quantity <= 0) {
      if (this.trackedPositions.has(symbol)) {
        console.log(`🧹 StopLimitService: Position ${symbol} is closed (quantity: ${quantity}), cleaning up tracking immediately`);
        this.cleanupPosition(symbol);
      }
      return;
    }

    let state = this.trackedPositions.get(symbol);
    if (!state) {
      // CRITICAL: Final validation before creating new state
      // This prevents re-adding closed positions that might have passed earlier checks
      if (!this.hasActivePosition(symbol)) {
        console.log(`🧹 StopLimitService: Skipping ${symbol} - position is not active (may have closed)`);
        return;
      }

      // Double-check quantity is still valid
      const currentQuantity = this.parseNumber(position?.Quantity);
      if (!currentQuantity || currentQuantity <= 0) {
        console.log(`🧹 StopLimitService: Skipping ${symbol} - quantity is ${currentQuantity}`);
        return;
      }

      const group = this.resolveGroup(avgPrice);
      if (!group) {
        console.warn(`⚠️ StopLimitService: ${symbol} price ${avgPrice} outside supported range - skipping StopLimit automation`);
        return;
      }

      state = {
        symbol,
        positionId: position?.PositionID || null,
        accountId: position?.AccountID || null,
        groupKey: group,
        avgPrice,
        quantity,
        longShort,
        stageIndex: -1, // -1 indicates initial order not yet created
        orderId: null,
        pendingCreate: false,
        pendingUpdate: false,
        autoSellExecuted: false,
        lastStopPrice: null,
        lastLimitPrice: null,
        lastUnrealizedQty: unrealizedQty,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        orderStatus: null,
        lastOrderCreateAttempt: null
      };
      this.trackedPositions.set(symbol, state);
      console.log(`✅ StopLimitService: Started tracking ${symbol} (quantity: ${quantity}, avgPrice: ${avgPrice})`);
    } else {
      // CRITICAL: Double-check position is still active before updating state
      // This handles cases where position closes between updates
      if (!this.hasActivePosition(symbol)) {
        console.log(`🧹 StopLimitService: Position ${symbol} is no longer active during state update, cleaning up`);
        this.cleanupPosition(symbol);
        return;
      }

      state.avgPrice = avgPrice;
      state.quantity = quantity;
      state.positionId = position?.PositionID || state.positionId;
      state.lastUnrealizedQty = unrealizedQty;
      state.updatedAt = Date.now();

      // Only reset if order is truly inactive (cancelled, filled, rejected)
      // Don't reset if we recently created an order (even if orderId extraction failed)
      // Don't reset if we're waiting for websocket update (orderId set but status null)
      const orderStatusUpper = (state.orderStatus || '').toUpperCase();
      const recentlyCreated = state.lastOrderCreateAttempt && (Date.now() - state.lastOrderCreateAttempt) < 10000; // 10 seconds
      const shouldReset = 
        state.autoSellExecuted || 
        (state.orderStatus && NON_ACTIVE_STATUSES.has(orderStatusUpper) && !recentlyCreated) ||
        (!state.orderId && state.stageIndex >= 0 && !recentlyCreated && !state.pendingCreate);

      if (shouldReset) {
        console.log(`🔄 StopLimitService: Reinitializing StopLimit tracking for ${symbol} (autoSell=${state.autoSellExecuted}, orderId=${state.orderId}, status=${state.orderStatus}, recentlyCreated=${recentlyCreated})`);
        state.stageIndex = -1;
        state.orderId = null;
        state.orderStatus = null;
        state.pendingCreate = false;
        state.pendingUpdate = false;
        state.autoSellExecuted = false;
        state.lastStopPrice = null;
        state.lastLimitPrice = null;
        state.lastOrderCreateAttempt = null;
      }
      // Don't reset stageIndex if we recently created an order - wait for websocket to provide orderId
    }

    state.updatedAt = Date.now();

    if (!this.analysisEnabled) {
      return;
    }

    if (state.autoSellExecuted) {
      return;
    }

    // Only ensure initial order if we haven't created one yet
    // If stageIndex >= 0, we've already created an order (even if orderId not yet set)
    // If we have an orderId, we definitely have an order
    // If we recently attempted creation, wait for it to complete
    const hasOrder = state.stageIndex >= 0 || state.orderId || (state.pendingCreate && state.lastOrderCreateAttempt);
    
    if (!hasOrder) {
      await this.ensureInitialOrder(state);
    } else if (state.stageIndex >= 0) {
      // We have an order, just evaluate adjustments (price updates based on unrealized profit)
      // Don't try to create another order
      console.log(`✅ StopLimitService: ${symbol} already has StopLimit order (stageIndex=${state.stageIndex}, orderId=${state.orderId || 'pending'}), skipping creation, evaluating adjustments only`);
    }
    
    await this.evaluateAdjustments(state, unrealizedQty);
  }

  async handleOrderUpdate(order) {
    if (!order || !order.OrderID || !order.Legs || !Array.isArray(order.Legs) || order.Legs.length === 0) {
      return;
    }

    // Resolve order waiters for all legs
    for (const orderLeg of order.Legs) {
      const legSymbol = (orderLeg.Symbol || '').toUpperCase();
      if (legSymbol) {
        this.resolveOrderWaiters(legSymbol, order);
      }
    }

    // Find SELL leg
    const leg = order.Legs.find(l => {
      const sym = (l.Symbol || '').toUpperCase();
      const side = (l.BuyOrSell || '').toUpperCase();
      return sym && side === 'SELL';
    });
    if (!leg) return;

    const symbol = (leg.Symbol || '').toUpperCase();
    if (!symbol) return;

    // Process StopLimit orders and Market SELL orders (from auto-sell)
    const orderType = this.getOrderType(order);
    const isStopLimit = orderType === 'STOPLIMIT';
    const isMarketSell = orderType === 'MARKET' && (leg.BuyOrSell || '').toUpperCase() === 'SELL';
    
    if (!isStopLimit && !isMarketSell) return;

    const orderId = order.OrderID;
    const status = (order.Status || '').toUpperCase();
    
    console.log(`📥 StopLimitService: Received ${orderType} SELL order update for ${symbol} - OrderID: ${orderId}, Status: ${status}`);

    // Try to get or create state for this symbol
    let state = this.trackedPositions.get(symbol);
    if (!state && this.positionsCache && typeof this.positionsCache.get === 'function') {
      const position = this.positionsCache.get(symbol);
      if (position) {
        console.log(`🔄 StopLimitService: Bootstrapping position tracking for ${symbol} from order update`);
        try {
          await this.handlePositionUpdate(position);
        } catch (err) {
          console.error(`❌ StopLimitService: Failed to bootstrap position tracking for ${symbol}:`, err);
        }
        state = this.trackedPositions.get(symbol);
      }
    }

    // If no state exists, we can't track it (no active position)
    if (!state) {
      console.log(`ℹ️ StopLimitService: No tracked state for ${symbol}, order ${orderId} will be linked when position is detected`);
      return;
    }

    const previousOrderId = state.orderId;
    state.orderStatus = status;

    // CRITICAL: Always link the order if it's active or queued, regardless of previous state
    // This ensures orders from websocket are immediately linked
    if (ACTIVE_ORDER_STATUSES.has(status) || this.isQueuedStatus(status) || status === 'ACK') {
      const wasLinked = previousOrderId === orderId;
      this.updateStateFromOrder(state, orderId, order, leg, status);
      
      if (!wasLinked) {
        console.log(`🔗 StopLimitService: LINKED StopLimit order ${orderId} to ${symbol} (status: ${status}) - Order now tracked`);
      } else {
        console.log(`🔄 StopLimitService: Updated StopLimit order ${orderId} for ${symbol} (status: ${status})`);
      }
      
      // Clear pending flags since we now have a confirmed order
      state.pendingCreate = false;
      state.pendingUpdate = false;
      return; // Order is active, no further action needed
    } 
    
    // Handle non-active statuses
    if (NON_ACTIVE_STATUSES.has(status)) {
      // CRITICAL: Handle REJ status even if order wasn't previously linked (newly created orders)
      if (status === 'REJ' && isStopLimit) {
        // Check if this order matches our tracked order (by orderId or by symbol if we're waiting for it)
        const isOurOrder = previousOrderId === orderId || 
                          (state.stageIndex >= 0 && !state.orderId && state.pendingCreate) ||
                          (state.orderId === orderId);
        
        if (isOurOrder) {
          console.log(`❌ StopLimitService: StopLimit order ${orderId} for ${symbol} was REJECTED. Resetting state to allow retry.`);
          
          // Update state to reflect rejection
          state.orderStatus = 'REJ';
          state.pendingCreate = false;
          state.pendingUpdate = false;
          
          // For initial orders (stageIndex 0), reset to allow retry
          // For stage updates (stageIndex > 0), keep orderId but revert stage
          if (state.stageIndex === 0) {
            // Initial order rejected - reset state to allow retry
            state.orderId = null;
            state.stageIndex = -1; // Reset to allow retry creation
            console.log(`🔄 StopLimitService: Initial order rejected for ${symbol}, reset state to allow retry`);
          } else {
            // Stage update rejected - keep orderId but revert stage
            state.orderId = orderId;
            state.stageIndex = Math.max(0, state.stageIndex - 1);
            console.log(`🔄 StopLimitService: Stage update rejected for ${symbol}, reverted to stage ${state.stageIndex}`);
          }
          
          state.updatedAt = Date.now();
          
          // Try to sync prices from the rejected order if available
          const actualStopPrice = this.parseNumber(order.StopPrice || leg.StopPrice);
          const actualLimitPrice = this.parseNumber(order.LimitPrice || leg.LimitPrice);
          const cachedOrder = this.ordersCache.get(orderId);
          if (cachedOrder) {
            const cachedLeg = cachedOrder.Legs?.find(l => 
              (l.Symbol || '').toUpperCase() === symbol && 
              (l.BuyOrSell || '').toUpperCase() === 'SELL'
            );
            if (cachedLeg) {
              const cachedStop = this.parseNumber(cachedOrder.StopPrice || cachedLeg.StopPrice);
              const cachedLimit = this.parseNumber(cachedOrder.LimitPrice || cachedLeg.LimitPrice);
              if (cachedStop !== null && cachedLimit !== null) {
                state.lastStopPrice = this.roundPrice(cachedStop);
                state.lastLimitPrice = this.roundPrice(cachedLimit);
              }
            }
          } else if (actualStopPrice !== null && actualLimitPrice !== null) {
            state.lastStopPrice = this.roundPrice(actualStopPrice);
            state.lastLimitPrice = this.roundPrice(actualLimitPrice);
          }
          
          // Don't return - continue to check for fallback orders or retry logic
        }
      }
      
      // For Market SELL orders, check if filled even if not previously linked
      if (isMarketSell && (status === 'FLL' || status === 'FIL')) {
        if (state) {
          // Position is tracked, calculate P&L
          console.log(`✅ StopLimitService: Market SELL order ${orderId} for ${symbol} filled (status ${status}) – calculating P&L and marking as sold.`);
          
          // Calculate P&L from the filled order
          const sellPrice = this.parseNumber(order.FilledPrice || leg.FilledPrice || order.Price || leg.Price);
          const quantity = state.quantity || this.parseNumber(leg.ExecQuantity || leg.QuantityRemaining || order.Quantity);
          const avgPrice = state.avgPrice;
          
          if (sellPrice && avgPrice && quantity) {
            const pnlPerShare = this.roundPrice(sellPrice - avgPrice);
            const totalPnL = this.roundPrice(pnlPerShare * quantity);
            
            // Store sold position with P&L information
            this.soldPositions.set(symbol, {
              symbol,
              positionId: state.positionId,
              accountId: state.accountId,
              groupKey: state.groupKey,
              avgPrice,
              quantity,
              sellPrice,
              pnlPerShare,
              totalPnL,
              orderId,
              soldAt: Date.now(),
              createdAt: state.createdAt,
              stageIndex: state.stageIndex,
              lastStopPrice: state.lastStopPrice,
              lastLimitPrice: state.lastLimitPrice
            });
            
            console.log(`💰 StopLimitService: ${symbol} SOLD (Market) - Avg: $${avgPrice.toFixed(2)}, Sell: $${sellPrice.toFixed(2)}, Qty: ${quantity}, P&L/Share: $${pnlPerShare.toFixed(2)}, Total P&L: $${totalPnL.toFixed(2)}`);
          }
          
          // Verify position is actually closed before cleanup
          if (!this.hasActivePosition(symbol)) {
            this.cleanupPosition(symbol);
          }
        }
        return;
      }
      
      // CRITICAL: For StopLimit orders, check if filled even if not previously linked
      // This handles cases where the order was filled but state wasn't updated yet
      if (isStopLimit && (status === 'FLL' || status === 'FIL')) {
        // If we're tracking this position, handle the filled order regardless of previous linking
        // This ensures we catch filled orders even if they weren't linked to state yet
        const isOurOrder = previousOrderId === orderId || 
                          state.orderId === orderId ||
                          (state.stageIndex >= 0); // We're tracking this position, so any StopLimit SELL order for it is ours
        
        if (isOurOrder && state) {
          console.log(`✅ StopLimitService: StopLimit order ${orderId} for ${symbol} filled (status ${status}) – calculating P&L and marking as sold.`);
          
          // Update state to reflect filled status
          state.orderId = orderId;
          state.orderStatus = status;
          state.pendingCreate = false;
          state.pendingUpdate = false;
          
          // Calculate P&L from the filled order
          // For StopLimit orders, prefer FilledPrice then LimitPrice
          const sellPrice = this.parseNumber(
            order.FilledPrice || 
            leg.FilledPrice || 
            order.LimitPrice || 
            leg.LimitPrice ||
            order.Price || 
            leg.Price
          );
          const quantity = state.quantity || this.parseNumber(leg.ExecQuantity || leg.QuantityRemaining || order.Quantity);
          const avgPrice = state.avgPrice;
          
          if (sellPrice && avgPrice && quantity) {
            const pnlPerShare = this.roundPrice(sellPrice - avgPrice);
            const totalPnL = this.roundPrice(pnlPerShare * quantity);
            
            // Store sold position with P&L information
            this.soldPositions.set(symbol, {
              symbol,
              positionId: state.positionId,
              accountId: state.accountId,
              groupKey: state.groupKey,
              avgPrice,
              quantity,
              sellPrice,
              pnlPerShare,
              totalPnL,
              orderId,
              soldAt: Date.now(),
              createdAt: state.createdAt,
              stageIndex: state.stageIndex,
              lastStopPrice: state.lastStopPrice,
              lastLimitPrice: state.lastLimitPrice
            });
            
            console.log(`💰 StopLimitService: ${symbol} SOLD (StopLimit) - Avg: $${avgPrice.toFixed(2)}, Sell: $${sellPrice.toFixed(2)}, Qty: ${quantity}, P&L/Share: $${pnlPerShare.toFixed(2)}, Total P&L: $${totalPnL.toFixed(2)}`);
          } else {
            console.warn(`⚠️ StopLimitService: Could not calculate P&L for ${symbol} - sellPrice: ${sellPrice}, avgPrice: ${avgPrice}, quantity: ${quantity}`);
          }
          
          // Verify position is actually closed before cleanup
          if (!this.hasActivePosition(symbol)) {
            this.cleanupPosition(symbol);
          } else {
            console.log(`⚠️ StopLimitService: StopLimit order ${orderId} filled but position ${symbol} still active - may be partial fill, keeping tracking`);
          }
          return;
        }
      }
      
      if (previousOrderId === orderId) {
        console.log(`ℹ️ StopLimitService: ${isStopLimit ? 'StopLimit' : 'Market'} order ${orderId} for ${symbol} is no longer active (status ${status})`);
        state.orderId = null;
        state.orderStatus = status;
        state.updatedAt = Date.now();
        state.pendingCreate = false;
        state.pendingUpdate = false;

        if (status === 'FLL' || status === 'FIL') {
          console.log(`✅ StopLimitService: StopLimit order ${orderId} for ${symbol} filled (status ${status}) – calculating P&L and marking as sold.`);
          
          // Calculate P&L from the filled order
          // For Market orders, use FilledPrice or Price; for StopLimit, prefer FilledPrice then LimitPrice
          const sellPrice = this.parseNumber(
            order.FilledPrice || 
            leg.FilledPrice || 
            (isStopLimit ? (order.LimitPrice || leg.LimitPrice) : null) ||
            order.Price || 
            leg.Price
          );
          const quantity = state.quantity || this.parseNumber(leg.ExecQuantity || leg.QuantityRemaining || order.Quantity);
          const avgPrice = state.avgPrice;
          
          if (sellPrice && avgPrice && quantity) {
            const pnlPerShare = this.roundPrice(sellPrice - avgPrice);
            const totalPnL = this.roundPrice(pnlPerShare * quantity);
            
            // Store sold position with P&L information
            this.soldPositions.set(symbol, {
              symbol,
              positionId: state.positionId,
              accountId: state.accountId,
              groupKey: state.groupKey,
              avgPrice,
              quantity,
              sellPrice,
              pnlPerShare,
              totalPnL,
              orderId,
              soldAt: Date.now(),
              createdAt: state.createdAt,
              stageIndex: state.stageIndex,
              lastStopPrice: state.lastStopPrice,
              lastLimitPrice: state.lastLimitPrice
            });
            
            console.log(`💰 StopLimitService: ${symbol} SOLD - Avg: $${avgPrice.toFixed(2)}, Sell: $${sellPrice.toFixed(2)}, Qty: ${quantity}, P&L/Share: $${pnlPerShare.toFixed(2)}, Total P&L: $${totalPnL.toFixed(2)}`);
          } else {
            console.warn(`⚠️ StopLimitService: Could not calculate P&L for ${symbol} - sellPrice: ${sellPrice}, avgPrice: ${avgPrice}, quantity: ${quantity}`);
          }
          
          // Verify position is actually closed before cleanup
          if (!this.hasActivePosition(symbol)) {
            this.cleanupPosition(symbol);
          } else {
            console.log(`⚠️ StopLimitService: Order ${orderId} filled but position ${symbol} still active - may be partial fill, keeping tracking`);
          }
          return;
        } else if (status === 'OUT') {
          // OUT status handling (order expired)
          
          const fallback = this.findLatestRelevantOrder(symbol);
          if (!fallback) {
            console.log(`ℹ️ StopLimitService: No follow-up order found for ${symbol} after ${status}; keeping position tracked.`);
          } else {
            const fallbackStatus = (fallback.status || '').toUpperCase();
            if (this.isQueuedStatus(fallbackStatus) || fallbackStatus === 'ACK') {
              console.log(`ℹ️ StopLimitService: Found fallback order ${fallback.orderId} with status ${fallbackStatus} for ${symbol}; re-linking.`);
              this.updateStateFromOrder(state, fallback.orderId, fallback.order, fallback.leg, fallbackStatus);
            } else if (fallbackStatus === 'FLL' || fallbackStatus === 'FIL') {
              console.log(`✅ StopLimitService: Fallback order ${fallback.orderId} is filled; calculating P&L and marking as sold.`);
              
              // Calculate P&L from the fallback order
              const sellPrice = this.parseNumber(fallback.order.FilledPrice || fallback.leg.FilledPrice || fallback.order.LimitPrice || fallback.leg.LimitPrice);
              const quantity = state.quantity || this.parseNumber(fallback.leg.ExecQuantity || fallback.leg.QuantityRemaining || fallback.order.Quantity);
              const avgPrice = state.avgPrice;
              
              if (sellPrice && avgPrice && quantity) {
                const pnlPerShare = this.roundPrice(sellPrice - avgPrice);
                const totalPnL = this.roundPrice(pnlPerShare * quantity);
                
                // Store sold position with P&L information
                this.soldPositions.set(symbol, {
                  symbol,
                  positionId: state.positionId,
                  accountId: state.accountId,
                  groupKey: state.groupKey,
                  avgPrice,
                  quantity,
                  sellPrice,
                  pnlPerShare,
                  totalPnL,
                  orderId: fallback.orderId,
                  soldAt: Date.now(),
                  createdAt: state.createdAt,
                  stageIndex: state.stageIndex,
                  lastStopPrice: state.lastStopPrice,
                  lastLimitPrice: state.lastLimitPrice
                });
                
                console.log(`💰 StopLimitService: ${symbol} SOLD (fallback) - Avg: $${avgPrice.toFixed(2)}, Sell: $${sellPrice.toFixed(2)}, Qty: ${quantity}, P&L/Share: $${pnlPerShare.toFixed(2)}, Total P&L: $${totalPnL.toFixed(2)}`);
              }
              
              this.cleanupPosition(symbol);
            }
          }
        }

        if (status !== 'FLL' && status !== 'FIL') {
          if (!this.analysisEnabled) {
            // Do nothing else when automation is disabled; cleanup will happen via cache refresh.
          } else if (!this.hasActivePosition(symbol)) {
            this.cleanupPosition(symbol);
          } else {
            // Retry logic: if order was rejected or we don't have an active order, try to create/ensure one
            const orderStatusUpper = (state.orderStatus || '').toUpperCase();
            const shouldRetry = 
              orderStatusUpper === 'REJ' || // Order was rejected
              (!state.orderId && !state.pendingCreate && !state.pendingUpdate); // No order and not pending
            
            if (shouldRetry) {
              try {
                // Small delay before retry to avoid rapid retries
                await new Promise(resolve => setTimeout(resolve, 1000));
                await this.ensureInitialOrder(state);
              } catch (err) {
                console.error(`❌ StopLimitService: Failed to ensure StopLimit after ${status} for ${symbol}:`, err);
              }
            }
          }
        }
      }
    }
  }

  cleanupPosition(symbol) {
    if (this.trackedPositions.has(symbol)) {
      console.log(`🧹 StopLimitService: Removing tracking for ${symbol} (position closed)`);
      this.trackedPositions.delete(symbol);
    }
    this.clearOrderWaiters(symbol);
    // Note: soldPositions are kept for display purposes, not cleaned up
  }

  pruneInactiveSymbols(activeSymbols) {
    const activeSet = activeSymbols instanceof Set ? activeSymbols : new Set(activeSymbols);
    for (const symbol of Array.from(this.trackedPositions.keys())) {
      if (!activeSet.has(symbol)) {
        this.cleanupPosition(symbol);
      }
    }
  }

  setAnalysisEnabled(enabled) {
    const normalized = !!enabled;
    if (this.analysisEnabled === normalized) {
      return this.analysisEnabled;
    }

    this.analysisEnabled = normalized;
    this.analysisChangedAt = Date.now();

    if (!normalized) {
      // When disabling, stop all pending operations
      for (const state of this.trackedPositions.values()) {
        state.pendingCreate = false;
        state.pendingUpdate = false;
      }
      // Aggressively clean up inactive positions when disabling
      this.refreshTrackedPositionsFromCaches();
    } else {
      // When enabling, clean up any inactive positions before starting
      // This ensures we don't re-add closed positions
      this.refreshTrackedPositionsFromCaches();
    }

    console.log(`⚙️ StopLimitService: Automation ${normalized ? 'enabled' : 'disabled'} (tracked positions: ${this.trackedPositions.size})`);
    return this.analysisEnabled;
  }

  isAnalysisEnabled() {
    return this.analysisEnabled;
  }

  getAnalysisChangedAt() {
    return this.analysisChangedAt;
  }

  getActivePositionSymbols() {
    if (!this.positionsCache || typeof this.positionsCache.values !== 'function') {
      return null;
    }

    const activeSymbols = new Set();
    for (const position of this.positionsCache.values()) {
      const symbol = (position?.Symbol || '').toUpperCase();
      if (!symbol) continue;

      const quantity = this.parseNumber(position?.Quantity);
      if (!quantity || quantity <= 0) continue;

      const longShort = (position?.LongShort || '').toUpperCase();
      if (longShort && longShort !== 'LONG') continue;

      activeSymbols.add(symbol);
    }

    return activeSymbols;
  }

  hasActivePosition(symbol) {
    if (!symbol) return false;
    const normalized = symbol.toUpperCase();

    if (!this.positionsCache || typeof this.positionsCache.get !== 'function') {
      // Assume active when no cache is available to avoid false negatives
      return true;
    }

    const position = this.positionsCache.get(normalized);
    if (!position) return false;

    const quantity = this.parseNumber(position?.Quantity);
    if (!quantity || quantity <= 0) return false;

    const longShort = (position?.LongShort || '').toUpperCase();
    if (longShort && longShort !== 'LONG') return false;

    return true;
  }

  refreshTrackedPositionsFromCaches() {
    // Get current active symbols from positions cache
    const activeSymbols = this.getActivePositionSymbols();
    
    // Cleanup positions that are no longer in active symbols
    if (activeSymbols) {
      for (const symbol of Array.from(this.trackedPositions.keys())) {
        if (!activeSymbols.has(symbol)) {
          console.log(`🧹 StopLimitService: Removing ${symbol} - not in active positions cache`);
          this.cleanupPosition(symbol);
        }
      }
    }

    // Validate each remaining tracked position individually
    // This ensures we catch positions that might have closed but weren't removed from cache yet
    for (const [symbol, state] of Array.from(this.trackedPositions.entries())) {
      // Verify position is still active
      if (!this.hasActivePosition(symbol)) {
        console.log(`🧹 StopLimitService: Removing ${symbol} during refresh - position no longer active`);
        this.cleanupPosition(symbol);
        continue;
      }

      // Verify position exists in cache with valid quantity
      if (this.positionsCache && typeof this.positionsCache.get === 'function') {
        const position = this.positionsCache.get(symbol);
        if (!position) {
          console.log(`🧹 StopLimitService: Removing ${symbol} during refresh - not in positionsCache`);
          this.cleanupPosition(symbol);
          continue;
        }

        const quantity = this.parseNumber(position?.Quantity);
        if (!quantity || quantity <= 0) {
          console.log(`🧹 StopLimitService: Removing ${symbol} during refresh - quantity is ${quantity}`);
          this.cleanupPosition(symbol);
          continue;
        }

        const longShort = (position?.LongShort || '').toUpperCase();
        if (longShort && longShort !== 'LONG') {
          console.log(`🧹 StopLimitService: Removing ${symbol} during refresh - not LONG (${longShort})`);
          this.cleanupPosition(symbol);
          continue;
        }
      }

      // Position is valid, realign with orders
      this.realignStateWithOrders(state);
    }
  }

  /**
   * Comprehensive periodic validation - ensures all tracked positions have orders properly linked.
   * This is a critical safety check that should be called regularly.
   */
  validateAllTrackedPositions() {
    if (!this.analysisEnabled) {
      // Still cleanup inactive positions even when disabled
      this.refreshTrackedPositionsFromCaches();
      return;
    }

    console.log(`🔍 StopLimitService: Starting comprehensive validation of all tracked positions (${this.trackedPositions.size} positions)...`);
    
    let validated = 0;
    let linked = 0;
    let issues = 0;
    let cleaned = 0;

    // First pass: Cleanup inactive positions
    const symbolsToCleanup = [];
    for (const [symbol, state] of this.trackedPositions.entries()) {
      if (!this.hasActivePosition(symbol)) {
        symbolsToCleanup.push(symbol);
        continue;
      }
    }
    
    for (const symbol of symbolsToCleanup) {
      console.log(`🧹 StopLimitService: VALIDATION CLEANUP - Removing inactive position ${symbol}`);
      this.cleanupPosition(symbol);
      cleaned++;
    }

    // Second pass: Validate orders for remaining positions
    for (const [symbol, state] of this.trackedPositions.entries()) {
      validated++;
      
      // Double-check position is still active (might have closed during validation)
      if (!this.hasActivePosition(symbol)) {
        console.log(`🧹 StopLimitService: VALIDATION CLEANUP - Removing ${symbol} (closed during validation)`);
        this.cleanupPosition(symbol);
        cleaned++;
        continue;
      }
      
      // Skip if we have a valid order linked
      if (state.orderId && state.orderStatus) {
        const cachedOrder = this.ordersCache.get(state.orderId);
        if (cachedOrder) {
          const status = (cachedOrder.Status || '').toUpperCase();
          if (ACTIVE_ORDER_STATUSES.has(status) || this.isQueuedStatus(status) || status === 'ACK') {
            // Order is valid, continue
            continue;
          }
        }
      }

      // Order might be missing or invalid - validate
      const validation = this.validateExistingStopLimitOrder(symbol);
      
      if (validation.hasOrder) {
        // Found an order that should be linked
        if (!state.orderId || state.orderId !== validation.orderId) {
          console.log(`🔧 StopLimitService: VALIDATION FIX - Linking order ${validation.orderId} to ${symbol} (was: ${state.orderId || 'none'})`);
          this.updateStateFromOrder(state, validation.orderId, validation.order, validation.leg, validation.status);
          linked++;
        }
      } else if (state.stageIndex >= 0) {
        // We think we created an order but can't find it
        issues++;
        console.warn(`⚠️ StopLimitService: VALIDATION ISSUE - ${symbol} has stageIndex=${state.stageIndex} but no order found in cache. State: orderId=${state.orderId || 'none'}, status=${state.orderStatus || 'none'}, pendingCreate=${state.pendingCreate}`);
        
        // If it's been more than 30 seconds since creation attempt, something might be wrong
        if (state.lastOrderCreateAttempt && (Date.now() - state.lastOrderCreateAttempt) > 30000) {
          console.warn(`⚠️ StopLimitService: ${symbol} order creation was ${Math.round((Date.now() - state.lastOrderCreateAttempt) / 1000)}s ago but order not found. May need manual intervention.`);
        }
      }
    }

    console.log(`✅ StopLimitService: Validation complete - ${validated} positions checked, ${linked} orders linked, ${cleaned} positions cleaned up, ${issues} potential issues`);
  }

  realignStateWithOrders(state) {
    if (!state) return;

    // Use comprehensive validation instead of just findActiveStopLimitOrder
    // This ensures we catch orders with any valid status, not just "active" ones
    const validation = this.validateExistingStopLimitOrder(state.symbol);
    
    if (validation.hasOrder) {
      const statusUpper = validation.status || '';
      const currentStatusUpper = (state.orderStatus || '').toUpperCase();
      
      // Always update if we don't have an orderId, or if orderId/status doesn't match
      // This ensures orders are immediately linked when found
      if (
        !state.orderId ||
        state.orderId !== validation.orderId ||
        currentStatusUpper !== statusUpper
      ) {
        this.updateStateFromOrder(state, validation.orderId, validation.order, validation.leg, validation.status);
        console.log(`🔗 StopLimitService: Realigned ${state.symbol} with order ${validation.orderId} (status: ${statusUpper}, source: ${validation.source})`);
      }
      
      // Clear pending flags since we have a confirmed order
      if (validation.status && (ACTIVE_ORDER_STATUSES.has(validation.status) || this.isQueuedStatus(validation.status) || validation.status === 'ACK')) {
        state.pendingCreate = false;
      }
      return;
    }

    // No order found - only clear if we haven't created one recently
    // If stageIndex >= 0, we created an order and are waiting for websocket
    const recentlyCreated = state.lastOrderCreateAttempt && (Date.now() - state.lastOrderCreateAttempt) < 30000; // 30 seconds
    
    if ((state.orderId || state.orderStatus) && state.stageIndex < 0 && !recentlyCreated) {
      // No order found and we haven't created one - clear the state
      state.orderId = null;
      state.orderStatus = null;
      state.pendingUpdate = false;
      state.updatedAt = Date.now();
    } else if (state.stageIndex >= 0 && !state.orderId) {
      // We created an order but don't have orderId yet - keep waiting
      console.log(`⏳ StopLimitService: ${state.symbol} has stageIndex=${state.stageIndex} but no orderId yet - waiting for websocket update (${recentlyCreated ? 'recently created' : 'may need validation'})`);
    }
  }

  resolveGroup(price) {
    for (const [key, config] of Object.entries(this.groupConfigs)) {
      const { minExclusive, maxInclusive } = config.priceRange;
      if (price > minExclusive && price <= maxInclusive) {
        console.log(`📊 StopLimitService: Resolved group ${key} for price ${price} (range: ${minExclusive} < price <= ${maxInclusive}, initialOffset=${config.initialOffset})`);
        return key;
      }
    }
    console.warn(`⚠️ StopLimitService: No group found for price ${price}`);
    return null;
  }

  async ensureInitialOrder(state) {
    if (!this.analysisEnabled) {
      return;
    }

    if (state.pendingCreate) {
      console.log(`⏸️ StopLimitService: Order creation already in progress for ${state.symbol}, skipping duplicate attempt`);
      return;
    }

    // If we already have an orderId set (even if not yet in cache), don't create another
    if (state.orderId) {
      // Verify the order still exists in cache or is still valid
      const cachedOrder = this.ordersCache.get(state.orderId);
      if (cachedOrder) {
        const status = (cachedOrder.Status || '').toUpperCase();
        if (ACTIVE_ORDER_STATUSES.has(status) || this.isQueuedStatus(status)) {
          // Order exists and is active, update state and return
          const leg = cachedOrder.Legs?.find(l => 
            (l.Symbol || '').toUpperCase() === state.symbol && 
            (l.BuyOrSell || '').toUpperCase() === 'SELL'
          );
          if (leg) {
            this.updateStateFromOrder(state, state.orderId, cachedOrder, leg, status);
            console.log(`✅ StopLimitService: Order ${state.orderId} for ${state.symbol} found in cache (status: ${status}), skipping creation`);
            return;
          }
        }
      }
      // If orderId exists but order not in cache yet (websocket delay), wait a bit
      // Don't create duplicate - the websocket update will arrive soon
      if (!cachedOrder && state.stageIndex >= 0) {
        console.log(`⏳ StopLimitService: Order ${state.orderId} for ${state.symbol} not yet in cache (stageIndex=${state.stageIndex}), waiting for websocket update...`);
        return;
      }
      // If orderId exists but stageIndex is -1, something went wrong - check if order exists
      if (!cachedOrder && state.stageIndex === -1) {
        console.log(`⚠️ StopLimitService: OrderId ${state.orderId} exists for ${state.symbol} but stageIndex is -1, checking for existing order...`);
        // Fall through to check for existing orders
      }
    }

    // Prevent rapid duplicate creation attempts (within 5 seconds)
    const now = Date.now();
    if (state.lastOrderCreateAttempt && (now - state.lastOrderCreateAttempt) < 5000) {
      const secondsSince = ((now - state.lastOrderCreateAttempt) / 1000).toFixed(1);
      console.log(`⏸️ StopLimitService: Recent order creation attempt for ${state.symbol} ${secondsSince}s ago, preventing duplicate (orderId: ${state.orderId || 'none'}, stageIndex: ${state.stageIndex})`);
      // Even if we're preventing duplicate creation, try to realign with existing orders
      this.realignStateWithOrders(state);
      return;
    }

    // CRITICAL SAFETY CHECK: Before creating, comprehensively validate if order exists
    // This is a multi-layer defense to prevent duplicate order creation
    console.log(`🔒 StopLimitService: Performing comprehensive order validation for ${state.symbol} before creation...`);
    
    // Step 1: Realign state with orders cache
    this.realignStateWithOrders(state);
    
    // Step 2: Check if we already have an order linked in state
    if (state.orderId || state.stageIndex >= 0) {
      console.log(`✅ StopLimitService: Order already exists in state for ${state.symbol} (orderId: ${state.orderId || 'none'}, stageIndex: ${state.stageIndex}), skipping creation`);
      return;
    }

    // Step 3: Comprehensive validation - check all possible sources
    const validation = this.validateExistingStopLimitOrder(state.symbol);
    console.log(`🔍 StopLimitService: Order validation for ${state.symbol}:`, {
      hasOrder: validation.hasOrder,
      orderId: validation.orderId,
      status: validation.status,
      source: validation.source,
      checks: validation.checks
    });

    if (validation.hasOrder) {
      // Order exists! Link it immediately and skip creation
      this.updateStateFromOrder(state, validation.orderId, validation.order, validation.leg, validation.status);
      console.log(`🛡️ StopLimitService: SAFETY CHECK PASSED - Existing StopLimit order ${validation.orderId} found for ${state.symbol} (status: ${validation.status}, source: ${validation.source}). SKIPPING CREATION to prevent duplicate.`);
      return;
    }

    // Step 4: Final check - if stageIndex >= 0, we've already created an order
    if (state.stageIndex >= 0) {
      console.log(`⏸️ StopLimitService: StageIndex >= 0 for ${state.symbol} (stageIndex=${state.stageIndex}, orderId=${state.orderId || 'none'}), skipping creation`);
      return;
    }

    // Step 5: All checks passed - safe to create
    console.log(`✅ StopLimitService: All validation checks passed for ${state.symbol}. No existing order found. Proceeding with creation.`);

    // Set flags BEFORE async operations to prevent race conditions
    state.pendingCreate = true;
    state.lastOrderCreateAttempt = Date.now();
    
    try {
      const config = this.groupConfigs[state.groupKey];
      if (!config) {
        console.error(`❌ StopLimitService: No config found for group ${state.groupKey}`);
        state.pendingCreate = false;
        return;
      }
      
      console.log(`🔍 StopLimitService: Group ${state.groupKey} config - initialOffset=${config.initialOffset}, avgPrice=${state.avgPrice}`);
      const offsets = this.calculateStopAndLimit(state.avgPrice, config.initialOffset);
      if (!offsets) {
        console.warn(`⚠️ StopLimitService: Could not calculate initial stop/limit for ${state.symbol}`);
        state.pendingCreate = false;
        return;
      }

      const { stopPrice, limitPrice } = offsets;
      const stopDiffFromAvg = this.roundPrice(state.avgPrice - stopPrice);
      console.log(`🛡️ StopLimitService: Creating initial StopLimit for ${state.symbol} (${config.label}) - stop ${stopPrice}, limit ${limitPrice} (avgPrice=${state.avgPrice}, initialOffset=${config.initialOffset}, stopDiffFromAvg=${stopDiffFromAvg})`);

      // Delete any existing SELL orders (but not the one we're about to create, if any)
      await this.deleteExistingSellOrders(state.symbol, state.orderId);

      const body = {
        symbol: state.symbol,
        side: 'SELL',
        order_type: 'StopLimit',
        quantity: Math.max(1, Math.round(state.quantity)),
        stop_price: stopPrice,
        limit_price: limitPrice
      };

      console.log(`📤 StopLimitService: Sending order creation request for ${state.symbol} (stop=${stopPrice}, limit=${limitPrice})`);
      const response = await this.postOrder(body);
      
      if (response.success) {
        // Always set stageIndex to 0 on success to prevent duplicate creation
        // even if orderId extraction failed (websocket will provide it later)
        state.stageIndex = 0;
        state.lastStopPrice = stopPrice;
        state.lastLimitPrice = limitPrice;
        if (response.orderId) {
          state.orderId = response.orderId;
          console.log(`✅ StopLimitService: Initial StopLimit order created for ${state.symbol} (order_id=${response.orderId}, stop=${stopPrice}, limit=${limitPrice})`);
        } else {
          console.warn(`⚠️ StopLimitService: Initial StopLimit created for ${state.symbol} but no order_id returned in response. StageIndex set to 0 to prevent duplicates. Will search for order in cache. Response: ${JSON.stringify(response.responseData || {}).substring(0, 200)}`);
          // Try to find the order in cache by matching stop/limit prices
          // Wait a moment for websocket to receive the order
          await new Promise(resolve => setTimeout(resolve, 500));
          const foundOrder = this.findActiveStopLimitOrder(state.symbol);
          if (foundOrder) {
            const foundStop = this.parseNumber(foundOrder.order?.StopPrice || foundOrder.leg?.StopPrice);
            const foundLimit = this.parseNumber(foundOrder.order?.LimitPrice || foundOrder.leg?.LimitPrice);
            // Match by prices to ensure it's the order we just created
            if (this.isApproximatelyEqual(foundStop, stopPrice) && this.isApproximatelyEqual(foundLimit, limitPrice)) {
              this.updateStateFromOrder(state, foundOrder.orderId, foundOrder.order, foundOrder.leg, foundOrder.order?.Status);
              console.log(`✅ StopLimitService: Found and linked newly created order ${foundOrder.orderId} for ${state.symbol} by price matching`);
            }
          }
        }
        state.updatedAt = Date.now();
        console.log(`🔒 StopLimitService: Order creation complete for ${state.symbol}. State locked: stageIndex=${state.stageIndex}, orderId=${state.orderId || 'pending'}, lastOrderCreateAttempt=${state.lastOrderCreateAttempt ? new Date(state.lastOrderCreateAttempt).toISOString() : 'none'}`);
        
        // Try to realign state with orders cache to ensure we have the latest order info
        this.realignStateWithOrders(state);
      } else {
        console.error(`❌ StopLimitService: Failed to create StopLimit for ${state.symbol}: ${response.error || response.notifyStatus}`);
        // Reset stageIndex on failure so we can retry
        state.stageIndex = -1;
        if (await this.maybeAttachExistingStopLimit(state, 'create-rejected')) {
          console.log(`ℹ️ StopLimitService: Linked existing StopLimit order for ${state.symbol} after rejection.`);
        }
      }
    } catch (err) {
      console.error(`❌ StopLimitService: Error creating StopLimit for ${state.symbol}:`, err);
      // Reset stageIndex on error so we can retry
      state.stageIndex = -1;
      if (await this.maybeAttachExistingStopLimit(state, 'create-error')) {
        console.log(`ℹ️ StopLimitService: Linked existing StopLimit order for ${state.symbol} after error.`);
      }
    } finally {
      state.pendingCreate = false;
    }
  }

  async evaluateAdjustments(state, unrealizedQty) {
    if (!this.analysisEnabled) {
      return;
    }

    if (typeof unrealizedQty !== 'number' || Number.isNaN(unrealizedQty)) {
      return;
    }

    const config = this.groupConfigs[state.groupKey];
    if (!config) return;

    // Check auto-sell trigger first
    if (unrealizedQty >= config.autoSellTrigger && !state.autoSellExecuted) {
      await this.executeAutoSell(state);
      return;
    }

    // Find the highest stage that should be active based on unrealized P&L
    let targetStageIndex = 0; // Start with initial stage (stageIndex 0)
    
    // Check each stage to find the highest one that the unrealizedQty qualifies for
    for (let index = 0; index < config.stages.length; index += 1) {
      const stage = config.stages[index];
      if (unrealizedQty >= stage.trigger) {
        targetStageIndex = index + 1; // stageNumber = index + 1
      } else {
        // Stages are in ascending order, so we can break once we find one that doesn't qualify
        break;
      }
    }

    // Only update if we need to advance to a higher stage
    if (targetStageIndex > state.stageIndex) {
      const targetStage = config.stages[targetStageIndex - 1];
      console.log(`📊 StopLimitService: ${state.symbol} unrealizedQty=${unrealizedQty.toFixed(2)} qualifies for stage ${targetStageIndex} (${targetStage.label}, trigger=${targetStage.trigger}), current stageIndex=${state.stageIndex}`);
      await this.updateStopLimitStage(state, targetStage.stopOffset, targetStage.label, targetStageIndex);
    } else if (targetStageIndex < state.stageIndex) {
      // If unrealizedQty has dropped below the current stage, we should stay at the current stage
      // (don't downgrade stages - once we've reached a stage, we stay there)
      console.log(`📊 StopLimitService: ${state.symbol} unrealizedQty=${unrealizedQty.toFixed(2)} is below current stage ${state.stageIndex}, but keeping current stage (no downgrade)`);
    } else {
      // Already at the correct stage
      console.log(`📊 StopLimitService: ${state.symbol} unrealizedQty=${unrealizedQty.toFixed(2)} matches current stage ${state.stageIndex} (${config.stages[state.stageIndex - 1]?.label || 'Initial'})`);
    }
  }

  async updateStopLimitStage(state, stopOffset, label, stageNumber) {
    if (!this.analysisEnabled) {
      return;
    }

    if (this.isQueuedStatus(state.orderStatus)) {
      console.log(`⏳ StopLimitService: StopLimit order for ${state.symbol} is queued (${state.orderStatus}); skipping update to stage ${stageNumber}`);
      return;
    }

    if (state.pendingUpdate) {
      return;
    }

    const offsets = this.calculateStopAndLimit(state.avgPrice, stopOffset);
    if (!offsets) {
      console.warn(`⚠️ StopLimitService: Cannot calculate offsets for ${state.symbol} stage ${stageNumber}`);
      return;
    }

    let { stopPrice, limitPrice } = offsets;
    if (this.isApproximatelyEqual(stopPrice, state.lastStopPrice) && this.isApproximatelyEqual(limitPrice, state.lastLimitPrice)) {
      return;
    }

    // Validate prices before attempting update
    if (stopPrice <= 0 || limitPrice <= 0) {
      console.error(`❌ StopLimitService: Invalid prices for ${state.symbol} stage ${stageNumber} - stop ${stopPrice}, limit ${limitPrice}`);
      return;
    }

    // Validate price relationship: for SELL StopLimit orders, stopPrice should be >= limitPrice
    // (calculation ensures this via limitOffset, but double-check for safety)
    if (stopPrice < limitPrice) {
      console.error(`❌ StopLimitService: Invalid price relationship for ${state.symbol} SELL order - stop ${stopPrice} < limit ${limitPrice}. Recalculating...`);
      // Recalculate to ensure correct relationship
      const recalculated = this.calculateStopAndLimit(state.avgPrice, stopOffset);
      if (!recalculated || recalculated.stopPrice < recalculated.limitPrice) {
        console.error(`❌ StopLimitService: Cannot fix price relationship for ${state.symbol}, aborting update`);
        return;
      }
      // Use recalculated prices
      stopPrice = recalculated.stopPrice;
      limitPrice = recalculated.limitPrice;
    }

    const existing = state.orderId ? { orderId: state.orderId } : this.findActiveStopLimitOrder(state.symbol);
    const orderId = existing?.orderId || state.orderId;
    if (!orderId) {
      console.warn(`⚠️ StopLimitService: No active StopLimit order found for ${state.symbol} while updating stage ${stageNumber}`);
      return;
    }

    // Verify order is in a modifiable state before attempting update
    const cachedOrder = this.ordersCache.get(orderId);
    if (cachedOrder) {
      const orderStatus = (cachedOrder.Status || '').toUpperCase();
      if (!ACTIVE_ORDER_STATUSES.has(orderStatus) && !this.isQueuedStatus(orderStatus) && orderStatus !== 'ACK') {
        console.warn(`⚠️ StopLimitService: Order ${orderId} for ${state.symbol} is not in modifiable state (${orderStatus}), cannot update. Will try cancel-and-recreate.`);
        // Order is not modifiable - try cancel-and-recreate strategy
        await this.recreateOrderWithNewPrices(state, stopPrice, limitPrice, stageNumber, label);
        return;
      }
    }

    // Store previous prices before attempting update (for rollback on failure)
    const previousStopPrice = state.lastStopPrice;
    const previousLimitPrice = state.lastLimitPrice;
    const previousStageIndex = state.stageIndex;

    state.pendingUpdate = true;
    try {
      console.log(`🔄 StopLimitService: Updating StopLimit for ${state.symbol} to stage ${stageNumber} (${label}) - stop ${stopPrice}, limit ${limitPrice} (previous: stop ${previousStopPrice}, limit ${previousLimitPrice})`);
      const result = await this.putOrder(orderId, stopPrice, limitPrice);
      if (result.success) {
        state.stageIndex = stageNumber;
        state.lastStopPrice = stopPrice;
        state.lastLimitPrice = limitPrice;
        state.updatedAt = Date.now();
        console.log(`✅ StopLimitService: Successfully updated order ${orderId} for ${state.symbol} to stage ${stageNumber}`);
      } else {
        // Update failed - try cancel-and-recreate strategy
        console.error(`❌ StopLimitService: Failed to update order ${orderId} for ${state.symbol}: ${result.error || result.notifyStatus}. Attempting cancel-and-recreate.`);
        
        // Revert state first
        state.lastStopPrice = previousStopPrice;
        state.lastLimitPrice = previousLimitPrice;
        state.stageIndex = previousStageIndex;
        state.updatedAt = Date.now();
        
        // Try cancel-and-recreate strategy
        await this.recreateOrderWithNewPrices(state, stopPrice, limitPrice, stageNumber, label);
      }
    } catch (err) {
      console.error(`❌ StopLimitService: Error updating StopLimit for ${state.symbol}:`, err);
      // Revert to previous prices on error
      state.lastStopPrice = previousStopPrice;
      state.lastLimitPrice = previousLimitPrice;
      state.stageIndex = previousStageIndex;
      state.updatedAt = Date.now();
      
      // Try cancel-and-recreate as fallback
      try {
        await this.recreateOrderWithNewPrices(state, stopPrice, limitPrice, stageNumber, label);
      } catch (recreateErr) {
        console.error(`❌ StopLimitService: Cancel-and-recreate also failed for ${state.symbol}:`, recreateErr);
      }
    } finally {
      state.pendingUpdate = false;
    }
  }

  async recreateOrderWithNewPrices(state, stopPrice, limitPrice, stageNumber, label) {
    console.log(`🔄 StopLimitService: Attempting cancel-and-recreate for ${state.symbol} to stage ${stageNumber} (${label})`);
    
    // Delete the existing order first
    if (state.orderId) {
      try {
        await this.deleteOrder(state.orderId);
        console.log(`🗑️ StopLimitService: Deleted existing order ${state.orderId} for ${state.symbol} before recreating`);
        // Wait a moment for deletion to propagate
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`❌ StopLimitService: Error deleting order ${state.orderId} for ${state.symbol}:`, err);
        // Continue anyway - might already be deleted
      }
    }

    // Reset state to allow creation
    const previousOrderId = state.orderId;
    state.orderId = null;
    state.orderStatus = null;
    state.pendingCreate = false;
    state.pendingUpdate = false;

    // Create new order with new prices
    const config = this.groupConfigs[state.groupKey];
    if (!config) {
      console.error(`❌ StopLimitService: No config found for group ${state.groupKey}`);
      state.orderId = previousOrderId; // Restore on failure
      return;
    }

    const body = {
      symbol: state.symbol,
      side: 'SELL',
      order_type: 'StopLimit',
      quantity: Math.max(1, Math.round(state.quantity)),
      stop_price: stopPrice,
      limit_price: limitPrice
    };

    console.log(`📤 StopLimitService: Creating new StopLimit order for ${state.symbol} (stage ${stageNumber}) - stop ${stopPrice}, limit ${limitPrice}`);
    const response = await this.postOrder(body);
    
    if (response.success) {
      state.stageIndex = stageNumber;
      state.lastStopPrice = stopPrice;
      state.lastLimitPrice = limitPrice;
      if (response.orderId) {
        state.orderId = response.orderId;
        console.log(`✅ StopLimitService: Successfully recreated order ${response.orderId} for ${state.symbol} at stage ${stageNumber}`);
      } else {
        console.warn(`⚠️ StopLimitService: Order recreated for ${state.symbol} but no order_id returned. StageIndex set to ${stageNumber}.`);
      }
      state.updatedAt = Date.now();
    } else {
      console.error(`❌ StopLimitService: Failed to recreate order for ${state.symbol}: ${response.error || response.notifyStatus}`);
      // Restore previous orderId on failure
      state.orderId = previousOrderId;
    }
  }

  async executeAutoSell(state) {
    if (!this.analysisEnabled) {
      return;
    }

    state.autoSellExecuted = true;

    try {
      console.log(`🚨 StopLimitService: Auto-selling ${state.symbol} (trigger reached)`);

      const quantity = Math.max(1, Math.round(state.quantity));
      await this.deleteExistingSellOrders(state.symbol);

      const body = {
        symbol: state.symbol,
        side: 'SELL',
        order_type: 'Market',
        quantity
      };

      const response = await this.postOrder(body);
      if (response.success) {
        console.log(`✅ StopLimitService: Auto-sell order sent for ${state.symbol}${response.orderId ? ` (order_id=${response.orderId})` : ''}`);
        state.updatedAt = Date.now();
      } else {
        console.error(`❌ StopLimitService: Failed to auto-sell ${state.symbol}: ${response.error || response.notifyStatus}`);
      }
    } catch (err) {
      console.error(`❌ StopLimitService: Error auto-selling ${state.symbol}:`, err);
    }
  }

  async deleteExistingSellOrders(symbol, excludeOrderId = null) {
    if (!this.analysisEnabled) {
      return;
    }

    const orders = this.findActiveSellOrders(symbol);
    if (!orders.length) {
      return;
    }

    // Filter out the order we want to exclude (if any) and queued orders
    const cancellableOrders = orders.filter(order => {
      if (excludeOrderId && order.orderId === excludeOrderId) {
        return false; // Don't delete the order we're excluding
      }
      return !this.isQueuedStatus(order.status);
    });

    if (!cancellableOrders.length) {
      console.log(`ℹ️ StopLimitService: Existing SELL order(s) for ${symbol} are queued or excluded; keeping pending order in place.`);
      return;
    }

    console.log(`🗑️ StopLimitService: Deleting ${cancellableOrders.length} existing SELL order(s) for ${symbol} before creating new StopLimit${excludeOrderId ? ` (excluding ${excludeOrderId})` : ''}`);
    for (const { orderId } of cancellableOrders) {
      try {
        await this.deleteOrder(orderId);
      } catch (err) {
        console.error(`❌ StopLimitService: Error deleting order ${orderId} for ${symbol}:`, err);
      }
    }
  }

  findActiveSellOrders(symbol) {
    const normalized = symbol.toUpperCase();
    const orders = [];

    for (const [orderId, order] of this.ordersCache.entries()) {
      if (!order || !order.Legs) continue;
      const status = (order.Status || '').toUpperCase();
      if (ACTIVE_ORDER_STATUSES.has(status) === false || status === 'OUT' || status === 'REJ' || status === 'FLL') continue;
      for (const leg of order.Legs) {
        if ((leg.Symbol || '').toUpperCase() !== normalized) continue;
        if ((leg.BuyOrSell || '').toUpperCase() !== 'SELL') continue;
        orders.push({ orderId, status, order });
        break;
      }
    }

    return orders;
  }

  findActiveStopLimitOrder(symbol) {
    const normalized = symbol.toUpperCase();
    for (const [orderId, order] of this.ordersCache.entries()) {
      if (!order || !order.Legs) continue;
      if ((order.OrderType || '').toUpperCase() !== 'STOPLIMIT') continue;
      const status = (order.Status || '').toUpperCase();
      if (!ACTIVE_ORDER_STATUSES.has(status)) continue;
      if (status === 'OUT' || status === 'REJ' || status === 'FLL') continue;

      for (const leg of order.Legs) {
        if ((leg.Symbol || '').toUpperCase() === normalized && (leg.BuyOrSell || '').toUpperCase() === 'SELL') {
          return { orderId, order, leg };
        }
      }
    }
    return null;
  }

  /**
   * Comprehensive validation to check if a StopLimit order exists for a symbol.
   * This is a critical safety check before creating new orders.
   * Checks multiple sources and statuses to be absolutely certain.
   */
  validateExistingStopLimitOrder(symbol) {
    const normalized = symbol.toUpperCase();
    const results = {
      hasOrder: false,
      orderId: null,
      order: null,
      leg: null,
      status: null,
      source: null,
      checks: []
    };

    // Check 1: Active StopLimit orders in cache
    const active = this.findActiveStopLimitOrder(normalized);
    if (active) {
      results.hasOrder = true;
      results.orderId = active.orderId;
      results.order = active.order;
      results.leg = active.leg;
      results.status = (active.order?.Status || '').toUpperCase();
      results.source = 'active-cache';
      results.checks.push(`Found active StopLimit order ${active.orderId} with status ${results.status}`);
      return results;
    }

    // Check 2: Any StopLimit order in cache (including queued/acknowledged)
    for (const [orderId, order] of this.ordersCache.entries()) {
      if (!order || !order.Legs) continue;
      if ((order.OrderType || '').toUpperCase() !== 'STOPLIMIT') continue;
      
      for (const leg of order.Legs) {
        if ((leg.Symbol || '').toUpperCase() === normalized && (leg.BuyOrSell || '').toUpperCase() === 'SELL') {
          const status = (order.Status || '').toUpperCase();
          // Accept any status that's not definitively cancelled/filled
          if (status !== 'CAN' && status !== 'FIL' && status !== 'FLL' && status !== 'EXP') {
            results.hasOrder = true;
            results.orderId = orderId;
            results.order = order;
            results.leg = leg;
            results.status = status;
            results.source = 'any-cache';
            results.checks.push(`Found StopLimit order ${orderId} with status ${status} (not cancelled/filled)`);
            return results;
          }
        }
      }
    }

    // Check 3: Latest relevant order (fallback)
    const fallback = this.findLatestRelevantOrder(normalized);
    if (fallback) {
      const status = (fallback.status || '').toUpperCase();
      if (status === 'ACK' || this.isQueuedStatus(status) || ACTIVE_ORDER_STATUSES.has(status)) {
        results.hasOrder = true;
        results.orderId = fallback.orderId;
        results.order = fallback.order;
        results.leg = fallback.leg;
        results.status = status;
        results.source = 'fallback';
        results.checks.push(`Found relevant order ${fallback.orderId} with status ${status} via fallback`);
        return results;
      }
    }

    results.checks.push('No existing StopLimit order found in cache');
    return results;
  }

  findLatestRelevantOrder(symbol) {
    const normalized = symbol.toUpperCase();
    let fallback = null;

    for (const [orderId, order] of this.ordersCache.entries()) {
      if (!order || !order.Legs) continue;
      const status = (order.Status || '').toUpperCase();
      const consideredStatus =
        ACTIVE_ORDER_STATUSES.has(status) ||
        this.isQueuedStatus(status) ||
        status === 'ACK' ||
        status === 'FLL' ||
        status === 'FIL';

      if (!consideredStatus) continue;

      for (const leg of order.Legs) {
        if ((leg.Symbol || '').toUpperCase() !== normalized) continue;
        if ((leg.BuyOrSell || '').toUpperCase() !== 'SELL') continue;

        const updatedAt = order.lastUpdated || order.TimeStamp || order.Timestamp || Date.now();
        if (!fallback || updatedAt > fallback.updatedAt) {
          fallback = {
            orderId,
            order,
            leg,
            status,
            updatedAt
          };
        }
      }
    }

    return fallback;
  }

  calculateStopAndLimit(avgPrice, stopOffset) {
    if (typeof avgPrice !== 'number' || Number.isNaN(avgPrice)) return null;
    const stopPrice = this.roundPrice(avgPrice + stopOffset);
    const limitPrice = this.roundPrice(stopPrice - this.limitOffset);

    // Debug logging to verify calculation
    const limitDiffFromAvg = this.roundPrice(avgPrice - limitPrice);
    console.log(`🔢 StopLimitService: Price calculation - avgPrice=${avgPrice}, stopOffset=${stopOffset}, limitOffset=${this.limitOffset}, stopPrice=${stopPrice}, limitPrice=${limitPrice}, limitDiffFromAvg=${limitDiffFromAvg}`);

    if (stopPrice <= 0 || limitPrice <= 0) {
      console.warn(`⚠️ StopLimitService: Calculated non-positive prices (stop=${stopPrice}, limit=${limitPrice})`);
      return null;
    }

    return { stopPrice, limitPrice };
  }

  parseNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (Number.isNaN(num)) return null;
    return num;
  }

  roundPrice(price) {
    return Math.round(price * 100) / 100;
  }

  isApproximatelyEqual(a, b, epsilon = 0.01) {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    return Math.abs(a - b) <= epsilon;
  }

  async postOrder(body) {
    try {
      const resp = await fetch(`${this.apiBaseUrl}/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
      const text = await resp.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      const success = resp.ok;
      const extractedOrderId = success ? this.extractOrderId(data) : null;
      
      if (success && !extractedOrderId) {
        console.warn(`⚠️ StopLimitService: Order creation succeeded but orderId extraction failed. Response data: ${JSON.stringify(data).substring(0, 500)}`);
      }
      
      const result = {
        success,
        notifyStatus,
        responseData: data,
        orderId: extractedOrderId
      };

      if (!success) {
        result.error = this.extractErrorMessage(data) || notifyStatus;
      }

      return result;
    } catch (err) {
      return {
        success: false,
        notifyStatus: `ERROR: ${err.message}`,
        error: err.message
      };
    }
  }

  async putOrder(orderId, stopPrice, limitPrice) {
    try {
      const resp = await fetch(`${this.apiBaseUrl}/order`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          order_id: orderId,
          stop_price: this.roundPrice(stopPrice),
          limit_price: this.roundPrice(limitPrice)
        })
      });

      const notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
      const text = await resp.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      const success = resp.ok;
      const result = {
        success,
        notifyStatus,
        responseData: data
      };
      if (!success) {
        result.error = this.extractErrorMessage(data) || notifyStatus;
      }
      return result;
    } catch (err) {
      return {
        success: false,
        notifyStatus: `ERROR: ${err.message}`,
        error: err.message
      };
    }
  }

  async deleteOrder(orderId) {
    try {
      const resp = await fetch(`${this.apiBaseUrl}/order/${encodeURIComponent(orderId)}`, {
        method: 'DELETE',
        headers: {
          'Accept': '*/*'
        }
      });

      if (!resp.ok && resp.status !== 200 && resp.status !== 204) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }

      if (this.ordersCache.has(orderId)) {
        this.ordersCache.delete(orderId);
      }
    } catch (err) {
      console.error(`❌ StopLimitService: Failed to delete order ${orderId}:`, err.message);
    }
  }

  extractOrderId(data) {
    if (data === null || data === undefined) return null;

    if (typeof data === 'string') {
      const match = data.match(/order[_\s-]*id["']?\s*[:=]\s*["']?([A-Za-z0-9-]+)/i);
      return match ? match[1] : null;
    }

    if (typeof data === 'number') {
      return data;
    }

    if (Array.isArray(data)) {
      for (const item of data) {
        const value = this.extractOrderId(item);
        if (value) return value;
      }
      return null;
    }

    if (typeof data === 'object') {
      const direct =
        data.order_id ??
        data.orderId ??
        data.orderID ??
        data.OrderID ??
        data.OrderId ??
        data.orderid ??
        data.id ??
        null;
      if (direct !== null && direct !== undefined) {
        return direct;
      }

      const nestedKeys = ['order', 'Order', 'data', 'Data', 'result', 'payload', 'response', 'details'];
      for (const key of nestedKeys) {
        if (key in data) {
          const nested = this.extractOrderId(data[key]);
          if (nested) return nested;
        }
      }

      for (const value of Object.values(data)) {
        if (value && typeof value === 'object') {
          const nested = this.extractOrderId(value);
          if (nested) return nested;
        }
      }

      return null;
    }

    return null;
  }

  extractErrorMessage(data) {
    if (!data) return null;
    if (typeof data === 'string') return data;
    if (typeof data === 'object') {
      return data.error || data.message || data.detail || null;
    }
    return null;
  }

  getSnapshot() {
    // CRITICAL: Always validate before returning snapshot to ensure accuracy
    this.refreshTrackedPositionsFromCaches();
    
    // Aggressive cleanup pass - remove any positions that are no longer active
    const symbolsToCleanup = [];
    for (const state of this.trackedPositions.values()) {
      // First check: Is position still active in cache?
      if (!this.hasActivePosition(state.symbol)) {
        console.log(`🧹 StopLimitService: Removing ${state.symbol} from snapshot - position no longer active`);
        symbolsToCleanup.push(state.symbol);
        continue;
      }

      // Second check: Verify position exists in positionsCache with valid quantity
      if (this.positionsCache && typeof this.positionsCache.get === 'function') {
        const position = this.positionsCache.get(state.symbol);
        if (!position) {
          console.log(`🧹 StopLimitService: Removing ${state.symbol} from snapshot - not in positionsCache`);
          symbolsToCleanup.push(state.symbol);
          continue;
        }
        
        const quantity = this.parseNumber(position?.Quantity);
        if (!quantity || quantity <= 0) {
          console.log(`🧹 StopLimitService: Removing ${state.symbol} from snapshot - quantity is ${quantity}`);
          symbolsToCleanup.push(state.symbol);
          continue;
        }
      }

      // Quick validation pass - check for any missing order links
      // If we have stageIndex >= 0 but no orderId, try to find and link the order
      if (state.stageIndex >= 0 && !state.orderId && !state.pendingCreate) {
        const validation = this.validateExistingStopLimitOrder(state.symbol);
        if (validation.hasOrder) {
          console.log(`🔧 StopLimitService: Quick validation - Linking order ${validation.orderId} to ${state.symbol} in snapshot`);
          this.updateStateFromOrder(state, validation.orderId, validation.order, validation.leg, validation.status);
        }
      }
    }

    // Cleanup inactive positions
    for (const symbol of symbolsToCleanup) {
      this.cleanupPosition(symbol);
    }

    // Build snapshot for active positions
    const rows = [];
    for (const state of this.trackedPositions.values()) {
      // Final check before adding to snapshot
      if (!this.hasActivePosition(state.symbol)) {
        continue;
      }
      rows.push(this.toSnapshot(state));
    }
    
    // Add sold positions to snapshot
    for (const soldState of this.soldPositions.values()) {
      rows.push(this.toSoldSnapshot(soldState));
    }
    
    return rows.sort((a, b) => {
      // Sort sold positions to the end
      if (a.status === 'sold' && b.status !== 'sold') return 1;
      if (a.status !== 'sold' && b.status === 'sold') return -1;
      return a.symbol.localeCompare(b.symbol);
    });
  }

  toSnapshot(state) {
    const config = this.groupConfigs[state.groupKey] || null;
    const stageDetails = this.getStageDetails(state, config);
    const nextStage = this.getNextStageDetails(state, config);
    const status = this.getStatus(state);
    const autoSellTrigger = config?.autoSellTrigger ?? null;
    const progress = this.computeProgress(state.lastUnrealizedQty, autoSellTrigger);

    return {
      symbol: state.symbol,
      groupKey: state.groupKey,
      groupLabel: config?.label || 'Unknown',
      avgPrice: state.avgPrice,
      quantity: state.quantity,
      stageIndex: state.stageIndex,
      stageLabel: stageDetails.label,
      stageDescription: stageDetails.description,
      nextTrigger: nextStage?.trigger ?? null,
      nextStageLabel: nextStage?.label ?? null,
      nextStageDescription: nextStage?.description ?? null,
      stopPrice: state.lastStopPrice,
      limitPrice: state.lastLimitPrice,
      orderId: state.orderId,
      orderStatus: state.orderStatus,
      unrealizedQty: state.lastUnrealizedQty,
      autoSellTrigger,
      progress,
      status,
      statusLabel: this.getStatusLabel(status),
      pendingCreate: state.pendingCreate,
      pendingUpdate: state.pendingUpdate,
      autoSellExecuted: state.autoSellExecuted,
      createdAt: state.createdAt || null,
      updatedAt: state.updatedAt || null
    };
  }

  toSoldSnapshot(soldState) {
    const config = this.groupConfigs[soldState.groupKey] || null;
    const stageDetails = soldState.stageIndex >= 0 
      ? this.getStageDetails({ stageIndex: soldState.stageIndex }, config)
      : { label: 'N/A', description: 'N/A' };

    return {
      symbol: soldState.symbol,
      groupKey: soldState.groupKey,
      groupLabel: config?.label || 'Unknown',
      avgPrice: soldState.avgPrice,
      quantity: soldState.quantity,
      stageIndex: soldState.stageIndex,
      stageLabel: stageDetails.label,
      stageDescription: stageDetails.description,
      nextTrigger: null,
      nextStageLabel: null,
      nextStageDescription: null,
      stopPrice: soldState.lastStopPrice,
      limitPrice: soldState.lastLimitPrice,
      orderId: soldState.orderId,
      orderStatus: 'FLL',
      unrealizedQty: null,
      autoSellTrigger: null,
      progress: null,
      status: 'sold',
      statusLabel: 'SOLD',
      pendingCreate: false,
      pendingUpdate: false,
      autoSellExecuted: false,
      createdAt: soldState.createdAt || null,
      updatedAt: soldState.soldAt || null,
      // Sold position specific fields
      sellPrice: soldState.sellPrice,
      pnlPerShare: soldState.pnlPerShare,
      totalPnL: soldState.totalPnL,
      soldAt: soldState.soldAt
    };
  }

  getStageDetails(state, config) {
    if (!config) {
      return { label: 'Unknown', description: 'No group config available' };
    }

    if (state.stageIndex === -1) {
      return {
        label: 'Awaiting StopLimit',
        description: 'Initial StopLimit order is pending creation'
      };
    }

    if (state.stageIndex === 0) {
      return {
        label: 'Initial Stop',
        description: `Stop ${this.formatOffset(config.initialOffset)} from buy price`
      };
    }

    const stage = config.stages[state.stageIndex - 1];
    if (!stage) {
      return {
        label: 'Final Stage',
        description: 'All staged adjustments applied'
      };
    }

    return {
      label: stage.label,
      description: `Stop ${this.formatOffset(stage.stopOffset)} from buy price`
    };
  }

  getNextStageDetails(state, config) {
    if (!config) return null;
    const targetIndex = state.stageIndex < 0 ? 0 : state.stageIndex;
    if (targetIndex >= config.stages.length) {
      return null;
    }
    const stage = config.stages[targetIndex];
    if (!stage) return null;
    return {
      trigger: stage.trigger,
      label: stage.label,
      description: `Stop ${this.formatOffset(stage.stopOffset)} from buy price`
    };
  }

  getStatus(state) {
    if (!this.analysisEnabled) {
      return 'analysis-disabled';
    }

    const orderStatus = (state.orderStatus || '').toUpperCase();
    if (state.autoSellExecuted) return 'auto-sell-executed';
    
    // CRITICAL: Check for rejected orders first - they should show as rejected, not active
    if (orderStatus === 'REJ') {
      return 'order-rejected';
    }
    
    // If stageIndex >= 0, we've created an order - don't show "creating" even if pendingCreate is true
    // (pendingCreate might be true during the async operation, but order is already created)
    if (state.pendingCreate && state.stageIndex < 0) {
      return 'creating-order';
    }
    if (state.pendingUpdate) return 'updating-order';
    
    // If we have an orderId or stageIndex >= 0, check the order status
    if (state.orderId || state.stageIndex >= 0) {
      if (orderStatus === 'DON' || orderStatus === 'QUE' || orderStatus === 'QUEUED') {
        return 'queued';
      }
      // If we have stageIndex >= 0 but no orderId yet, we're waiting for websocket to link it
      if (!state.orderId && state.stageIndex >= 0) {
        return 'awaiting-ack';
      }
      // Only return 'active' if order status is actually active
      if (ACTIVE_ORDER_STATUSES.has(orderStatus) || this.isQueuedStatus(orderStatus) || orderStatus === 'ACK') {
        return 'active';
      }
      // If order status is non-active but not REJ (already handled), show as inactive
      if (NON_ACTIVE_STATUSES.has(orderStatus)) {
        return 'order-inactive';
      }
      return 'active';
    }
    
    // No order yet
    return state.stageIndex <= 0 ? 'awaiting-stoplimit' : 'awaiting-ack';
  }

  getStatusLabel(status) {
    switch (status) {
      case 'sold':
        return 'SOLD';
      case 'auto-sell-executed':
        return 'Auto Sell Executed';
      case 'creating-order':
        return 'Creating StopLimit';
      case 'updating-order':
        return 'Updating StopLimit';
      case 'queued':
        return 'Queued';
      case 'awaiting-stoplimit':
        return 'Awaiting StopLimit';
      case 'awaiting-ack':
        return 'Awaiting Confirmation';
      case 'analysis-disabled':
        return 'Automation Disabled';
      case 'order-rejected':
        return 'Order Rejected';
      case 'order-inactive':
        return 'Order Inactive';
      case 'active':
      default:
        return 'Active';
    }
  }

  formatOffset(offset) {
    if (offset === null || offset === undefined) return 'N/A';
    return `${offset >= 0 ? '+' : ''}${offset.toFixed(2)}`;
  }

  computeProgress(unrealizedQty, autoSellTrigger) {
    if (
      autoSellTrigger === null ||
      autoSellTrigger === 0 ||
      unrealizedQty === null ||
      unrealizedQty === undefined ||
      Number.isNaN(unrealizedQty)
    ) {
      return null;
    }

    const ratio = unrealizedQty / autoSellTrigger;
    if (!Number.isFinite(ratio)) {
      return null;
    }
    return Math.max(0, Math.min(1, ratio));
  }

  isQueuedStatus(status) {
    const upper = (status || '').toUpperCase();
    return upper === 'DON' || upper === 'QUE' || upper === 'QUEUED';
  }

  async maybeAttachExistingStopLimit(state, reason = '') {
    if (!state || !state.symbol) return false;

    const active = this.findActiveStopLimitOrder(state.symbol);
    if (active) {
      this.updateStateFromOrder(state, active.orderId, active.order, active.leg, active.order?.Status);
      console.log(`ℹ️ StopLimitService: Active StopLimit order linked for ${state.symbol} (reason=${reason || 'unknown'})`);
      return true;
    }

    const fallback = this.findLatestRelevantOrder(state.symbol);
    if (fallback) {
      this.updateStateFromOrder(state, fallback.orderId, fallback.order, fallback.leg, fallback.status);
      console.log(`ℹ️ StopLimitService: Latest relevant order (${fallback.status}) linked for ${state.symbol} (reason=${reason || 'unknown'})`);
      return true;
    }

    const awaited = await this.waitForOrderFromStream(
      state.symbol,
      (order) => {
        const leg = this.extractStopLimitSellLeg(order, state.symbol);
        if (!leg) return false;
        const orderId = this.extractOrderId(order);
        if (!orderId) return false;
        const status = (order.Status || '').toUpperCase();
        if (!ACTIVE_ORDER_STATUSES.has(status)) return false;
        return { orderId, order, leg };
      },
      4000
    );

    if (awaited && awaited.order && awaited.leg) {
      const resolvedOrderId = awaited.orderId || this.extractOrderId(awaited.order);
      if (resolvedOrderId) {
        this.updateStateFromOrder(state, resolvedOrderId, awaited.order, awaited.leg, awaited.order?.Status);
        console.log(`ℹ️ StopLimitService: Streamed StopLimit order linked for ${state.symbol} (reason=${reason || 'unknown'})`);
        return true;
      }
    }

    const retryActive = this.findActiveStopLimitOrder(state.symbol);
    if (retryActive) {
      this.updateStateFromOrder(state, retryActive.orderId, retryActive.order, retryActive.leg, retryActive.order?.Status);
      console.log(`ℹ️ StopLimitService: Active StopLimit order linked for ${state.symbol} on retry (reason=${reason || 'unknown'})`);
      return true;
    }

    return false;
  }

  updateStateFromOrder(state, orderId, order, leg = null, statusOverride = null) {
    if (!state || !order) return;

    const resolvedOrderId = orderId || this.extractOrderId(order);
    if (resolvedOrderId) {
      state.orderId = resolvedOrderId;
    }
    const status = (statusOverride || order.Status || '').toUpperCase() || null;
    state.orderStatus = status;
    state.stageIndex = Math.max(state.stageIndex, 0);

    const legs = Array.isArray(order.Legs) ? order.Legs : [];
    const matchingLeg = leg || legs.find(l => (l.Symbol || '').toUpperCase() === state.symbol) || legs[0] || null;

    const orderLimit = this.parseNumber(
      order.LimitPrice ??
      order.Price ??
      order.limit_price ??
      order.limitPrice
    );
    const legLimit = this.parseNumber(
      matchingLeg?.LimitPrice ??
      matchingLeg?.Price ??
      matchingLeg?.limit_price ??
      matchingLeg?.limitPrice
    );
    const resolvedLimit = orderLimit ?? legLimit;
    if (resolvedLimit !== null && resolvedLimit !== undefined) {
      state.lastLimitPrice = resolvedLimit;
    }

    const orderStop = this.parseNumber(
      order.StopPrice ??
      order.StopLimitPrice ??
      order.StopPriceValue ??
      order.stop_price ??
      order.stopPrice
    );
    const legStop = this.parseNumber(
      matchingLeg?.StopPrice ??
      matchingLeg?.StopLimitPrice ??
      matchingLeg?.stop_price ??
      matchingLeg?.stopPrice
    );
    const resolvedStop = orderStop ?? legStop;
    if (resolvedStop !== null && resolvedStop !== undefined) {
      state.lastStopPrice = resolvedStop;
    }

    state.pendingCreate = false;
    state.pendingUpdate = false;
    state.updatedAt = Date.now();
  }

  getOrderType(order) {
    if (!order) return '';
    return (order.OrderType || order.order_type || order.orderType || '').toUpperCase();
  }

  extractStopLimitSellLeg(order, symbol) {
    if (!order || !symbol) return null;
    const type = this.getOrderType(order);
    if (type !== 'STOPLIMIT') return null;
    const target = symbol.toUpperCase();
    const legs = Array.isArray(order.Legs) ? order.Legs : [];
    for (const leg of legs) {
      const legSymbol = (leg.Symbol || leg.symbol || '').toUpperCase();
      const side = (leg.BuyOrSell || leg.buy_or_sell || leg.side || '').toUpperCase();
      if (legSymbol === target && side === 'SELL') {
        return leg;
      }
    }
    return null;
  }

  waitForOrderFromStream(symbol, predicate, timeoutMs = 3000) {
    const key = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    if (!key) return Promise.resolve(null);
    return new Promise((resolve) => {
      const existing = this.orderWaiters.get(key);
      const waiters = existing || new Set();
      if (!existing) this.orderWaiters.set(key, waiters);

      let settled = false;
      const entry = {
        predicate: typeof predicate === 'function' ? predicate : null,
        settle: null,
        timeoutId: null
      };

      const cleanup = () => {
        if (waiters.has(entry)) {
          waiters.delete(entry);
        }
        if (waiters.size === 0) {
          this.orderWaiters.delete(key);
        }
      };

      entry.settle = (value) => {
        if (settled) return;
        settled = true;
        if (entry.timeoutId) clearTimeout(entry.timeoutId);
        cleanup();
        resolve(value);
      };

      entry.timeoutId = setTimeout(() => {
        entry.settle(null);
      }, Math.max(0, timeoutMs || 0));

      waiters.add(entry);
    });
  }

  resolveOrderWaiters(symbol, order) {
    const key = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    if (!key) return;
    const waiters = this.orderWaiters.get(key);
    if (!waiters || waiters.size === 0) return;

    for (const entry of Array.from(waiters)) {
      let result = order;
      if (entry.predicate) {
        try {
          result = entry.predicate(order);
        } catch (err) {
          continue;
        }
      }
      if (result) {
        const value = result === true ? { order } : result;
        entry.settle(value);
      }
    }
  }

  clearOrderWaiters(symbol) {
    const key = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    const waiters = key ? this.orderWaiters.get(key) : null;
    if (!waiters || waiters.size === 0) return;
    for (const entry of Array.from(waiters)) {
      entry.settle(null);
    }
    this.orderWaiters.delete(key);
  }

  isTrackingSymbol(symbol) {
    const key = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    if (!key) return false;
    return this.trackedPositions.has(key);
  }

  getTrackedSymbols() {
    return Array.from(this.trackedPositions.keys());
  }
}

module.exports = StopLimitService;

