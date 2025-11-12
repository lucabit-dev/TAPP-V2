const fetch = require('node-fetch');

const ACTIVE_ORDER_STATUSES = new Set(['ACK', 'DON', 'REC', 'QUE', 'QUEUED']);
const NON_ACTIVE_STATUSES = new Set(['CAN', 'FIL', 'EXP', 'OUT', 'REJ', 'FLL']);

class StopLimitService {
  constructor({ ordersCache }) {
    this.ordersCache = ordersCache;
    this.trackedPositions = new Map(); // Map<symbol, PositionState>

    this.limitOffset = 0.05; // stop_price = limit_price + 0.05
    this.apiBaseUrl = 'https://sections-bot.inbitme.com';

    this.groupConfigs = {
      A: {
        label: 'Group A',
        priceRange: { minExclusive: 0, maxInclusive: 5 },
        initialOffset: -0.20,
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
        initialOffset: -0.35,
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
        initialOffset: -0.45,
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
      await this.ensureInitialOrder(state);
    } else {
      state.avgPrice = avgPrice;
      state.quantity = quantity;
      state.positionId = position?.PositionID || state.positionId;
      state.lastUnrealizedQty = unrealizedQty;
      state.updatedAt = Date.now();
    }

    if (state.autoSellExecuted) {
      return;
    }

    await this.evaluateAdjustments(state, unrealizedQty);
  }

  handleOrderUpdate(order) {
    if (!order || !order.OrderID || !order.Legs || !Array.isArray(order.Legs)) {
      return;
    }

    const leg = order.Legs.find(l => (l.Symbol || '').toUpperCase());
    if (!leg) return;

    const symbol = (leg.Symbol || '').toUpperCase();
    if (!symbol) return;

    const state = this.trackedPositions.get(symbol);
    if (!state) return;

    if ((order.OrderType || '').toUpperCase() !== 'STOPLIMIT') return;
    if ((leg.BuyOrSell || '').toUpperCase() !== 'SELL') return;

    const status = (order.Status || '').toUpperCase();
    state.orderStatus = status;
    if (ACTIVE_ORDER_STATUSES.has(status)) {
      if (state.orderId !== order.OrderID) {
        console.log(`📝 StopLimitService: Linked StopLimit order ${order.OrderID} to ${symbol}`);
      }
      state.orderId = order.OrderID;
      state.updatedAt = Date.now();
    } else if (NON_ACTIVE_STATUSES.has(status)) {
      if (state.orderId === order.OrderID) {
        console.log(`ℹ️ StopLimitService: StopLimit order ${order.OrderID} for ${symbol} is no longer active (status ${status})`);
        state.orderId = null;
        state.orderStatus = status;
        state.updatedAt = Date.now();

        if (status === 'FLL' || status === 'FIL') {
          console.log(`✅ StopLimitService: Position ${symbol} filled (order status ${status}) – ending tracking.`);
          this.cleanupPosition(symbol);
        } else if (status === 'OUT' || status === 'REJ') {
          const fallback = this.findLatestRelevantOrder(symbol);
          if (!fallback) {
            console.log(`ℹ️ StopLimitService: No follow-up order found for ${symbol} after ${status}; keeping position tracked.`);
          } else {
            const fallbackStatus = (fallback.status || '').toUpperCase();
            if (this.isQueuedStatus(fallbackStatus) || fallbackStatus === 'ACK') {
              console.log(`ℹ️ StopLimitService: Found fallback order ${fallback.orderId} with status ${fallbackStatus} for ${symbol}; re-linking.`);
              state.orderId = fallback.orderId;
              state.orderStatus = fallbackStatus;
              state.updatedAt = Date.now();
              const limit = this.parseNumber(fallback.order.LimitPrice ?? fallback.leg?.LimitPrice ?? fallback.leg?.Price);
              if (limit !== null && limit !== undefined) {
                state.lastLimitPrice = limit;
              }
              const stopPrice = this.parseNumber(fallback.order.StopPrice ?? fallback.order.StopLimitPrice ?? fallback.leg?.StopPrice ?? fallback.leg?.StopLimitPrice);
              if (stopPrice !== null && stopPrice !== undefined) {
                state.lastStopPrice = stopPrice;
              }
            } else if (fallbackStatus === 'FLL' || fallbackStatus === 'FIL') {
              console.log(`✅ StopLimitService: Fallback order ${fallback.orderId} is filled; cleaning up position ${symbol}.`);
              this.cleanupPosition(symbol);
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
    if (state.pendingCreate) {
      return;
    }

    const existingOrder = this.findActiveStopLimitOrder(state.symbol);
    if (existingOrder) {
      const { orderId, order } = existingOrder;
      state.orderId = orderId;
      state.orderStatus = (order.Status || '').toUpperCase();
      state.stageIndex = Math.max(state.stageIndex, 0);
      const existingLimit = this.parseNumber(order.LimitPrice);
      if (existingLimit !== null && existingLimit !== undefined) {
        state.lastLimitPrice = existingLimit;
      } else if (order.Legs && order.Legs.length > 0) {
        const legLimit = this.parseNumber(order.Legs[0].LimitPrice ?? order.Legs[0].Price);
        if (legLimit !== null && legLimit !== undefined) {
          state.lastLimitPrice = legLimit;
        }
      }
      const existingStop = this.parseNumber(order.StopPrice ?? order.StopLimitPrice ?? order.StopPriceValue);
      if (existingStop !== null && existingStop !== undefined) {
        state.lastStopPrice = existingStop;
      } else if (order.Legs && order.Legs.length > 0) {
        const legStop = this.parseNumber(order.Legs[0].StopPrice ?? order.Legs[0].StopLimitPrice);
        if (legStop !== null && legStop !== undefined) {
          state.lastStopPrice = legStop;
        }
      }
      state.updatedAt = Date.now();
      state.pendingCreate = false;
      console.log(`ℹ️ StopLimitService: Existing StopLimit order found for ${state.symbol} (status ${state.orderStatus}) - skipping creation`);
      return;
    }

    if (state.stageIndex >= 0) {
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
      }
    } catch (err) {
      console.error(`❌ StopLimitService: Error creating StopLimit for ${state.symbol}:`, err);
    } finally {
      state.pendingCreate = false;
    }
  }

  async evaluateAdjustments(state, unrealizedQty) {
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
          return { orderId, order };
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
    return data.order_id || data.orderId || data.id || null;
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
    const rows = [];
    for (const state of this.trackedPositions.values()) {
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
}

module.exports = StopLimitService;

