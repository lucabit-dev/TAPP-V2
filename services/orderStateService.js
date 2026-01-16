const { OrderState } = require('../models/orderState.model');
const fetch = require('node-fetch');

/**
 * Status normalization: Maps broker status codes to ACTIVE/INACTIVE
 */
const ACTIVE_STATUSES = new Set([
  'DON', 'QUE', 'QUEUED',           // Queued
  'ACK', 'REC', 'RECEIVED',         // Received/Acknowledged
  'NEW', 'OPEN', 'PENDING', 'PND',  // New/Open/Pending
  'PARTIALLY_FILLED', 'PARTIAL',    // Partially filled (still active)
  'WORKING', 'ACTIVE'                // Working/Active
]);

const INACTIVE_STATUSES = new Set([
  'FILLED', 'FIL', 'FLL',           // Filled
  'CANCELED', 'CAN', 'CANCELLED',   // Canceled
  'EXPIRED', 'EXP',                 // Expired
  'REJECTED', 'REJ',                // Rejected
  'OUT', 'CLOSED'                   // Out/Closed
]);

/**
 * Normalizes broker status to ACTIVE or INACTIVE
 */
function normalizeStatus(statusRaw) {
  if (!statusRaw) return 'INACTIVE';
  const upper = statusRaw.toUpperCase().trim();
  if (ACTIVE_STATUSES.has(upper)) return 'ACTIVE';
  if (INACTIVE_STATUSES.has(upper)) return 'INACTIVE';
  // Default to INACTIVE for unknown statuses (safer)
  console.warn(`⚠️ Unknown order status: ${statusRaw}, defaulting to INACTIVE`);
  return 'INACTIVE';
}

/**
 * Extracts order data from broker order object
 */
function extractOrderData(order) {
  const orderId = order.OrderID || order.order_id || order.id;
  if (!orderId) {
    throw new Error('Order missing OrderID');
  }

  // Extract symbol from Legs array or direct field
  let symbol = order.Symbol || order.symbol;
  if (!symbol && order.Legs && order.Legs.length > 0) {
    symbol = order.Legs[0].Symbol || order.Legs[0].symbol;
  }
  if (!symbol) {
    throw new Error(`Order ${orderId} missing symbol`);
  }

  // Extract side from order
  const sideRaw = (order.Side || order.side || '').toLowerCase();
  const side = sideRaw === 'sell' || sideRaw === 's' ? 'sell' : 'buy';

  // Extract type
  const typeRaw = order.OrderType || order.order_type || order.Type || order.type || '';
  const type = typeRaw.toLowerCase().replace(/_/g, '_');

  // Extract prices
  const limitPrice = parseFloat(order.LimitPrice || order.limit_price || order.Limit || order.limit || 0);
  const stopPrice = parseFloat(order.StopPrice || order.stop_price || order.Stop || order.stop || 0);

  // Extract quantities
  const qty = parseFloat(order.Quantity || order.quantity || order.Qty || order.qty || 0);
  const remainingQty = parseFloat(order.RemainingQuantity || order.remaining_quantity || order.RemainingQty || order.remaining_qty || qty);

  const statusRaw = (order.Status || order.status || '').toString().trim();

  return {
    brokerOrderId: orderId.toString(),
    clientOrderId: order.ClientOrderID || order.client_order_id || null,
    symbol: symbol.toUpperCase().trim(),
    side,
    statusRaw,
    statusNorm: normalizeStatus(statusRaw),
    type,
    limitPrice: limitPrice || null,
    stopPrice: stopPrice || null,
    qty,
    remainingQty: remainingQty || qty,
    fullOrderData: order
  };
}

/**
 * OrderStateService - Manages order state persistence and reconciliation
 */
class OrderStateService {
  constructor(apiBaseUrl, apiKey) {
    this.apiBaseUrl = apiBaseUrl || 'https://sections-bot.inbitme.com';
    this.apiKey = apiKey || process.env.PNL_API_KEY;
    
    // In-memory map: activeOrdersBySymbolSide[symbol][side] = { brokerOrderId, statusRaw, ... }
    this.activeOrdersBySymbolSide = new Map();
    
    // Per-symbol mutex for order placement (prevents concurrent duplicate orders)
    this.orderLocks = new Map(); // Map<symbol, Promise>
    
    // Track last reconciliation time per symbol
    this.lastReconciliationBySymbol = new Map(); // Map<symbol, timestamp>
    this.reconciliationCooldown = 5000; // 5 seconds cooldown between reconciliations
  }

  /**
   * Upsert order to MongoDB and update in-memory map
   */
  async upsertOrder(order, source = 'ws') {
    try {
      const orderData = extractOrderData(order);
      orderData.source = source;
      orderData.updatedAt = new Date();

      const result = await OrderState.findOneAndUpdate(
        { brokerOrderId: orderData.brokerOrderId },
        orderData,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Update in-memory map if ACTIVE
      if (orderData.statusNorm === 'ACTIVE') {
        if (!this.activeOrdersBySymbolSide.has(orderData.symbol)) {
          this.activeOrdersBySymbolSide.set(orderData.symbol, new Map());
        }
        const symbolMap = this.activeOrdersBySymbolSide.get(orderData.symbol);
        symbolMap.set(orderData.side, {
          brokerOrderId: orderData.brokerOrderId,
          statusRaw: orderData.statusRaw,
          statusNorm: orderData.statusNorm,
          type: orderData.type,
          limitPrice: orderData.limitPrice,
          stopPrice: orderData.stopPrice,
          qty: orderData.qty,
          remainingQty: orderData.remainingQty,
          updatedAt: orderData.updatedAt.getTime()
        });
      } else {
        // Remove from in-memory map if INACTIVE
        const symbolMap = this.activeOrdersBySymbolSide.get(orderData.symbol);
        if (symbolMap) {
          symbolMap.delete(orderData.side);
          if (symbolMap.size === 0) {
            this.activeOrdersBySymbolSide.delete(orderData.symbol);
          }
        }
      }

      return result;
    } catch (err) {
      console.error(`❌ Error upserting order to DB:`, err);
      throw err;
    }
  }

  /**
   * Get active sell order for a symbol (checks in-memory, then DB, then broker REST)
   */
  async getActiveSell(symbol) {
    const normalizedSymbol = (symbol || '').toUpperCase().trim();
    if (!normalizedSymbol) {
      return null;
    }

    // 1) Check in-memory map first (fastest)
    const symbolMap = this.activeOrdersBySymbolSide.get(normalizedSymbol);
    if (symbolMap) {
      const activeSell = symbolMap.get('sell');
      if (activeSell) {
        return activeSell;
      }
    }

    // 2) Query MongoDB (if in-memory miss)
    try {
      const dbOrder = await OrderState.findOne(
        { symbol: normalizedSymbol, side: 'sell', statusNorm: 'ACTIVE' },
        null,
        { sort: { updatedAt: -1 } }
      );

      if (dbOrder) {
        // Update in-memory map
        if (!this.activeOrdersBySymbolSide.has(normalizedSymbol)) {
          this.activeOrdersBySymbolSide.set(normalizedSymbol, new Map());
        }
        const symbolMap = this.activeOrdersBySymbolSide.get(normalizedSymbol);
        symbolMap.set('sell', {
          brokerOrderId: dbOrder.brokerOrderId,
          statusRaw: dbOrder.statusRaw,
          statusNorm: dbOrder.statusNorm,
          type: dbOrder.type,
          limitPrice: dbOrder.limitPrice,
          stopPrice: dbOrder.stopPrice,
          qty: dbOrder.qty,
          remainingQty: dbOrder.remainingQty,
          updatedAt: dbOrder.updatedAt.getTime()
        });
        return symbolMap.get('sell');
      }
    } catch (err) {
      console.error(`❌ Error querying DB for active sell order (${normalizedSymbol}):`, err);
    }

    // 3) If still uncertain or last update is stale (> 30 seconds), reconcile with broker
    const lastRecon = this.lastReconciliationBySymbol.get(normalizedSymbol) || 0;
    const now = Date.now();
    if (now - lastRecon > 30000) { // 30 seconds
      console.log(`🔄 Reconciling orders for ${normalizedSymbol} (stale or missing data)`);
      await this.reconcileSymbolOrders(normalizedSymbol);
      
      // Check in-memory map again after reconciliation
      const symbolMap = this.activeOrdersBySymbolSide.get(normalizedSymbol);
      if (symbolMap) {
        return symbolMap.get('sell') || null;
      }
    }

    return null;
  }

  /**
   * Reconcile orders for a specific symbol by fetching from broker REST API
   */
  async reconcileSymbolOrders(symbol) {
    const normalizedSymbol = (symbol || '').toUpperCase().trim();
    if (!normalizedSymbol) {
      return;
    }

    const now = Date.now();
    const lastRecon = this.lastReconciliationBySymbol.get(normalizedSymbol) || 0;
    if (now - lastRecon < this.reconciliationCooldown) {
      // Too soon, skip
      return;
    }

    this.lastReconciliationBySymbol.set(normalizedSymbol, now);

    try {
      // Fetch open orders from broker REST API
      // Note: Broker may not have a REST endpoint for orders (WebSocket only)
      // If endpoint doesn't exist, we'll rely on WebSocket updates
      const url = `${this.apiBaseUrl}/orders`;
      const headers = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
        headers['X-API-Key'] = this.apiKey;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        // Endpoint may not exist (404) or may require different auth - that's OK
        if (response.status === 404) {
          console.log(`ℹ️ Broker orders REST endpoint not available (404), relying on WebSocket updates for ${normalizedSymbol}`);
        } else {
          console.warn(`⚠️ Failed to fetch orders from broker (${response.status}): ${response.statusText}`);
        }
        return;
      }

      const orders = await response.json();
      if (!Array.isArray(orders)) {
        console.warn(`⚠️ Broker orders endpoint returned non-array:`, typeof orders);
        return;
      }

      // Filter orders for this symbol and upsert
      let reconciledCount = 0;
      for (const order of orders) {
        const orderData = extractOrderData(order);
        if (orderData.symbol === normalizedSymbol) {
          await this.upsertOrder(order, 'rest_snapshot');
          reconciledCount++;
        }
      }

      // Mark previously-active orders as INACTIVE if they're not in broker response
      // (only for this symbol)
      const activeInDb = await OrderState.find({
        symbol: normalizedSymbol,
        statusNorm: 'ACTIVE'
      });

      const brokerOrderIds = new Set(
        orders
          .filter(o => {
            const od = extractOrderData(o);
            return od.symbol === normalizedSymbol;
          })
          .map(o => (o.OrderID || o.order_id || o.id).toString())
      );

      for (const dbOrder of activeInDb) {
        if (!brokerOrderIds.has(dbOrder.brokerOrderId)) {
          // Order not in broker response, but might still be active (broker might not return all)
          // Only mark as INACTIVE if we can verify it's truly closed
          // For now, we'll keep it as-is and let websocket updates handle status changes
          console.log(`⚠️ Order ${dbOrder.brokerOrderId} (${normalizedSymbol}) not in broker snapshot, keeping status`);
        }
      }

      if (reconciledCount > 0) {
        console.log(`✅ Reconciled ${reconciledCount} orders for ${normalizedSymbol}`);
      }
    } catch (err) {
      console.error(`❌ Error reconciling orders for ${normalizedSymbol}:`, err.message);
    }
  }

  /**
   * Rehydrate active orders from MongoDB on startup/reconnect
   */
  async rehydrateActiveOrders() {
    try {
      console.log('🔄 Rehydrating active orders from MongoDB...');
      
      // Load all ACTIVE orders from DB
      const activeOrders = await OrderState.find({
        statusNorm: 'ACTIVE'
      }).sort({ updatedAt: -1 });

      // Build in-memory map
      this.activeOrdersBySymbolSide.clear();
      for (const order of activeOrders) {
        if (!this.activeOrdersBySymbolSide.has(order.symbol)) {
          this.activeOrdersBySymbolSide.set(order.symbol, new Map());
        }
        const symbolMap = this.activeOrdersBySymbolSide.get(order.symbol);
        symbolMap.set(order.side, {
          brokerOrderId: order.brokerOrderId,
          statusRaw: order.statusRaw,
          statusNorm: order.statusNorm,
          type: order.type,
          limitPrice: order.limitPrice,
          stopPrice: order.stopPrice,
          qty: order.qty,
          remainingQty: order.remainingQty,
          updatedAt: order.updatedAt.getTime()
        });
      }

      console.log(`✅ Rehydrated ${activeOrders.length} active orders from DB`);

      // Immediately reconcile with broker REST snapshot
      const symbols = new Set(activeOrders.map(o => o.symbol));
      console.log(`🔄 Reconciling ${symbols.size} symbols with broker snapshot...`);
      
      // Reconcile in parallel (with rate limiting)
      const reconcilePromises = [];
      let delay = 0;
      for (const symbol of symbols) {
        reconcilePromises.push(
          new Promise(resolve => {
            setTimeout(() => {
              this.reconcileSymbolOrders(symbol).then(resolve).catch(err => {
                console.error(`❌ Reconciliation error for ${symbol}:`, err);
                resolve();
              });
            }, delay);
            delay += 200; // 200ms delay between reconciliations
          })
        );
      }

      await Promise.all(reconcilePromises);
      console.log('✅ Rehydration and reconciliation complete');
    } catch (err) {
      console.error('❌ Error rehydrating active orders:', err);
      throw err;
    }
  }

  /**
   * Acquire lock for placing an order (prevents concurrent duplicate orders)
   */
  async acquireOrderLock(symbol) {
    const normalizedSymbol = (symbol || '').toUpperCase().trim();
    if (!normalizedSymbol) {
      throw new Error('Invalid symbol for order lock');
    }

    // Wait for existing lock to release
    while (this.orderLocks.has(normalizedSymbol)) {
      await this.orderLocks.get(normalizedSymbol);
    }

    // Create new lock promise
    let releaseLock;
    const lockPromise = new Promise(resolve => {
      releaseLock = resolve;
    });
    this.orderLocks.set(normalizedSymbol, lockPromise);

    return releaseLock;
  }

  /**
   * Release lock for placing an order
   */
  releaseOrderLock(symbol) {
    const normalizedSymbol = (symbol || '').toUpperCase().trim();
    const lock = this.orderLocks.get(normalizedSymbol);
    if (lock) {
      this.orderLocks.delete(normalizedSymbol);
      lock(); // Resolve the promise
    }
  }
}

module.exports = OrderStateService;
