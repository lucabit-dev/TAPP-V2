const { OrderCache, PositionCache, StopLimitRepository, CacheMetadata } = require('../models/cache.model');
const mongoose = require('mongoose');

class CachePersistenceService {
  constructor(ordersCache, positionsCache, stopLimitOrderRepository = null) {
    this.ordersCache = ordersCache;
    this.positionsCache = positionsCache;
    this.stopLimitOrderRepository = stopLimitOrderRepository;
    this.saveInterval = null;
    this.isSaving = false;
    this.pendingSaves = {
      orders: new Set(),
      positions: new Set(),
      stopLimitRepository: new Set()
    };
    this.saveDebounceMs = 2000; // Save to DB 2 seconds after last change
    this.saveIntervalMs = 30000; // Also save every 30 seconds as backup
    this.lastSaveTime = {
      orders: 0,
      positions: 0,
      stopLimitRepository: 0
    };
    this.saveTimeouts = {
      orders: null,
      positions: null,
      stopLimitRepository: null
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

      // Load StopLimit repository if available
      let loadedStopLimitRepo = 0;
      if (this.stopLimitOrderRepository) {
        const stopLimitRepoFromDb = await StopLimitRepository.find({}).lean();
        for (const doc of stopLimitRepoFromDb) {
          try {
            this.stopLimitOrderRepository.set(doc.symbol, {
              orderId: doc.orderId,
              order: doc.order || null,
              openedDateTime: doc.openedDateTime,
              status: doc.status
            });
            loadedStopLimitRepo++;
          } catch (err) {
            console.error(`⚠️ CachePersistenceService: Error loading StopLimit repository entry for ${doc.symbol}:`, err.message);
          }
        }
      }

      console.log(`✅ CachePersistenceService: Loaded ${loadedOrders} orders, ${loadedPositions} positions, and ${loadedStopLimitRepo} StopLimit repository entries from database`);
      
      // Update metadata
      await this.updateMetadata(loadedOrders, loadedPositions, loadedStopLimitRepo);
      
      return { orders: loadedOrders, positions: loadedPositions, stopLimitRepository: loadedStopLimitRepo };
    } catch (err) {
      console.error('❌ CachePersistenceService: Error loading from database:', err);
      return { orders: 0, positions: 0, stopLimitRepository: 0 };
    }
  }

  /**
   * Load orders and StopLimit repository only (no positions). Used on Orders WS reconnect
   * so we reconcile orders/stoplimit from DB without clearing positionsCache (avoids
   * "no position" window that breaks stop-limit creation after long uptime).
   */
  async loadOrdersAndStopLimitFromDatabase() {
    if (!this.isDbAvailable()) {
      console.warn('⚠️ CachePersistenceService: Database not available, skipping orders/stoplimit load');
      return { orders: 0, stopLimitRepository: 0 };
    }
    try {
      console.log('📥 CachePersistenceService: Loading orders and StopLimit repo from database (skipping positions)...');
      let loadedOrders = 0;
      const ordersFromDb = await OrderCache.find({}).lean();
      for (const doc of ordersFromDb) {
        try {
          const orderData = { ...doc.orderData, lastUpdated: doc.orderData.lastUpdated || Date.now() };
          this.ordersCache.set(doc.orderId, orderData);
          loadedOrders++;
        } catch (err) {
          console.error(`⚠️ CachePersistenceService: Error loading order ${doc.orderId}:`, err.message);
        }
      }
      let loadedStopLimitRepo = 0;
      if (this.stopLimitOrderRepository) {
        const stopLimitRepoFromDb = await StopLimitRepository.find({}).lean();
        for (const doc of stopLimitRepoFromDb) {
          try {
            this.stopLimitOrderRepository.set(doc.symbol, {
              orderId: doc.orderId,
              order: doc.order || null,
              openedDateTime: doc.openedDateTime,
              status: doc.status
            });
            loadedStopLimitRepo++;
          } catch (err) {
            console.error(`⚠️ CachePersistenceService: Error loading StopLimit repo ${doc.symbol}:`, err.message);
          }
        }
      }
      console.log(`✅ CachePersistenceService: Loaded ${loadedOrders} orders and ${loadedStopLimitRepo} StopLimit repo entries (positions unchanged)`);
      return { orders: loadedOrders, stopLimitRepository: loadedStopLimitRepo };
    } catch (err) {
      console.error('❌ CachePersistenceService: Error loading orders/stoplimit from database:', err);
      return { orders: 0, stopLimitRepository: 0 };
    }
  }

  /**
   * Get position for symbol from DB (fallback when positionsCache missing after wait).
   * Returns { ...positionData } if found and Quantity > 0, else null.
   */
  async getPositionForSymbol(symbol) {
    if (!this.isDbAvailable() || !symbol) return null;
    try {
      const doc = await PositionCache.findOne({ symbol: String(symbol).toUpperCase() }).lean();
      if (!doc?.positionData) return null;
      const qty = parseFloat(doc.positionData.Quantity || 0);
      if (qty <= 0) return null;
      return { ...doc.positionData, lastUpdated: doc.positionData.lastUpdated || Date.now() };
    } catch (err) {
      console.warn(`⚠️ CachePersistenceService: getPositionForSymbol(${symbol}) error:`, err.message);
      return null;
    }
  }

  /**
   * Get all positions from DB with Quantity > 0 (for stop-limit reconciliation when cache missing).
   * Returns Map<symbol, positionData>.
   */
  async getAllPositionsFromDb() {
    if (!this.isDbAvailable()) return new Map();
    try {
      const docs = await PositionCache.find({}).lean();
      const map = new Map();
      for (const doc of docs) {
        if (!doc?.positionData) continue;
        const qty = parseFloat(doc.positionData.Quantity || 0);
        if (qty <= 0) continue;
        const sym = (doc.symbol || '').toUpperCase();
        if (!sym) continue;
        map.set(sym, { ...doc.positionData, lastUpdated: doc.positionData.lastUpdated || Date.now() });
      }
      return map;
    } catch (err) {
      console.warn(`⚠️ CachePersistenceService: getAllPositionsFromDb error:`, err.message);
      return new Map();
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

      // Save StopLimit repository
      if (this.stopLimitOrderRepository) {
        await this.saveStopLimitRepositoryToDatabase();
      }

      // Update metadata
      const stopLimitRepoCount = this.stopLimitOrderRepository ? this.stopLimitOrderRepository.size : 0;
      await this.updateMetadata(this.ordersCache.size, this.positionsCache.size, stopLimitRepoCount);

      console.log(`✅ CachePersistenceService: Saved ${this.ordersCache.size} orders, ${this.positionsCache.size} positions, and ${stopLimitRepoCount} StopLimit repository entries to database`);
      return { orders: this.ordersCache.size, positions: this.positionsCache.size, stopLimitRepository: stopLimitRepoCount };
    } catch (err) {
      console.error('❌ CachePersistenceService: Error saving to database:', err);
      return { orders: 0, positions: 0, stopLimitRepository: 0 };
    }
  }

  /**
   * Schedule StopLimit repository entry save (debounced)
   */
  async scheduleStopLimitRepositorySave(symbol) {
    if (!this.isDbAvailable() || !this.stopLimitOrderRepository) {
      return;
    }

    this.pendingSaves.stopLimitRepository.add(symbol);

    // Clear existing timeout
    if (this.saveTimeouts.stopLimitRepository) {
      clearTimeout(this.saveTimeouts.stopLimitRepository);
    }

    // Set new timeout
    this.saveTimeouts.stopLimitRepository = setTimeout(async () => {
      await this.saveStopLimitRepositoryToDatabase();
    }, this.saveDebounceMs);
  }

  /**
   * Save StopLimit repository entry IMMEDIATELY to database (no debounce)
   * Used when order is ACK'd to ensure database is source of truth
   */
  async saveStopLimitRepositoryEntryImmediately(symbol, repoEntry) {
    if (!this.isDbAvailable()) {
      return;
    }

    try {
      await StopLimitRepository.findOneAndUpdate(
        { symbol: symbol.toUpperCase() },
        {
          $set: {
            orderId: repoEntry.orderId,
            order: repoEntry.order,
            openedDateTime: repoEntry.openedDateTime,
            status: repoEntry.status,
            lastUpdated: Date.now()
          }
        },
        { upsert: true }
      );
      console.log(`💾 [STOPLIMIT_DB] Immediately saved StopLimit repository entry for ${symbol.toUpperCase()}: ${repoEntry.orderId}`);
    } catch (err) {
      console.error(`❌ CachePersistenceService: Error immediately saving StopLimit repository entry for ${symbol}:`, err);
      throw err;
    }
  }

  /**
   * Check database directly for existing active StopLimit order
   * This is the authoritative check before creating new orders
   */
  async checkDatabaseForActiveStopLimit(symbol) {
    if (!this.isDbAvailable()) {
      return null;
    }

    try {
      const normalizedSymbol = symbol.toUpperCase();
      const dbEntry = await StopLimitRepository.findOne({ symbol: normalizedSymbol }).lean();
      
      if (!dbEntry) {
        return null;
      }

      // Check if status is active (ACK, DON, REC, etc.)
      const status = (dbEntry.status || '').toUpperCase();
      const activeStatuses = new Set(['ACK', 'DON', 'REC', 'QUE', 'QUEUED', 'OPEN', 'NEW', 'PENDING']);
      const terminalStatuses = new Set(['FIL', 'FLL', 'CAN', 'EXP', 'REJ', 'OUT', 'CANCELLED', 'FILLED', 'REJECTED', 'EXPIRED']);

      if (terminalStatuses.has(status)) {
        // Status is terminal - order no longer active
        return null;
      }

      if (activeStatuses.has(status) || !status) {
        // Status is active or unknown - return entry
        return {
          orderId: dbEntry.orderId,
          order: dbEntry.order,
          openedDateTime: dbEntry.openedDateTime,
          status: dbEntry.status
        };
      }

      return null;
    } catch (err) {
      console.error(`❌ CachePersistenceService: Error checking database for StopLimit order ${symbol}:`, err);
      return null;
    }
  }

  /**
   * Save StopLimit repository entries to database
   */
  async saveStopLimitRepositoryToDatabase() {
    if (!this.isDbAvailable() || !this.stopLimitOrderRepository) {
      return;
    }

    const symbolsToSave = Array.from(this.pendingSaves.stopLimitRepository);
    if (symbolsToSave.length === 0) {
      return;
    }

    try {
      const operations = [];
      for (const symbol of symbolsToSave) {
        const repoEntry = this.stopLimitOrderRepository.get(symbol);
        if (repoEntry) {
          operations.push({
            updateOne: {
              filter: { symbol },
              update: {
                $set: {
                  orderId: repoEntry.orderId,
                  order: repoEntry.order,
                  openedDateTime: repoEntry.openedDateTime,
                  status: repoEntry.status,
                  lastUpdated: Date.now()
                }
              },
              upsert: true
            }
          });
        } else {
          // Entry was deleted - remove from DB
          operations.push({
            deleteOne: { filter: { symbol } }
          });
        }
      }

      if (operations.length > 0) {
        await StopLimitRepository.bulkWrite(operations, { ordered: false });
      }

      this.pendingSaves.stopLimitRepository.clear();
      this.lastSaveTime.stopLimitRepository = Date.now();
    } catch (err) {
      console.error('❌ CachePersistenceService: Error saving StopLimit repository to database:', err);
    }
  }

  async updateMetadata(ordersCount, positionsCount, stopLimitRepositoryCount = 0) {
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
            lastStopLimitRepositorySync: Date.now(),
            ordersCount,
            positionsCount,
            stopLimitRepositoryCount
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
