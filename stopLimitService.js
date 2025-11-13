const fetch = require('node-fetch');

const ACTIVE_ORDER_STATUSES = new Set(['ACK', 'DON', 'REC', 'QUE', 'QUEUED']);
const NON_ACTIVE_STATUSES = new Set(['CAN', 'FIL', 'EXP', 'OUT', 'REJ', 'FLL']);

class StopLimitService {
  constructor({ ordersCache, positionsCache }) {
    this.ordersCache = ordersCache;
    this.positionsCache = positionsCache || null;
    this.trackedPositions = new Map(); // Map<symbol, PositionState>
    this.orderWaiters = new Map(); // Map<symbol, Set<OrderWaiter>>
    this.analysisEnabled = true;
    this.analysisChangedAt = Date.now();

    this.limitOffset = 0.05; // stop_price = limit_price + 0.05
    this.apiBaseUrl = 'https://sections-bot.inbitme.com';

    this.groupConfigs = {
      A: {
        label: 'Group A',
        priceRange: { minExclusive: 0, maxInclusive: 5 },
        initialOffset: -0.10,
        stages: [
          { trigger: 0.25, stopOffset: 0.0, label: 'Break-even' },
          { trigger: 0.35, stopOffset: 0.15, label: '+0.15 from buy' },
          { trigger: 0.50, stopOffset: 0.30, label: '+0.30 from buy' }
        ],
        autoSellTrigger: 0.70
      },
      B: {
        label: 'Group B',
        priceRange: { minExclusive: 5, maxInclusive: 10 },
        initialOffset: -0.15,
        stages: [
          { trigger: 0.35, stopOffset: 0.0, label: 'Break-even' },
          { trigger: 0.50, stopOffset: 0.20, label: '+0.20 from buy' },
          { trigger: 0.70, stopOffset: 0.50, label: '+0.50 from buy' }
        ],
        autoSellTrigger: 0.90
      },
      C: {
        label: 'Group C',
        priceRange: { minExclusive: 10, maxInclusive: 12 },
        initialOffset: -0.20,
        stages: [
          { trigger: 0.45, stopOffset: 0.0, label: 'Break-even' },
          { trigger: 0.60, stopOffset: 0.25, label: '+0.25 from buy' },
          { trigger: 0.90, stopOffset: 0.50, label: '+0.50 from buy' }
        ],
        autoSellTrigger: 1.25
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
      return;
    }

    let state = this.trackedPositions.get(symbol);
    if (!state) {
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
        orderStatus: null
      };
      this.trackedPositions.set(symbol, state);
    } else {
      state.avgPrice = avgPrice;
      state.quantity = quantity;
      state.positionId = position?.PositionID || state.positionId;
      state.lastUnrealizedQty = unrealizedQty;
      state.updatedAt = Date.now();

      if (state.autoSellExecuted || !state.orderId || NON_ACTIVE_STATUSES.has((state.orderStatus || '').toUpperCase())) {
        console.log(`🔄 StopLimitService: Reinitializing StopLimit tracking for ${symbol}`);
        state.stageIndex = -1;
        state.orderId = null;
        state.orderStatus = null;
        state.pendingCreate = false;
        state.pendingUpdate = false;
        state.autoSellExecuted = false;
        state.lastStopPrice = null;
        state.lastLimitPrice = null;
      }

      if (!state.orderId && state.stageIndex !== -1) {
        state.stageIndex = -1;
      }
    }

    state.updatedAt = Date.now();

    if (!this.analysisEnabled) {
      return;
    }

    if (state.autoSellExecuted) {
      return;
    }

    await this.ensureInitialOrder(state);
    await this.evaluateAdjustments(state, unrealizedQty);
  }

  async handleOrderUpdate(order) {
    if (!order || !order.OrderID || !order.Legs || !Array.isArray(order.Legs) || order.Legs.length === 0) {
      return;
    }

    for (const orderLeg of order.Legs) {
      const legSymbol = (orderLeg.Symbol || '').toUpperCase();
      if (legSymbol) {
        this.resolveOrderWaiters(legSymbol, order);
      }
    }

    const leg = order.Legs.find(l => {
      const sym = (l.Symbol || '').toUpperCase();
      const side = (l.BuyOrSell || '').toUpperCase();
      return sym && side === 'SELL';
    });
    if (!leg) return;

    const symbol = (leg.Symbol || '').toUpperCase();
    if (!symbol) return;

    if (this.getOrderType(order) !== 'STOPLIMIT') return;

    let state = this.trackedPositions.get(symbol);
    if (!state && this.positionsCache && typeof this.positionsCache.get === 'function') {
      const position = this.positionsCache.get(symbol);
      if (position) {
        try {
          await this.handlePositionUpdate(position);
        } catch (err) {
          console.error(`❌ StopLimitService: Failed to bootstrap position tracking for ${symbol}:`, err);
        }
        state = this.trackedPositions.get(symbol);
      }
    }

    if (!state) return;

    const previousOrderId = state.orderId;
    const status = (order.Status || '').toUpperCase();
    state.orderStatus = status;

    if (ACTIVE_ORDER_STATUSES.has(status)) {
      if (previousOrderId !== order.OrderID) {
        console.log(`📝 StopLimitService: Linked StopLimit order ${order.OrderID} to ${symbol}`);
      }
      this.updateStateFromOrder(state, order.OrderID, order, leg, status);
    } else if (NON_ACTIVE_STATUSES.has(status)) {
      if (previousOrderId === order.OrderID) {
        console.log(`ℹ️ StopLimitService: StopLimit order ${order.OrderID} for ${symbol} is no longer active (status ${status})`);
        state.orderId = null;
        state.orderStatus = status;
        state.updatedAt = Date.now();
        state.pendingCreate = false;
        state.pendingUpdate = false;

        if (status === 'FLL' || status === 'FIL') {
          console.log(`✅ StopLimitService: Position ${symbol} filled (order status ${status}) – ending tracking.`);
          this.cleanupPosition(symbol);
          return;
        } else if (status === 'OUT' || status === 'REJ') {
          const fallback = this.findLatestRelevantOrder(symbol);
          if (!fallback) {
            console.log(`ℹ️ StopLimitService: No follow-up order found for ${symbol} after ${status}; keeping position tracked.`);
          } else {
            const fallbackStatus = (fallback.status || '').toUpperCase();
            if (this.isQueuedStatus(fallbackStatus) || fallbackStatus === 'ACK') {
              console.log(`ℹ️ StopLimitService: Found fallback order ${fallback.orderId} with status ${fallbackStatus} for ${symbol}; re-linking.`);
              this.updateStateFromOrder(state, fallback.orderId, fallback.order, fallback.leg, fallbackStatus);
            } else if (fallbackStatus === 'FLL' || fallbackStatus === 'FIL') {
              console.log(`✅ StopLimitService: Fallback order ${fallback.orderId} is filled; cleaning up position ${symbol}.`);
              this.cleanupPosition(symbol);
            }
          }
        }

        if (status !== 'FLL' && status !== 'FIL') {
          if (!this.analysisEnabled) {
            // Do nothing else when automation is disabled; cleanup will happen via cache refresh.
          } else if (!this.hasActivePosition(symbol)) {
            this.cleanupPosition(symbol);
          } else if (!state.orderId && !state.pendingCreate && !state.pendingUpdate) {
            try {
              await this.ensureInitialOrder(state);
            } catch (err) {
              console.error(`❌ StopLimitService: Failed to ensure StopLimit after ${status} for ${symbol}:`, err);
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
      for (const state of this.trackedPositions.values()) {
        state.pendingCreate = false;
        state.pendingUpdate = false;
      }
    }

    console.log(`⚙️ StopLimitService: Automation ${normalized ? 'enabled' : 'disabled'}`);
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
    const activeSymbols = this.getActivePositionSymbols();
    if (activeSymbols) {
      for (const symbol of Array.from(this.trackedPositions.keys())) {
        if (!activeSymbols.has(symbol)) {
          this.cleanupPosition(symbol);
        }
      }
    }

    for (const state of Array.from(this.trackedPositions.values())) {
      this.realignStateWithOrders(state);
    }
  }

  realignStateWithOrders(state) {
    if (!state) return;

    const active = this.findActiveStopLimitOrder(state.symbol);
    if (active) {
      const status = active.order?.Status || active.order?.status || null;
      const statusUpper = (status || '').toUpperCase();
      const currentStatusUpper = (state.orderStatus || '').toUpperCase();
      if (
        state.orderId !== active.orderId ||
        currentStatusUpper !== statusUpper
      ) {
        this.updateStateFromOrder(state, active.orderId, active.order, active.leg, status);
      }
      return;
    }

    const fallback = this.findLatestRelevantOrder(state.symbol);
    if (fallback) {
      const statusUpper = (fallback.status || '').toUpperCase();
      if (
        state.orderId !== fallback.orderId ||
        (state.orderStatus || '').toUpperCase() !== statusUpper
      ) {
        this.updateStateFromOrder(state, fallback.orderId, fallback.order, fallback.leg, fallback.status);
      }

      if ((statusUpper === 'FIL' || statusUpper === 'FLL') && !this.hasActivePosition(state.symbol)) {
        this.cleanupPosition(state.symbol);
      }
      return;
    }

    if (state.orderId || state.orderStatus) {
      state.orderId = null;
      state.orderStatus = null;
      state.pendingUpdate = false;
      state.updatedAt = Date.now();
    }
  }

  resolveGroup(price) {
    for (const [key, config] of Object.entries(this.groupConfigs)) {
      const { minExclusive, maxInclusive } = config.priceRange;
      if (price > minExclusive && price <= maxInclusive) {
        return key;
      }
    }
    return null;
  }

  async ensureInitialOrder(state) {
    if (!this.analysisEnabled) {
      return;
    }

    if (state.pendingCreate) {
      return;
    }

    let existingOrder = this.findActiveStopLimitOrder(state.symbol);
    if (!existingOrder) {
      const fallback = this.findLatestRelevantOrder(state.symbol);
      if (fallback) {
        const status = (fallback.status || '').toUpperCase();
        if (status === 'ACK' || this.isQueuedStatus(status)) {
          existingOrder = fallback;
        } else if (status === 'FLL' || status === 'FIL') {
          console.log(`✅ StopLimitService: Latest order for ${state.symbol} already filled (status ${status}), skipping tracking.`);
          this.cleanupPosition(state.symbol);
          return;
        }
      }
    }

    if (existingOrder) {
      this.updateStateFromOrder(state, existingOrder.orderId, existingOrder.order, existingOrder.leg, existingOrder.order?.Status);
      console.log(`ℹ️ StopLimitService: Existing StopLimit order found for ${state.symbol} (status ${state.orderStatus}) - skipping creation`);
      return;
    }

    if (state.stageIndex >= 0 && state.orderId) {
      return;
    }

    state.pendingCreate = true;
    try {
      const config = this.groupConfigs[state.groupKey];
      const offsets = this.calculateStopAndLimit(state.avgPrice, config.initialOffset);
      if (!offsets) {
        console.warn(`⚠️ StopLimitService: Could not calculate initial stop/limit for ${state.symbol}`);
        return;
      }

      const { stopPrice, limitPrice } = offsets;
      console.log(`🛡️ StopLimitService: Creating initial StopLimit for ${state.symbol} (${config.label}) - stop ${stopPrice}, limit ${limitPrice}`);

      await this.deleteExistingSellOrders(state.symbol);

      const body = {
        symbol: state.symbol,
        side: 'SELL',
        order_type: 'StopLimit',
        quantity: Math.max(1, Math.round(state.quantity)),
        stop_price: stopPrice,
        limit_price: limitPrice
      };

      const response = await this.postOrder(body);
      if (response.success) {
        state.stageIndex = 0;
        state.lastStopPrice = stopPrice;
        state.lastLimitPrice = limitPrice;
        if (response.orderId) {
          state.orderId = response.orderId;
          console.log(`✅ StopLimitService: Initial StopLimit order created for ${state.symbol} (order_id=${response.orderId})`);
        } else {
          console.warn(`⚠️ StopLimitService: Initial StopLimit created for ${state.symbol} but no order_id returned`);
        }
        state.updatedAt = Date.now();
      } else {
        console.error(`❌ StopLimitService: Failed to create StopLimit for ${state.symbol}: ${response.error || response.notifyStatus}`);
        if (await this.maybeAttachExistingStopLimit(state, 'create-rejected')) {
          console.log(`ℹ️ StopLimitService: Linked existing StopLimit order for ${state.symbol} after rejection.`);
        }
      }
    } catch (err) {
      console.error(`❌ StopLimitService: Error creating StopLimit for ${state.symbol}:`, err);
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

    // Evaluate stages sequentially
    for (let index = 0; index < config.stages.length; index += 1) {
      const stageNumber = index + 1;
      const stage = config.stages[index];
      if (unrealizedQty >= stage.trigger && state.stageIndex < stageNumber) {
        await this.updateStopLimitStage(state, stage.stopOffset, stage.label, stageNumber);
      }
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

    const { stopPrice, limitPrice } = offsets;
    if (this.isApproximatelyEqual(stopPrice, state.lastStopPrice) && this.isApproximatelyEqual(limitPrice, state.lastLimitPrice)) {
      return;
    }

    const existing = state.orderId ? { orderId: state.orderId } : this.findActiveStopLimitOrder(state.symbol);
    const orderId = existing?.orderId || state.orderId;
    if (!orderId) {
      console.warn(`⚠️ StopLimitService: No active StopLimit order found for ${state.symbol} while updating stage ${stageNumber}`);
      return;
    }

    state.pendingUpdate = true;
    try {
      console.log(`🔄 StopLimitService: Updating StopLimit for ${state.symbol} to stage ${stageNumber} (${label}) - stop ${stopPrice}, limit ${limitPrice}`);
      const result = await this.putOrder(orderId, stopPrice, limitPrice);
      if (result.success) {
        state.stageIndex = stageNumber;
        state.lastStopPrice = stopPrice;
        state.lastLimitPrice = limitPrice;
        state.updatedAt = Date.now();
      } else {
        console.error(`❌ StopLimitService: Failed to update order ${orderId} for ${state.symbol}: ${result.error || result.notifyStatus}`);
      }
    } catch (err) {
      console.error(`❌ StopLimitService: Error updating StopLimit for ${state.symbol}:`, err);
    } finally {
      state.pendingUpdate = false;
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

  async deleteExistingSellOrders(symbol) {
    if (!this.analysisEnabled) {
      return;
    }

    const orders = this.findActiveSellOrders(symbol);
    if (!orders.length) {
      return;
    }

    const cancellableOrders = orders.filter(order => !this.isQueuedStatus(order.status));
    if (!cancellableOrders.length) {
      console.log(`ℹ️ StopLimitService: Existing SELL order(s) for ${symbol} are queued; keeping pending order in place.`);
      return;
    }

    console.log(`🗑️ StopLimitService: Deleting ${cancellableOrders.length} existing SELL order(s) for ${symbol} before creating new StopLimit`);
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
      const result = {
        success,
        notifyStatus,
        responseData: data,
        orderId: success ? this.extractOrderId(data) : null
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
    if (!data || typeof data !== 'object') return null;
    return data.order_id || data.orderId || data.OrderID || data.id || null;
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
    this.refreshTrackedPositionsFromCaches();

    const rows = [];
    for (const state of this.trackedPositions.values()) {
      if (!this.hasActivePosition(state.symbol)) {
        continue;
      }
      rows.push(this.toSnapshot(state));
    }
    return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
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
    if (state.pendingCreate) return 'creating-order';
    if (state.pendingUpdate) return 'updating-order';
    if (!state.orderId) {
      return state.stageIndex <= 0 ? 'awaiting-stoplimit' : 'awaiting-ack';
    }
    if (orderStatus === 'DON' || orderStatus === 'QUE' || orderStatus === 'QUEUED') {
      return 'queued';
    }
    return 'active';
  }

  getStatusLabel(status) {
    switch (status) {
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

