const { OrderCache, PositionCache, CacheMetadata } = require('../models/cache.model');
const mongoose = require('mongoose');

class CachePersistenceService {
  constructor(ordersCache, positionsCache) {
    this.ordersCache = ordersCache;
    this.positionsCache = positionsCache;
    this.saveInterval = null;
    this.isSaving = false;
    this.pendingSaves = {
      orders: new Set(),
      positions: new Set()
    };
    this.saveDebounceMs = 2000; // Save to DB 2 seconds after last change
    this.saveIntervalMs = 30000; // Also save every 30 seconds as backup
    this.lastSaveTime = {
      orders: 0,
      positions: 0
    };
    this.saveTimeouts = {
      orders: null,
      positions: null
    };
  }

  /**
   * Check if database is available
   */
  isDbAvailable() {
    return mongoose.connection && mongoose.connection.readyState === 1;
  }

  /**
   * Load all cached data from database on startup
   */
  async loadFromDatabase() {
    if (!this.isDbAvailable()) {
      console.warn('⚠️ CachePersistenceService: Database not available, skipping cache load');
      return { orders: 0, positions: 0 };
    }

    try {
      console.log('📥 CachePersistenceService: Loading cache from database...');
      
      // Load orders
      const ordersFromDb = await OrderCache.find({}).lean();
      let loadedOrders = 0;
      for (const doc of ordersFromDb) {
        try {
          // Update lastUpdated to current time if it's missing
          const orderData = {
            ...doc.orderData,
            lastUpdated: doc.orderData.lastUpdated || Date.now()
          };
          this.ordersCache.set(doc.orderId, orderData);
          loadedOrders++;
        } catch (err) {
          console.error(`⚠️ CachePersistenceService: Error loading order ${doc.orderId}:`, err.message);
        }
      }

      // Load positions
      const positionsFromDb = await PositionCache.find({}).lean();
      let loadedPositions = 0;
      for (const doc of positionsFromDb) {
        try {
          // Update lastUpdated to current time if it's missing
          const positionData = {
            ...doc.positionData,
            lastUpdated: doc.positionData.lastUpdated || Date.now()
          };
          this.positionsCache.set(doc.symbol, positionData);
          loadedPositions++;
        } catch (err) {
          console.error(`⚠️ CachePersistenceService: Error loading position ${doc.symbol}:`, err.message);
        }
      }

      console.log(`✅ CachePersistenceService: Loaded ${loadedOrders} orders and ${loadedPositions} positions from database`);
      
      // Update metadata
      await this.updateMetadata(loadedOrders, loadedPositions);
      
      return { orders: loadedOrders, positions: loadedPositions };
    } catch (err) {
      console.error('❌ CachePersistenceService: Error loading from database:', err);
      return { orders: 0, positions: 0 };
    }
  }

  /**
   * Save a single order to database (debounced)
   */
  async scheduleOrderSave(orderId) {
    if (!this.isDbAvailable()) {
      return;
    }

    this.pendingSaves.orders.add(orderId);

    // Clear existing timeout
    if (this.saveTimeouts.orders) {
      clearTimeout(this.saveTimeouts.orders);
    }

    // Schedule save after debounce period
    this.saveTimeouts.orders = setTimeout(() => {
      this.savePendingOrders();
    }, this.saveDebounceMs);
  }

  /**
   * Save a single position to database (debounced)
   */
  async schedulePositionSave(symbol) {
    if (!this.isDbAvailable()) {
      return;
    }

    this.pendingSaves.positions.add(symbol);

    // Clear existing timeout
    if (this.saveTimeouts.positions) {
      clearTimeout(this.saveTimeouts.positions);
    }

    // Schedule save after debounce period
    this.saveTimeouts.positions = setTimeout(() => {
      this.savePendingPositions();
    }, this.saveDebounceMs);
  }

  /**
   * Save pending orders to database
   */
  async savePendingOrders() {
    if (this.isSaving || !this.isDbAvailable() || this.pendingSaves.orders.size === 0) {
      return;
    }

    this.isSaving = true;
    const toSave = Array.from(this.pendingSaves.orders);
    this.pendingSaves.orders.clear();

    try {
      const operations = [];
      for (const orderId of toSave) {
        const orderData = this.ordersCache.get(orderId);
        if (orderData) {
          // Use upsert to update or create
          operations.push({
            updateOne: {
              filter: { orderId },
              update: {
                $set: {
                  orderData,
                  lastUpdated: orderData.lastUpdated || Date.now()
                }
              },
              upsert: true
            }
          });
        } else {
          // Order was deleted, remove from DB
          operations.push({
            deleteOne: {
              filter: { orderId }
            }
          });
        }
      }

      if (operations.length > 0) {
        await OrderCache.bulkWrite(operations, { ordered: false });
        this.lastSaveTime.orders = Date.now();
      }
    } catch (err) {
      console.error('❌ CachePersistenceService: Error saving orders to database:', err);
      // Re-add to pending saves for retry
      toSave.forEach(id => this.pendingSaves.orders.add(id));
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Save pending positions to database
   */
  async savePendingPositions() {
    if (this.isSaving || !this.isDbAvailable() || this.pendingSaves.positions.size === 0) {
      return;
    }

    this.isSaving = true;
    const toSave = Array.from(this.pendingSaves.positions);
    this.pendingSaves.positions.clear();

    try {
      const operations = [];
      for (const symbol of toSave) {
        const positionData = this.positionsCache.get(symbol);
        if (positionData) {
          // Use upsert to update or create
          operations.push({
            updateOne: {
              filter: { symbol },
              update: {
                $set: {
                  positionData,
                  lastUpdated: positionData.lastUpdated || Date.now()
                }
              },
              upsert: true
            }
          });
        } else {
          // Position was deleted, remove from DB
          operations.push({
            deleteOne: {
              filter: { symbol }
            }
          });
        }
      }

      if (operations.length > 0) {
        await PositionCache.bulkWrite(operations, { ordered: false });
        this.lastSaveTime.positions = Date.now();
      }
    } catch (err) {
      console.error('❌ CachePersistenceService: Error saving positions to database:', err);
      // Re-add to pending saves for retry
      toSave.forEach(symbol => this.pendingSaves.positions.add(symbol));
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Save all cache to database immediately (force save)
   */
  async saveAllToDatabase() {
    if (!this.isDbAvailable()) {
      console.warn('⚠️ CachePersistenceService: Database not available, skipping save');
      return { orders: 0, positions: 0 };
    }

    try {
      // Save all orders
      const orderOperations = [];
      for (const [orderId, orderData] of this.ordersCache.entries()) {
        orderOperations.push({
          updateOne: {
            filter: { orderId },
            update: {
              $set: {
                orderData,
                lastUpdated: orderData.lastUpdated || Date.now()
              }
            },
            upsert: true
          }
        });
      }
      // Delete orders that exist in DB but not in cache
      const allOrderIds = Array.from(this.ordersCache.keys());
      const existingOrderDocs = await OrderCache.find({}).select('orderId').lean();
      const dbOrderIds = new Set(existingOrderDocs.map(doc => doc.orderId));
      for (const dbOrderId of dbOrderIds) {
        if (!allOrderIds.includes(dbOrderId)) {
          orderOperations.push({
            deleteOne: { filter: { orderId: dbOrderId } }
          });
        }
      }

      if (orderOperations.length > 0) {
        await OrderCache.bulkWrite(orderOperations, { ordered: false });
      }

      // Save all positions
      const positionOperations = [];
      for (const [symbol, positionData] of this.positionsCache.entries()) {
        positionOperations.push({
          updateOne: {
            filter: { symbol },
            update: {
              $set: {
                positionData,
                lastUpdated: positionData.lastUpdated || Date.now()
              }
            },
            upsert: true
          }
        });
      }
      // Delete positions that exist in DB but not in cache
      const allSymbols = Array.from(this.positionsCache.keys());
      const existingPositionDocs = await PositionCache.find({}).select('symbol').lean();
      const dbSymbols = new Set(existingPositionDocs.map(doc => doc.symbol));
      for (const dbSymbol of dbSymbols) {
        if (!allSymbols.includes(dbSymbol)) {
          positionOperations.push({
            deleteOne: { filter: { symbol: dbSymbol } }
          });
        }
      }

      if (positionOperations.length > 0) {
        await PositionCache.bulkWrite(positionOperations, { ordered: false });
      }

      // Update metadata
      await this.updateMetadata(this.ordersCache.size, this.positionsCache.size);

      console.log(`✅ CachePersistenceService: Saved ${this.ordersCache.size} orders and ${this.positionsCache.size} positions to database`);
      return { orders: this.ordersCache.size, positions: this.positionsCache.size };
    } catch (err) {
      console.error('❌ CachePersistenceService: Error saving to database:', err);
      return { orders: 0, positions: 0 };
    }
  }

  /**
   * Update cache metadata
   */
  async updateMetadata(ordersCount, positionsCount) {
    if (!this.isDbAvailable()) {
      return;
    }

    try {
      await CacheMetadata.findOneAndUpdate(
        { key: 'global' },
        {
          $set: {
            lastOrdersSync: Date.now(),
            lastPositionsSync: Date.now(),
            ordersCount,
            positionsCount
          }
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('⚠️ CachePersistenceService: Error updating metadata:', err);
    }
  }

  /**
   * Start periodic save interval
   */
  startPeriodicSave() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }

    this.saveInterval = setInterval(() => {
      this.saveAllToDatabase().catch(err => {
        console.error('❌ CachePersistenceService: Error in periodic save:', err);
      });
    }, this.saveIntervalMs);

    console.log(`✅ CachePersistenceService: Started periodic save every ${this.saveIntervalMs}ms`);
  }

  /**
   * Stop periodic save
   */
  stopPeriodicSave() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    if (this.saveTimeouts.orders) {
      clearTimeout(this.saveTimeouts.orders);
      this.saveTimeouts.orders = null;
    }
    if (this.saveTimeouts.positions) {
      clearTimeout(this.saveTimeouts.positions);
      this.saveTimeouts.positions = null;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    if (!this.isDbAvailable()) {
      return {
        inMemory: {
          orders: this.ordersCache.size,
          positions: this.positionsCache.size
        },
        database: null
      };
    }

    try {
      const metadata = await CacheMetadata.findOne({ key: 'global' }).lean();
      const dbOrdersCount = await OrderCache.countDocuments();
      const dbPositionsCount = await PositionCache.countDocuments();

      return {
        inMemory: {
          orders: this.ordersCache.size,
          positions: this.positionsCache.size
        },
        database: {
          orders: dbOrdersCount,
          positions: dbPositionsCount,
          lastOrdersSync: metadata?.lastOrdersSync || 0,
          lastPositionsSync: metadata?.lastPositionsSync || 0
        }
      };
    } catch (err) {
      console.error('⚠️ CachePersistenceService: Error getting stats:', err);
      return {
        inMemory: {
          orders: this.ordersCache.size,
          positions: this.positionsCache.size
        },
        database: null
      };
    }
  }
}

module.exports = CachePersistenceService;
