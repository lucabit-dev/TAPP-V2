require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const ChartsWatcherService = require('./chartsWatcherService');
const ToplistService = require('./toplistService');
const PolygonService = require('./polygonService');
const IndicatorsService = require('./indicators');
const ConditionsService = require('./conditions');
const FloatSegmentationService = require('./api/floatSegmentationService');
const MACDEMAVerificationService = require('./macdEmaVerificationService');
const PnLProxyService = require('./pnlProxyService');
const L2Service = require('./l2Service');
const { ManualConfig, MANUAL_CONFIG_ID } = require('./models/manualConfig.model');
const { MACD } = require('technicalindicators');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// WebSocket server for real-time alerts
const wss = new WebSocket.Server({ noServer: true });
const clients = new Set();

// WebSocket servers for P&L proxy (positions and orders) - using noServer to handle routing manually
const pnlProxyService = new PnLProxyService();
const positionsWss = new WebSocket.Server({ noServer: true });
const ordersWss = new WebSocket.Server({ noServer: true });

// Handle positions proxy connections
positionsWss.on('connection', async (ws, req) => {
  console.log(`✅ Client positions WebSocket connection established (readyState: ${ws.readyState})`);
  await pnlProxyService.handleProxyConnection(ws, req, req.url);
});

// Handle orders proxy connections
ordersWss.on('connection', async (ws, req) => {
  console.log(`✅ Client orders WebSocket connection established (readyState: ${ws.readyState})`);
  await pnlProxyService.handleProxyConnection(ws, req, req.url);
});

// Manual upgrade handling to route to correct WebSocket server
server.on('upgrade', (request, socket, head) => {
  try {
    // Parse pathname from URL (handle query string)
    const url = request.url.split('?')[0]; // Remove query string for path matching
    const pathname = url;

    console.log(`🔌 WebSocket upgrade request: ${pathname}`);

    if (pathname === '/ws/positions') {
      console.log(`✅ Routing to positions WebSocket server`);
      positionsWss.handleUpgrade(request, socket, head, (ws) => {
        positionsWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/orders') {
      console.log(`✅ Routing to orders WebSocket server`);
      ordersWss.handleUpgrade(request, socket, head, (ws) => {
        ordersWss.emit('connection', ws, request);
      });
    } else {
      // Default: route to main alerts WebSocket server
      console.log(`✅ Routing to main alerts WebSocket server`);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  } catch (error) {
    console.error('❌ WebSocket upgrade error:', error);
    socket.destroy();
  }
});

// Heartbeat (ping/pong) to prevent idle proxies from closing connections
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WS_HEARTBEAT_MS || '30000', 10);
let wsHeartbeatInterval = null;

// Middleware
app.use(cors());
app.use(express.json());

// Database
const { connectDatabase } = require('./auth/db');
const mongoose = require('mongoose');
connectDatabase()
  .then(() => {
    loadManualWeightsFromDb();
    loadStopLimitTrackerConfigFromDb();
    initializeCachePersistence();
  })
  .catch(() => {
    console.warn('Server started without DB connection. Auth routes will return 503.');
  });

// DB-ready guard for auth endpoints
function requireDbReady(req, res, next) {
  const ready = mongoose.connection && mongoose.connection.readyState === 1; // 1 = connected
  if (!ready) return res.status(503).json({ error: 'Database not connected' });
  next();
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  const dbReady = mongoose.connection && mongoose.connection.readyState === 1;
  res.json({ 
    status: 'ok', 
    db: dbReady ? 'connected' : 'disconnected',
    dbState: mongoose.connection?.readyState || 'unknown'
  });
});

// Auth routes
const authRoutes = require('./auth/auth.routes');
const { requireAuth } = require('./auth/auth.middleware');
app.use('/api/auth', requireDbReady, authRoutes);
app.get('/api/protected/ping', requireDbReady, requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// Initialize services
const chartsWatcherService = new ChartsWatcherService();
const toplistService = new ToplistService();
const polygonService = new PolygonService();
const indicatorsService = new IndicatorsService();
const conditionsService = new ConditionsService();
const floatService = new FloatSegmentationService();
const verificationService = new MACDEMAVerificationService();
const l2Service = new L2Service();

// Alerts manual control state
let alertsEnabled = false;
// Global buys control (default OFF)
let buysEnabled = false;

// Buy list tracking (MACD 1m histogram crossing from negative to positive)
const buyList = [];
const lastMacd1mHistogramByTicker = new Map();
let buyTriggerMode = 'positive'; // 'cross' | 'positive'

// Track last buy timestamp per ticker to prevent duplicate buys on the same UTC day
const lastBuyTsByTicker = new Map();

// GLOBAL CACHE: Cached positions and orders (updated via WebSocket streams)
// These caches are SHARED GLOBALLY across all users - not per-user or per-session
// All users see the same positions and orders data
const positionsCache = new Map(); // Map<symbol, { PositionID, Symbol, Quantity, ... }>
const ordersCache = new Map(); // Map<OrderID, { OrderID, Symbol, Status, Legs, ... }>

// Pending manual BUY orders: track orderId → { symbol, quantity, limitPrice } for FLL→StopLimit logic
const pendingManualBuyOrders = new Map();

// StopLimit Order Repository - Single source of truth pattern from sections-buy-bot-main
// Maps symbol → { orderId, order, openedDateTime, status }
// This is the authoritative source for active StopLimit orders
const stopLimitOrderRepository = new Map(); // Map<symbol, { orderId, order, openedDateTime, status }>

// CRITICAL: StopLimit logic is DISABLED - set to false to pause all stop-limit order creation
const STOPLIMIT_ENABLED = false;

// Helper functions for StopLimit Order Repository (pattern from sections-buy-bot-main)
function parseOrderDateTime(dateTimeStr) {
  if (!dateTimeStr) return null;
  try {
    return new Date(dateTimeStr.replace('Z', '+00:00'));
  } catch {
    return null;
  }
}

function isNewerOrder(newOrder, existingOrder) {
  if (!existingOrder) return true;
  const newTime = parseOrderDateTime(newOrder.OpenedDateTime);
  const existingTime = parseOrderDateTime(existingOrder.openedDateTime);
  if (!existingTime) return true;
  if (!newTime) return false;
  return newTime >= existingTime;
}

function isStopLimitFilled(msg) {
  const status = (msg.Status || '').toUpperCase();
  const orderType = (msg.OrderType || '').toUpperCase();
  return status === 'FLL' && (orderType === 'STOPLIMIT' || orderType === 'STOP_LIMIT');
}

function isActiveStopLimitOrder(msg) {
  const status = (msg.Status || '').toUpperCase();
  const orderType = (msg.OrderType || '').toUpperCase();
  return status === 'ACK' && (orderType === 'STOPLIMIT' || orderType === 'STOP_LIMIT');
}

function isOrderDeleted(msg) {
  const status = (msg.Status || '').toUpperCase();
  return status === 'OUT' || status === 'CAN';
}

// Register or update StopLimit order in repository (clean pattern from sections-buy-bot-main)
function registerStopLimitOrder(msg) {
  // CRITICAL: StopLimit logic is DISABLED - return early
  if (!STOPLIMIT_ENABLED) {
    return;
  }
  
  const leg = msg.Legs?.[0];
  if (!leg) return;
  
  const symbol = (leg.Symbol || '').toUpperCase();
  const side = (leg.BuyOrSell || '').toUpperCase();
  if (side !== 'SELL') return;
  
  const orderId = msg.OrderID;
  const status = (msg.Status || '').toUpperCase();
  
  if (isActiveStopLimitOrder(msg)) {
    // Order is ACK'd - register or update in repository (sections-buy-bot-main pattern)
    const existing = stopLimitOrderRepository.get(symbol);
    
    if (existing) {
      // Check if this order is newer than existing
      if (isNewerOrder(msg, existing)) {
      stopLimitOrderRepository.set(symbol, {
        orderId,
        order: msg,
        openedDateTime: msg.OpenedDateTime,
        status
      });
      console.log(`🔄 [STOPLIMIT_REPO] Updated active StopLimit order for ${symbol}: ${orderId} (was: ${existing.orderId})`);
      
      // CRITICAL: Save to database IMMEDIATELY when ACK'd (not debounced)
      // This ensures the database is the source of truth before any new creation attempts
      if (cachePersistenceService) {
        // Save immediately to database (synchronous-like, no debounce)
        cachePersistenceService.saveStopLimitRepositoryEntryImmediately(symbol, {
          orderId,
          order: msg,
          openedDateTime: msg.OpenedDateTime,
          status
        }).catch(err => {
          console.error(`❌ [STOPLIMIT_REPO] Error saving ${symbol} to database immediately:`, err);
        });
      }
        
        // CRITICAL: Delay guard removal to prevent race conditions
        // Wait a bit to ensure handleManualBuyFilled has completed and no duplicate creation is in progress
        setTimeout(() => {
          // Double-check repository still has this order before clearing guard
          const repoCheck = stopLimitOrderRepository.get(symbol);
          if (repoCheck && repoCheck.orderId === orderId && stopLimitCreationBySymbol.has(symbol)) {
            stopLimitCreationBySymbol.delete(symbol);
            console.log(`🔓 [STOPLIMIT_REPO] Removed ${symbol} from stopLimitCreationBySymbol guard (order ACK'd, delayed check)`);
          }
        }, 2000); // 2 second delay to allow handleManualBuyFilled to complete
      } else {
        console.log(`⏭️ [STOPLIMIT_REPO] Ignoring older StopLimit order ${orderId} for ${symbol} (existing: ${existing.orderId})`);
        // Still clear guard if it exists (older order shouldn't block)
        if (stopLimitCreationBySymbol.has(symbol)) {
          setTimeout(() => {
            stopLimitCreationBySymbol.delete(symbol);
            console.log(`🔓 [STOPLIMIT_REPO] Removed ${symbol} from stopLimitCreationBySymbol guard (older order ACK'd)`);
          }, 1000);
        }
      }
    } else {
      // New order - register it (sections-buy-bot-main pattern)
      stopLimitOrderRepository.set(symbol, {
        orderId,
        order: msg,
        openedDateTime: msg.OpenedDateTime,
        status
      });
      console.log(`✅ [STOPLIMIT_REPO] Registered new active StopLimit order for ${symbol}: ${orderId}`);
      
      // CRITICAL: Save to database IMMEDIATELY when ACK'd (not debounced)
      // This ensures the database is the source of truth before any new creation attempts
      if (cachePersistenceService) {
        // Save immediately to database (synchronous-like, no debounce)
        cachePersistenceService.saveStopLimitRepositoryEntryImmediately(symbol, {
          orderId,
          order: msg,
          openedDateTime: msg.OpenedDateTime,
          status
        }).catch(err => {
          console.error(`❌ [STOPLIMIT_REPO] Error saving ${symbol} to database immediately:`, err);
        });
      }
      
      // CRITICAL: Delay guard removal to prevent race conditions
      // Wait to ensure handleManualBuyFilled has completed and no duplicate creation is in progress
      setTimeout(() => {
        // Double-check repository still has this order before clearing guard
        const repoCheck = stopLimitOrderRepository.get(symbol);
        if (repoCheck && repoCheck.orderId === orderId && stopLimitCreationBySymbol.has(symbol)) {
          stopLimitCreationBySymbol.delete(symbol);
          console.log(`🔓 [STOPLIMIT_REPO] Removed ${symbol} from stopLimitCreationBySymbol guard (order ACK'd, delayed check)`);
        }
      }, 2000); // 2 second delay to allow handleManualBuyFilled to complete
    }
  } else if (isStopLimitFilled(msg) || isOrderDeleted(msg)) {
    // Order is filled or deleted - remove from repository (sections-buy-bot-main pattern)
    const existing = stopLimitOrderRepository.get(symbol);
    if (existing && existing.orderId === orderId) {
      stopLimitOrderRepository.delete(symbol);
      
      // Schedule save to database (delete)
      if (cachePersistenceService) {
        cachePersistenceService.scheduleStopLimitRepositorySave(symbol);
      }
      
      // CRITICAL: Remove symbol from creation guard when order is filled/deleted
      if (stopLimitCreationBySymbol.has(symbol)) {
        stopLimitCreationBySymbol.delete(symbol);
        console.log(`🔓 [STOPLIMIT_REPO] Removed ${symbol} from stopLimitCreationBySymbol guard (order filled/deleted)`);
      }
      
      // CRITICAL: If StopLimit was FILLED (not just cancelled), mark symbol to prevent creating new StopLimit
      // This prevents loops when StopLimit is filled but position still exists
      if (isStopLimitFilled(msg)) {
        stopLimitFilledSymbols.set(symbol, { orderId, timestamp: Date.now() });
        console.log(`🏷️ [STOPLIMIT_REPO] Marked ${symbol} as having filled StopLimit (order ${orderId}) - will prevent new creation`);
      }
      
      console.log(`🗑️ [STOPLIMIT_REPO] Removed StopLimit order for ${symbol}: ${orderId} (status: ${status})`);
    }
  }
}

// Get active StopLimit order for symbol (single source of truth)
function getActiveStopLimitOrder(symbol) {
  const normalized = (symbol || '').toUpperCase();
  const repoEntry = stopLimitOrderRepository.get(normalized);
  
  if (!repoEntry) return null;
  
  // Verify order is still active in cache
  const cachedOrder = ordersCache.get(repoEntry.orderId);
  if (!cachedOrder) {
    // Order not in cache - remove from repository
    stopLimitOrderRepository.delete(normalized);
    console.log(`🧹 [STOPLIMIT_REPO] Removed stale entry for ${normalized} (order ${repoEntry.orderId} not in cache)`);
    return null;
  }
  
  const cachedStatus = (cachedOrder.Status || '').toUpperCase();
  const terminalStatuses = new Set(['CAN', 'FIL', 'FLL', 'EXP', 'REJ', 'OUT']);
  
  if (terminalStatuses.has(cachedStatus)) {
    // Order is terminal - remove from repository
    stopLimitOrderRepository.delete(normalized);
    console.log(`🧹 [STOPLIMIT_REPO] Removed terminal StopLimit order for ${normalized} (status: ${cachedStatus})`);
    return null;
  }
  
  // Verify it's still a StopLimit SELL order
  const leg = cachedOrder.Legs?.[0];
  const legSymbol = (leg?.Symbol || '').toUpperCase();
  const legSide = (leg?.BuyOrSell || '').toUpperCase();
  const orderType = (cachedOrder.OrderType || '').toUpperCase();
  
  if (legSymbol === normalized && legSide === 'SELL' && (orderType === 'STOPLIMIT' || orderType === 'STOP_LIMIT')) {
    return {
      orderId: repoEntry.orderId,
      order: cachedOrder,
      openedDateTime: repoEntry.openedDateTime,
      status: cachedStatus
    };
  }
  
  // Order type or symbol mismatch - remove from repository
  stopLimitOrderRepository.delete(normalized);
  console.log(`🧹 [STOPLIMIT_REPO] Removed mismatched order for ${normalized} (type: ${orderType}, side: ${legSide})`);
  return null;
}

// Track recently sold symbols to prevent StopLimit creation loops after manual sell
const recentlySoldSymbols = new Map(); // Map<symbol, timestamp> - prevents creating StopLimit for recently sold stocks

// Track symbols that had StopLimit orders filled (FLL) - prevents creating new StopLimit for same position
// This prevents loops when StopLimit is filled but position still exists
const stopLimitFilledSymbols = new Map(); // Map<symbol, { orderId, timestamp }>

// Track processed FLL orders to prevent duplicate processing (sections-buy-bot-main pattern)
// Prevents processing the same order multiple times when WebSocket sends duplicate FLL messages
const processedFllOrders = new Set(); // Set<orderId> - tracks which orders have been processed for FLL

// StopLimit Tracker Configuration
// Structure: Map<groupId, { minPrice, maxPrice, initialStopPrice, steps: [{ pnl, stop }], enabled }>
const stopLimitTrackerConfig = new Map();
// Track which step each position has reached: Map<symbol, { groupId, currentStepIndex, lastPnl, lastUpdate }>
const stopLimitTrackerProgress = new Map();

// Track which buy orders have already triggered StopLimit creation (prevent duplicates)
const stopLimitCreationInProgress = new Set(); // Set<orderId>
const stopLimitCreationBySymbol = new Set(); // Set<symbol> - track symbols with StopLimit creation in progress

// Cache persistence service (initialized after DB connection)
let cachePersistenceService = null;

// Initialize cache persistence service
async function initializeCachePersistence() {
  try {
    const CachePersistenceService = require('./services/cachePersistenceService');
    cachePersistenceService = new CachePersistenceService(ordersCache, positionsCache, stopLimitOrderRepository);
    
    // Load cache from database on startup
    const loaded = await cachePersistenceService.loadFromDatabase();
    console.log(`✅ Cache persistence initialized: Loaded ${loaded.orders} orders, ${loaded.positions} positions, and ${loaded.stopLimitRepository || 0} StopLimit repository entries from database`);
    
    // Start periodic saves
    cachePersistenceService.startPeriodicSave();
    
    // Add API endpoint for cache stats
    app.get('/api/cache/stats', requireDbReady, async (req, res) => {
      try {
        const stats = await cachePersistenceService.getStats();
        res.json({ success: true, data: stats });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
  } catch (err) {
    console.error('❌ Failed to initialize cache persistence:', err);
    // Continue without persistence - cache will work in-memory only
    cachePersistenceService = null;
  }
}

// Helper function to normalize timestamp (keeps UTC, formatting is done on frontend)
// This function is here for consistency but doesn't actually change the timestamp
// The frontend will format timestamps as UTC-4 for display
function toUTC4(isoString) {
  // Keep timestamp as UTC, frontend will format as UTC-4
  return isoString;
}

// Helper function to extract momentum conditions from a toplist row
function extractMomentumConditions(row, origin) {
  try {
    if (!row || !Array.isArray(row.columns)) return null;
    
    const thresholds = floatService.getThresholds?.();
    const t = thresholds ? thresholds[origin] : null;
    if (!t) return null;
    
    const columnsByKey = new Map(row.columns.map(c => [c.key, c]));
    
    const pickVal = (candidates, fallback) => {
      for (const k of candidates) { 
        if (columnsByKey.has(k)) return columnsByKey.get(k)?.value; 
      }
      if (fallback) {
        for (const [k, c] of columnsByKey.entries()) { 
          if (fallback(k)) return c?.value; 
        }
      }
      return null;
    };
    
    // Extract momentum values
    const change5mStr = pickVal([
      'PrzChangeFilterMIN5','ChangeMIN5','Change5MIN'
    ], k => /change/i.test(k) && /(min5|5min|fm5)/i.test(k));
    const change5mPct = parsePercent(change5mStr);
    
    const trades1mStr = pickVal([
      'TradeCountMIN1','TradesMIN1','TradeCountFM1'
    ], k => /trade/i.test(k) && /(min1|1min|fm1)/i.test(k));
    const trades1m = parseIntLike(trades1mStr);
    
    const vol5mStr = pickVal([
      'PrzVolumeFilterFM5','VolumeMIN5','Volume5MIN','PrzVolumeFM5'
    ], k => /volume/i.test(k) && /(min5|5min|fm5)/i.test(k));
    const vol5m = parseVolume(vol5mStr);
    
    const chgOpenStr = pickVal([
      'ChangeFromOpenPRZ','ChangeFromOpen'
    ], k => /change/i.test(k) && /open/i.test(k));
    const changeFromOpenPct = parsePercent(chgOpenStr);
    
    return {
      values: {
        change5mPct,
        trades1m,
        vol5m,
        changeFromOpenPct
      },
      thresholds: t,
      groupKey: origin
    };
  } catch (_) {
    return null;
  }
}

// Stock color cache to maintain colored state until conditions change
const stockColorCache = new Map(); // symbol -> { meetsTech: boolean, meetsMomentum: boolean, lastUpdate: timestamp }
const COLOR_CACHE_TIMEOUT = 60 * 60 * 1000; // 60 minutes cache timeout (increased from 30 minutes)

// Lightweight logger with levels and per-ticker debugging
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const DEBUG_TICKERS = new Set((process.env.DEBUG_TICKERS || '').split(',').map(s => String(s).trim().toUpperCase()).filter(Boolean));
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
function shouldLog(level) {
  const lvl = LEVELS[level] ?? LEVELS.info;
  const cur = LEVELS[LOG_LEVEL] ?? LEVELS.info;
  return lvl <= cur;
}
function log(level, ...args) {
  if (shouldLog(level)) console.log(...args);
}
function logIfDebugTicker(symbol, ...args) {
  if (DEBUG_TICKERS.has(String(symbol || '').toUpperCase())) console.log(...args);
}

// Analysis synchronization to prevent simultaneous analyses
let isAnalysisRunning = false;
const analysisQueue = new Set(); // Queue of symbols waiting to be analyzed

// Evaluate Config FLOAT conditions for a toplist row using float thresholds
function evaluateConfigFloat(row, origin) {
  try {
    if (!row || !Array.isArray(row.columns)) return false;
    const thresholds = floatService.getThresholds?.();
    const t = thresholds ? thresholds[origin] : null;
    if (!t) return false;
    const columnsByKey = new Map(row.columns.map(c => [c.key, c]));

    const pickVal = (candidates, fallback) => {
      for (const k of candidates) { if (columnsByKey.has(k)) return columnsByKey.get(k)?.value; }
      if (fallback) {
        for (const [k, c] of columnsByKey.entries()) { if (fallback(k)) return c?.value; }
      }
      return null;
    };

    // 5m change (%): >= t.change5mPct
    const change5mStr = pickVal([
      'PrzChangeFilterMIN5','ChangeMIN5','Change5MIN'
    ], k => /change/i.test(k) && /(min5|5min|fm5)/i.test(k));
    const change5m = parsePercent(change5mStr);
    if (change5m === null || !(change5m >= t.change5mPct)) return false;

    // 1m trades: >= t.trades1m
    const trades1mStr = pickVal([
      'TradeCountMIN1','TradesMIN1','TradeCountFM1'
    ], k => /trade/i.test(k) && /(min1|1min|fm1)/i.test(k));
    const trades1m = parseIntLike(trades1mStr);
    if (trades1m === null || !(trades1m >= t.trades1m)) return false;

    // 5m volume: >= t.vol5m
    const vol5mStr = pickVal([
      'PrzVolumeFilterFM5','VolumeMIN5','Volume5MIN','PrzVolumeFM5'
    ], k => /volume/i.test(k) && /(min5|5min|fm5)/i.test(k));
    const vol5m = parseVolume(vol5mStr);
    if (vol5m === null || !(vol5m >= t.vol5m)) return false;

    // Change from open (%): >= t.changeFromOpenPct
    const chgOpenStr = pickVal([
      'ChangeFromOpenPRZ','ChangeFromOpen'
    ], k => /change/i.test(k) && /open/i.test(k));
    const chgOpen = parsePercent(chgOpenStr);
    if (chgOpen === null || !(chgOpen >= t.changeFromOpenPct)) return false;

    return true;
  } catch (_) {
    return false;
  }
}

// Unified: fetch candles for analysis with extended-hours support and adaptive fallback
async function fetchCandlesForAnalysis(symbol) {
  const currentSession = polygonService.getCurrentTradingSession?.() || 'regular';
  const useExtendedHours = polygonService.isExtendedHours?.() || false;
  log('debug', `[Analysis] Fetch candles ${symbol} - session=${currentSession} extended=${useExtendedHours}`);
  let candles1m, candles5m;
  let isExtendedHours = false;
  if (useExtendedHours && polygonService.fetchExtendedHoursCandles) {
    // Try extended hours first, then fallback to longer periods if needed
    const timeRanges = [
      { days: 7, hours: 168 },
      { days: 15, hours: 360 },
      { days: 30, hours: 720 },
      { days: 60, hours: 1440 }
    ];
    
    let fetchSuccess = false;
    for (const timeRange of timeRanges) {
      try {
        const [ext1, ext5] = await Promise.all([
          polygonService.fetchExtendedHoursCandles(symbol, 1, true, timeRange.days),
          polygonService.fetchExtendedHoursCandles(symbol, 5, true, timeRange.days)
        ]);
        candles1m = ext1?.candles || [];
        candles5m = ext5?.candles || [];
        
        // Check if we have enough candles for EMA200 (need at least 200 for both 1m and 5m)
        if (candles1m.length >= 200 && candles5m.length >= 200) {
          console.log(`[Adaptive] Successful fetch for ${symbol}: ${candles1m.length} 1m candles, ${candles5m.length} 5m candles with ${timeRange.days} days`);
          fetchSuccess = true;
          break;
        } else {
          console.log(`[Adaptive] Insufficient candles for ${symbol} with ${timeRange.days} days: ${candles1m.length} 1m, ${candles5m.length} 5m (need 200+ for both)`);
        }
      } catch (error) {
        console.log(`[Adaptive] Error fetching ${symbol} with ${timeRange.days} days: ${error.message}`);
      }
    }
    
    if (!fetchSuccess) {
      console.warn(`[Adaptive] Failed to fetch sufficient candles for ${symbol} after trying all time ranges`);
    }
    
    isExtendedHours = true;
  } else {
    let daysToFetch = 10;
    let attemptCount = 0;
    const maxAttempts = 4;
    while (attemptCount < maxAttempts) {
      const hoursBack = daysToFetch * 24;
      const dateRange = polygonService.getExtendedDateRange(hoursBack);
      const from = dateRange.from;
      const to = dateRange.to;
      [candles1m, candles5m] = await Promise.all([
        polygonService.fetch1MinuteCandles(symbol, from, to),
        polygonService.fetch5MinuteCandles(symbol, from, to)
      ]);
      if (!candles1m || candles1m.length === 0) break;
      // Market hours filter (9:30-16:00 ET)
      const mh1 = candles1m.filter(c => {
        const d = new Date(c.timestamp); const uh = d.getUTCHours(); const um = d.getUTCMinutes();
        const t = uh * 60 + um; const s = 13 * 60 + 30; const e = 20 * 60; return t >= s && t < e;
      });
      const mh5 = (candles5m || []).filter(c => {
        const d = new Date(c.timestamp); const uh = d.getUTCHours(); const um = d.getUTCMinutes();
        const t = uh * 60 + um; const s = 13 * 60 + 30; const e = 20 * 60; return t >= s && t < e;
      });
      if (mh1.length >= 200 && mh5.length >= 50) { candles1m = mh1; candles5m = mh5; break; }
      if (candles1m.length >= 200 && attemptCount === maxAttempts - 1) { break; }
      daysToFetch = daysToFetch === 10 ? 15 : daysToFetch === 15 ? 20 : 30; attemptCount++;
    }
  }
  return { candles1m, candles5m, isExtendedHours };
}

// Unified: analyze a symbol once (fresh evaluation, extended-hours aware)
async function analyzeSymbol(symbol) {
  try {
    const { candles1m, candles5m, isExtendedHours } = await fetchCandlesForAnalysis(symbol);
    if (!candles1m || candles1m.length < 200 || !candles5m || candles5m.length < 50) {
      log('debug', `⚠️ ${symbol}: insufficient candles (1m=${candles1m?.length || 0},5m=${candles5m?.length || 0})`);
      return { symbol, meetsTech: false, meetsMomentum: false };
    }
    // Fetch real-time current price from Polygon (includes extended hours) BEFORE calculating indicators
    let currentPrice = null;
    try { 
      currentPrice = await polygonService.getCurrentPrice(symbol);
      console.log(`[Price] Fetched real-time price for ${symbol}: ${currentPrice} (extended hours supported)`);
    } catch {}
    
    // Update last candle close prices with real-time price (most recent value)
    // This ensures indicators are calculated with the most current price
    if (currentPrice !== null && candles1m.length > 0) {
      const lastCandle1m = candles1m[candles1m.length - 1];
      if (lastCandle1m) {
        lastCandle1m.close = currentPrice;
        // Also update high if price is higher
        if (currentPrice > lastCandle1m.high) {
          lastCandle1m.high = currentPrice;
        }
        // Also update low if price is lower
        if (currentPrice < lastCandle1m.low) {
          lastCandle1m.low = currentPrice;
        }
      }
    }
    
    if (currentPrice !== null && candles5m.length > 0) {
      const lastCandle5m = candles5m[candles5m.length - 1];
      if (lastCandle5m) {
        lastCandle5m.close = currentPrice;
        // Also update high if price is higher
        if (currentPrice > lastCandle5m.high) {
          lastCandle5m.high = currentPrice;
        }
        // Also update low if price is lower
        if (currentPrice < lastCandle5m.low) {
          lastCandle5m.low = currentPrice;
        }
      }
    }
    
    // Calculate indicators with extended hours support (now using updated candle data with real-time price)
    const indicatorData = await indicatorsService.calculateAllIndicators(symbol, candles1m, candles5m, isExtendedHours);
    if (!indicatorData || !indicatorData.indicators) {
      log('warn', `⚠️ ${symbol}: indicators calculation failed`);
      return { symbol, meetsTech: false, meetsMomentum: false };
    }
    const closePrice = currentPrice || indicatorData.lastCandle?.close || null;
    indicatorData.currentPrice = closePrice;
    if (indicatorData.lastCandle && closePrice != null) indicatorData.lastCandle.close = closePrice;
    const evaluation = conditionsService.evaluateConditions(indicatorData);
    const meetsTech = !!evaluation?.allConditionsMet;
    
    // Calculate momentum conditions directly from candles (at exact moment)
    let momentumData = null;
    let meetsMomentum = false;
    let groupKey = null;
    
    try {
      // Compute momentum from candles
      const computedMomentum = floatService.computeMomentum(candles1m, candles5m, closePrice);
      
      // Find the group key for this symbol
      const toplistMap = toplistService.toplistByConfig || {};
      outer: for (const configId of Object.keys(toplistMap)) {
        const groupInfo = floatService.getGroupInfoByConfig(configId);
        const origin = groupInfo?.key || '?';
        const rows = toplistMap[configId] || [];
        for (const row of rows) {
          const sym = row?.symbol || (Array.isArray(row?.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value) : null);
          if ((sym || '').toUpperCase() === String(symbol).toUpperCase()) {
            groupKey = origin;
            // Check if momentum conditions are met
            meetsMomentum = floatService.meetsMomentum(origin, computedMomentum);
            
            // Get thresholds for this group
            const thresholds = floatService.getThresholds?.();
            const t = thresholds ? thresholds[origin] : null;
            
            if (t) {
              momentumData = {
                values: computedMomentum,
                thresholds: t,
                groupKey: origin
              };
            }
            break outer;
          }
        }
      }
    } catch (e) {
      log('debug', `Error calculating momentum for ${symbol}: ${e.message}`);
    }
    
    setCachedStockColor(symbol, meetsTech, meetsMomentum);
    logIfDebugTicker(symbol, `Eval ${symbol}: tech=${meetsTech} momentum=${meetsMomentum} failed=[${(evaluation.failedConditions||[]).map(f=>f.name).join(', ')}] cp=${closePrice}`);
    return { symbol, meetsTech, meetsMomentum, indicators: indicatorData.indicators, lastClose: closePrice, evaluation, momentum: momentumData, candles1m, candles5m };
  } catch (e) {
    log('error', `Error analyzing ${symbol}: ${e?.message || e}`);
    return { symbol, meetsTech: false, meetsMomentum: false };
  }
}

function getCachedStockColor(symbol) {
  const cached = stockColorCache.get(symbol);
  if (!cached) return null;
  
  // Check if cache is expired
  if (Date.now() - cached.lastUpdate > COLOR_CACHE_TIMEOUT) {
    stockColorCache.delete(symbol);
    log('debug', `🔄 Cache expired for ${symbol}, will recalculate`);
    return null;
  }
  
  log('debug', `📋 Using cached color for ${symbol}: Tech=${cached.meetsTech}, Momentum=${cached.meetsMomentum}`);
  return { meetsTech: cached.meetsTech, meetsMomentum: cached.meetsMomentum };
}

function setCachedStockColor(symbol, meetsTech, meetsMomentum) {
  const currentCache = stockColorCache.get(symbol);
  
  // Only update cache if conditions have actually changed
  if (!currentCache || currentCache.meetsTech !== meetsTech || currentCache.meetsMomentum !== meetsMomentum) {
    stockColorCache.set(symbol, {
      meetsTech,
      meetsMomentum,
      lastUpdate: Date.now()
    });
    log('debug', `💾 Cached color for ${symbol}: Tech=${meetsTech}, Momentum=${meetsMomentum} (CHANGED)`);
    return true;
  } else {
    // Update timestamp but don't log if no change
    currentCache.lastUpdate = Date.now();
    log('trace', `📋 Color unchanged for ${symbol}: Tech=${meetsTech}, Momentum=${meetsMomentum}`);
    return false;
  }
}

function clearStockColorCache(symbol) {
  stockColorCache.delete(symbol);
  console.log(`🗑️ Cleared cache for ${symbol}`);
}

function clearAllStockColorCache() {
  stockColorCache.clear();
  console.log(`🗑️ Cleared all stock color cache`);
}

// Periodic cleanup of StopLimit repository to remove stale entries (clean repository pattern)
// Runs every 2 minutes to keep repository in sync with actual order state
setInterval(() => {
  try {
    let cleanedRepository = 0;
    
    // Clean up repository - remove entries where order is no longer active
    for (const [symbol, repoEntry] of stopLimitOrderRepository.entries()) {
      const order = ordersCache.get(repoEntry.orderId);
      if (!order) {
        // Order not in cache - remove from repository
        stopLimitOrderRepository.delete(symbol);
        cleanedRepository++;
        console.log(`🧹 [STOPLIMIT_REPO] Removed stale entry for ${symbol} (order ${repoEntry.orderId} not in cache)`);
      } else {
        const status = (order.Status || '').toUpperCase();
        const isTerminal = ['FIL', 'FLL', 'CAN', 'EXP', 'REJ', 'OUT'].includes(status);
        if (isTerminal) {
          // Order is terminal, remove from repository
          stopLimitOrderRepository.delete(symbol);
          cleanedRepository++;
          console.log(`🧹 [STOPLIMIT_REPO] Removed terminal entry for ${symbol} (order ${repoEntry.orderId} status: ${status})`);
        } else {
          // Verify order is actually a StopLimit SELL for this symbol
          const leg = order.Legs?.[0];
          const legSymbol = (leg?.Symbol || '').toUpperCase();
          const legSide = (leg?.BuyOrSell || '').toUpperCase();
          const orderType = (order.OrderType || '').toUpperCase();
          if (legSymbol !== symbol || legSide !== 'SELL' || (orderType !== 'STOPLIMIT' && orderType !== 'STOP_LIMIT')) {
            // Mismatch - remove stale entry
            stopLimitOrderRepository.delete(symbol);
            cleanedRepository++;
            console.log(`🧹 [STOPLIMIT_REPO] Removed mismatched entry for ${symbol} (order ${repoEntry.orderId} is ${legSymbol}/${legSide}/${orderType})`);
          }
        }
      }
    }
    
    // Clean up recently sold symbols - remove entries older than 30 seconds
    let cleanedRecentlySold = 0;
    const now = Date.now();
    const RECENTLY_SOLD_MAX_AGE = 30000; // 30 seconds
    for (const [symbol, timestamp] of recentlySoldSymbols.entries()) {
      const age = now - timestamp;
      if (age > RECENTLY_SOLD_MAX_AGE) {
        recentlySoldSymbols.delete(symbol);
        cleanedRecentlySold++;
        console.log(`🧹 [CLEANUP] Removed old recently sold entry for ${symbol} (age: ${age}ms)`);
      }
    }
    
    // Clean up filled StopLimit symbols - remove entries older than 5 minutes
    let cleanedFilledStopLimits = 0;
    const FILLED_STOPLIMIT_MAX_AGE = 300000; // 5 minutes
    for (const [symbol, data] of stopLimitFilledSymbols.entries()) {
      const age = now - data.timestamp;
      if (age > FILLED_STOPLIMIT_MAX_AGE) {
        stopLimitFilledSymbols.delete(symbol);
        cleanedFilledStopLimits++;
        console.log(`🧹 [CLEANUP] Removed old filled StopLimit entry for ${symbol} (age: ${age}ms)`);
      }
    }
    
    // Clean up processed FLL orders - remove entries older than 1 hour
    // This prevents the set from growing indefinitely while keeping recent entries
    let cleanedProcessedFll = 0;
    const PROCESSED_FLL_MAX_AGE = 3600000; // 1 hour
    // Note: Set doesn't have timestamps, so we'll clean based on size
    // If set gets too large (> 1000 entries), clear old entries
    if (processedFllOrders.size > 1000) {
      const oldSize = processedFllOrders.size;
      // Clear half of the entries (simple cleanup strategy)
      const entriesToKeep = Math.floor(oldSize / 2);
      const entriesArray = Array.from(processedFllOrders);
      processedFllOrders.clear();
      // Keep the most recent half (assuming newer orders have higher IDs)
      entriesArray.slice(-entriesToKeep).forEach(id => processedFllOrders.add(id));
      cleanedProcessedFll = oldSize - processedFllOrders.size;
      console.log(`🧹 [CLEANUP] Cleaned ${cleanedProcessedFll} old processed FLL order entries (kept ${processedFllOrders.size})`);
    }
    
    if (cleanedRepository > 0 || cleanedRecentlySold > 0 || cleanedFilledStopLimits > 0 || cleanedProcessedFll > 0) {
      console.log(`🧹 [STOPLIMIT_REPO] Cleaned ${cleanedRepository} repository entries, ${cleanedRecentlySold} recently sold entries, ${cleanedFilledStopLimits} filled StopLimit entries, and ${cleanedProcessedFll} processed FLL entries`);
    }
  } catch (err) {
    console.error(`❌ [STOPLIMIT_REPO] Error in StopLimit cleanup:`, err);
  }
}, 120000); // Every 2 minutes

// Periodic cache cleanup to remove expired entries (less frequent)
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  for (const [symbol, cache] of stockColorCache.entries()) {
    if (now - cache.lastUpdate > COLOR_CACHE_TIMEOUT) {
      stockColorCache.delete(symbol);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    log('debug', `🧹 Cache cleanup: removed ${cleanedCount} expired entries`);
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes instead of every minute

function hasBoughtToday(ticker) {
  const last = lastBuyTsByTicker.get(ticker);
  if (!last) return false;
  const lastDay = last.slice(0, 10); // YYYY-MM-DD (UTC)
  const today = new Date().toISOString().slice(0, 10);
  return lastDay === today;
}

// Initialize Toplist WebSocket connection
toplistService.connect().catch(error => {
  console.error('Failed to initialize Toplist connection:', error);
});

// Set up L2 service listeners to broadcast data to clients
l2Service.onData((data) => {
  broadcastToClients({
    type: 'L2_DATA',
    data: data,
    timestamp: new Date().toISOString()
  });
});

l2Service.onStatus((status) => {
  broadcastToClients({
    type: 'L2_STATUS',
    data: status,
    timestamp: new Date().toISOString()
  });
});

// WebSocket connection handling for frontend clients
wss.on('connection', (ws) => {
  // Track liveness for heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  clients.add(ws);
  
  // Send cached RAW_TECH_CHECKS result immediately on connection
  if (lastRawTechChecksResult && (lastRawTechChecksResult.meetsTech || lastRawTechChecksResult.meetsMomentum)) {
    try {
      ws.send(JSON.stringify({
        type: 'RAW_TECH_CHECKS',
        data: lastRawTechChecksResult,
        timestamp: new Date().toISOString()
      }));
      console.log(`📤 Sent cached RAW_TECH_CHECKS to new client: ${lastRawTechChecksResult.meetsTech?.length || 0} tech, ${lastRawTechChecksResult.meetsMomentum?.length || 0} momentum`);
    } catch {}
  }
  
  // Send current FLOAT thresholds on connection
  try {
    ws.send(JSON.stringify({
      type: 'FLOAT_THRESHOLDS',
      data: floatService.getThresholds(),
      timestamp: new Date().toISOString()
    }));
  } catch {}
  
  ws.on('close', () => {
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    clients.delete(ws);
  });
});

// Start heartbeat timer once server is ready
if (!wsHeartbeatInterval) {
  wsHeartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch {}
        return;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    });
  }, HEARTBEAT_INTERVAL_MS);
}

// Broadcast processed alerts to all connected clients
function broadcastToClients(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        clients.delete(client);
      }
    }
  });
}

// Always register alert listener; connect/disconnect controlled by endpoints
chartsWatcherService.onAlert(async (alert) => {
  if (!alertsEnabled) return;
  const processed = await processAlert(alert);
  if (processed) {
    broadcastToClients({
      type: 'NEW_ALERT',
      data: processed,
      timestamp: new Date().toISOString()
    });
  }
});

// Hold validated float lists by config_id
const validatedFloatLists = {};
const FLOAT_REVALIDATE_MS = parseInt(process.env.FLOAT_REVALIDATE_MS || '60000', 10);

// Validate symbol with mandatory and momentum conditions for a given config
async function validateSymbolForConfig(configId, symbol) {
  try {
    const result = await processAlert({
      ticker: symbol,
      symbol: symbol,
      timestamp: new Date().toISOString(),
      volume: 0,
      alert_type: 'float_validation'
    }, false);
    if (!result || !result.evaluation || !result.evaluation.allConditionsMet) return null;

    // Fetch candles to compute momentum
    const dateRange = polygonService.getExtendedDateRange(24 * 7);
    const [candles1m, candles5m] = await Promise.all([
      polygonService.fetch1MinuteCandles(symbol, dateRange.from, dateRange.to),
      polygonService.fetch5MinuteCandles(symbol, dateRange.from, dateRange.to)
    ]);
    if (!candles1m || candles1m.length === 0 || !candles5m || candles5m.length < 2) return null;

    const momentum = floatService.computeMomentum(candles1m, candles5m, result.lastCandle?.close || result.price);
    const groupInfo = floatService.getGroupInfoByConfig(configId);
    if (!groupInfo) return null;
    const okMomentum = floatService.meetsMomentum(groupInfo.key, momentum);
    if (!okMomentum) return null;

    return {
      ...result,
      momentum,
      floatGroup: groupInfo
    };
  } catch (e) {
    return null;
  }
}

// Listen for toplist updates and validate per FLOAT config
toplistService.onToplistUpdate(async (toplistUpdate) => {
  const configId = toplistUpdate.config_id;
  const rows = toplistUpdate.rows || [];
  if (!configId) return;

  // Helper parsers for ChartsWatcher column values
  const parsePercent = (val) => {
    if (val === null || val === undefined) return null;
    const clean = String(val).replace(/[^0-9.\-]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  };
  const parseIntLike = (val) => {
    if (val === null || val === undefined) return null;
    const clean = String(val).replace(/[^0-9\-]/g, '');
    const num = parseInt(clean, 10);
    return isNaN(num) ? null : num;
  };
  const parseVolume = (val) => {
    if (val === null || val === undefined) return null;
    const raw = String(val).trim();
    const num = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
    if (isNaN(num)) return null;
    const upper = raw.toUpperCase();
    if (upper.includes('B')) return Math.round(num * 1_000_000_000);
    if (upper.includes('M')) return Math.round(num * 1_000_000);
    if (upper.includes('K')) return Math.round(num * 1_000);
    return Math.round(num);
  };
  const pickColumnValue = (columnsByKey, candidates, fallbackMatcher) => {
    for (const key of candidates) {
      if (columnsByKey.has(key)) return columnsByKey.get(key).value;
    }
    if (fallbackMatcher) {
      for (const [k, obj] of columnsByKey.entries()) {
        if (fallbackMatcher(k)) return obj.value;
      }
    }
    return null;
  };

  // Resolve FLOAT group and thresholds for this config
  const groupInfo = floatService.getGroupInfoByConfig(configId);
  const thresholdsByGroup = floatService.getThresholds();
  const thresholds = groupInfo ? thresholdsByGroup[groupInfo.key] : null;
  
  const isManualConfig = configId === '692117e2b7bb6ba7a6ae6f6c';

  // Filter rows by ChartsWatcher metrics mapped to FLOAT config thresholds
  const filteredSymbols = rows.filter((row) => {
    if (isManualConfig) {
      scheduleManualUpdate(rows);
      return false; // Do not validate MANUAL list as FLOAT list
    }
    if (!thresholds) return false;
    const columns = Array.isArray(row.columns) ? row.columns : [];
    const columnsByKey = new Map(columns.map(c => [c.key, c]));

    // Mappings:
    // - 5 Min Change (%) => keys like 'PrzChangeFilterMIN5', fallbacks by regex
    const chg5mVal = pickColumnValue(
      columnsByKey,
      ['PrzChangeFilterMIN5', 'ChangeMIN5', 'Change5MIN'],
      (k) => /change/i.test(k) && /(min5|5min|fm5)/i.test(k)
    );
    const change5mPct = parsePercent(chg5mVal);

    // - 1 Min Trade Count => keys like 'TradeCountMIN1', 'TradeCountFM1'
    const trades1mVal = pickColumnValue(
      columnsByKey,
      ['TradeCountMIN1', 'TradesMIN1', 'TradeCountFM1'],
      (k) => /trade/i.test(k) && /(min1|1min|fm1)/i.test(k)
    );
    const trades1m = parseIntLike(trades1mVal);

    // - 5 Min Volume => keys like 'PrzVolumeFilterFM5', 'PrzVolumeFM5', 'VolumeMIN5'
    const vol5mVal = pickColumnValue(
      columnsByKey,
      ['PrzVolumeFilterFM5', 'PrzVolumeFM5', 'VolumeMIN5', 'Volume5MIN'],
      (k) => /volume/i.test(k) && /(min5|5min|fm5)/i.test(k)
    );
    const vol5m = parseVolume(vol5mVal);

    // - Change From Open (%) => keys like 'ChangeFromOpenPRZ', 'ChangeFromOpen'
    const chgFromOpenVal = pickColumnValue(
      columnsByKey,
      ['ChangeFromOpenPRZ', 'ChangeFromOpen'],
      (k) => /change/i.test(k) && /open/i.test(k)
    );
    const changeFromOpenPct = parsePercent(chgFromOpenVal);

    const checks = [
      change5mPct !== null && change5mPct >= thresholds.change5mPct,
      trades1m !== null && trades1m >= thresholds.trades1m,
      vol5m !== null && vol5m >= thresholds.vol5m,
      changeFromOpenPct !== null && changeFromOpenPct >= thresholds.changeFromOpenPct
    ];

    return checks.every(Boolean);
  }).map(row => row.symbol || (Array.isArray(row.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value) : null)).filter(Boolean);

  const symbols = filteredSymbols;
  if (symbols.length > 0) {
    const BATCH_SIZE = 4;
    const validated = [];
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const res = await Promise.all(batch.map(sym => validateSymbolForConfig(configId, sym)));
      validated.push(...res.filter(Boolean));
      if (i + BATCH_SIZE < symbols.length) await new Promise(r => setTimeout(r, 800));
    }
    // Preserve original order
    const orderMap = new Map(symbols.map((s, idx) => [s, idx]));
    validated.sort((a, b) => (orderMap.get(a.ticker) ?? 0) - (orderMap.get(b.ticker) ?? 0));

    const before = (validatedFloatLists[configId] || []).map(v => v.ticker).join(',');
    const after = validated.map(v => v.ticker).join(',');
    if (before !== after) {
      validatedFloatLists[configId] = validated;
      // Broadcast only when changed
      broadcastToClients({
        type: 'FLOAT_LIST_VALIDATED',
        data: { config_id: configId, results: validated },
        timestamp: new Date().toISOString()
      });
    }
  }

  // Also broadcast the raw toplist update for clients that need unfiltered data
  broadcastToClients({
    type: 'TOPLIST_UPDATE',
    data: toplistUpdate,
    timestamp: new Date().toISOString()
  });

  // Detect buy signals for this config (auto)
  await scanBuySignalsForConfig(configId);
  
  // Trigger instant re-analysis of this config's stocks for live momentum updates
  // This runs in background, doesn't block the toplist update handler
  setImmediate(() => analyzeConfigStocksInstantly(configId));
});

// Trigger catch-up buys when re-enabling buys
async function processCatchupBuys() {
  try {
    const nowIso = new Date().toISOString();
    const configIds = toplistService.configIDs || Object.keys(validatedFloatLists);
    for (const configId of configIds) {
      const list = validatedFloatLists[configId] || [];
      for (const item of list) {
        const ticker = item.ticker;
        const hist = item.indicators?.macd1m?.histogram;
        if (typeof hist !== 'number') continue;
        // On re-enable, buy if currently positive regardless of cross/positive mode
        if (hist > 0) {
          if (hasBoughtToday && hasBoughtToday(ticker)) {
            continue;
          }
          
          const groupKey = floatService.getGroupInfoByConfig(configId)?.key || null;
          
          // Use new buy order logic with LIMIT orders and quantity based on price
          const buyResult = await sendBuyOrder(ticker, configId, groupKey);
          
          // Calculate momentum at exact buy moment using fresh analysis
          let momentum = null;
          try {
            const analysis = await analyzeSymbol(ticker);
            momentum = analysis.momentum || null;
            // Also update indicators if they're more recent
            if (analysis.indicators) {
              item.indicators = analysis.indicators;
            }
          } catch (e) {
            console.error(`Error calculating momentum for ${ticker} at buy moment: ${e.message}`);
          }
          
          const entry = {
            ticker,
            timestamp: toUTC4(nowIso),
            price: buyResult.limitPrice || item.lastCandle?.close || item.price || null,
            configId: configId,
            group: groupKey,
            notifyStatus: buyResult.notifyStatus,
            indicators: item.indicators || null,
            momentum: momentum,
            quantity: buyResult.quantity,
            orderType: 'LIMIT',
            limitPrice: buyResult.limitPrice,
            stopLoss: buyResult.stopLoss
          };
          buyList.unshift(entry);
          if (typeof lastBuyTsByTicker !== 'undefined') {
            lastBuyTsByTicker.set(ticker, nowIso);
          }
          broadcastToClients({ type: 'BUY_SIGNAL', data: entry, timestamp: nowIso });
        }
      }
    }
  } catch (e) {
    console.error('Error during catch-up buys:', e.message);
  }
}

// Periodic revalidation: remove symbols that no longer meet conditions
async function revalidateCurrentFloatLists() {
  try {
    const configIds = toplistService.configIDs || Object.keys(validatedFloatLists);
    for (const configId of configIds) {
      const current = validatedFloatLists[configId] || [];
      if (current.length === 0) continue;
      const tickers = current.map(it => it.ticker);
      const BATCH_SIZE = 4;
      const refreshed = [];
      for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
        const batch = tickers.slice(i, i + BATCH_SIZE);
        const res = await Promise.all(batch.map(sym => validateSymbolForConfig(configId, sym)));
        refreshed.push(...res.filter(Boolean));
        if (i + BATCH_SIZE < tickers.length) await new Promise(r => setTimeout(r, 600));
      }
      // Only broadcast if changed (by ticker list)
      const before = tickers.join(',');
      const after = refreshed.map(r => r.ticker).join(',');
      validatedFloatLists[configId] = refreshed;
      if (before !== after) {
        broadcastToClients({
          type: 'FLOAT_LIST_VALIDATED',
          data: { config_id: configId, results: refreshed },
          timestamp: new Date().toISOString()
        });
      }

      // Update last histogram and check for crossings on refreshed data
      try {
        const nowIso = new Date().toISOString();
        for (const item of refreshed) {
          const ticker = item.ticker;
          const hist = item.indicators?.macd1m?.histogram;
          if (typeof hist !== 'number') continue;
          const prev = lastMacd1mHistogramByTicker.get(ticker);
          // CRITICAL: Only trigger on negative-to-positive crossover (prev was negative/zero, hist is now positive)
          // Do NOT update the map until after we've checked the crossover to avoid race conditions
          const crossedUp = typeof prev === 'number' && prev <= 0 && hist > 0;
          
          // Only update map after checking crossover
          lastMacd1mHistogramByTicker.set(ticker, hist);
          
          // For RAW analysis, ALWAYS require negative-to-positive crossover (not just positive)
          const shouldTrigger = buysEnabled && crossedUp;
          if (shouldTrigger) {
            // Avoid duplicate buys for the same symbol on the same day
            if (hasBoughtToday && hasBoughtToday(ticker)) {
              continue;
            }
            
            const groupKey = floatService.getGroupInfoByConfig(configId)?.key || null;
            
            console.log(`✅ MACD CROSSOVER DETECTED (revalidateCurrentFloatLists): ${ticker} - Previous: ${prev?.toFixed(4)}, Current: ${hist.toFixed(4)} (negative→positive)`);
            
            // Use new buy order logic with LIMIT orders and quantity based on price
            const buyResult = await sendBuyOrder(ticker, configId, groupKey);
            
            // Calculate momentum at exact buy moment using fresh analysis
            let momentum = null;
            try {
              const analysis = await analyzeSymbol(ticker);
              momentum = analysis.momentum || null;
              // Also update indicators if they're more recent
              if (analysis.indicators) {
                item.indicators = analysis.indicators;
              }
            } catch (e) {
              console.error(`Error calculating momentum for ${ticker} at buy moment: ${e.message}`);
            }
            
            const entry = {
              ticker,
              timestamp: toUTC4(nowIso),
              price: buyResult.limitPrice || item.lastCandle?.close || item.price || null,
              configId: configId,
              group: groupKey,
              notifyStatus: buyResult.notifyStatus,
              indicators: item.indicators || null,
              momentum: momentum,
              quantity: buyResult.quantity,
              orderType: 'LIMIT',
              limitPrice: buyResult.limitPrice,
              stopLoss: buyResult.stopLoss
            };
            buyList.unshift(entry);
            lastBuyTsByTicker.set(ticker, nowIso);
            broadcastToClients({ type: 'BUY_SIGNAL', data: entry, timestamp: nowIso });
          }
        }
      } catch (e) {
      }
    }
  } catch (e) {
  }
}

setInterval(revalidateCurrentFloatLists, FLOAT_REVALIDATE_MS);

// ---------------------------------------------
// Continuous analysis of RAW toplists every 5s
// ---------------------------------------------
const RAW_ANALYZE_INTERVAL_MS = parseInt(process.env.RAW_ANALYZE_INTERVAL_MS || '5000', 10);
let isRawAnalyzeRunning = false;

function suppressLogs(run) {
  const origLog = console.log;
  const origInfo = console.info;
  const origDebug = console.debug;
  try {
    console.log = () => {};
    console.info = () => {};
    console.debug = () => {};
    return run();
  } finally {
    console.log = origLog;
    console.info = origInfo;
    console.debug = origDebug;
  }
}

function parsePercent(val) {
  if (val === null || val === undefined) return null;
  const clean = String(val).replace(/[^0-9.\-]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? null : num;
}
function parseIntLike(val) {
  if (val === null || val === undefined) return null;
  const clean = String(val).replace(/[^0-9\-]/g, '');
  const num = parseInt(clean, 10);
  return isNaN(num) ? null : num;
}
function parseVolume(val) {
  if (val === null || val === undefined) return null;
  const raw = String(val).trim();
  const num = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
  if (isNaN(num)) return null;
  const upper = raw.toUpperCase();
  if (upper.includes('B')) return Math.round(num * 1000000000);
  if (upper.includes('M')) return Math.round(num * 1000000);
  if (upper.includes('K')) return Math.round(num * 1000);
  return Math.round(num);
}
function pickColumnValue(columnsByKey, candidates, fallbackMatcher) {
  for (const key of candidates) {
    if (columnsByKey.has(key)) return columnsByKey.get(key).value;
  }
  if (fallbackMatcher) {
    for (const [k, obj] of columnsByKey.entries()) {
      if (fallbackMatcher(k)) return obj.value;
    }
  }
  return null;
}

async function analyzeRawToplists() {
  if (isRawAnalyzeRunning) return;
  isRawAnalyzeRunning = true;
  const startTs = Date.now();
  try {
    const configIds = toplistService.configIDs || Object.keys(validatedFloatLists);
    let totalRows = 0;
    let totalCandidates = 0;
    let totalValidated = 0;

    for (const configId of configIds) {
      const rows = (toplistService.toplistByConfig && toplistService.toplistByConfig[configId]) || [];
      totalRows += rows.length;
      if (rows.length === 0) {
        validatedFloatLists[configId] = [];
        continue;
      }

      const groupInfo = floatService.getGroupInfoByConfig(configId);
      const thresholdsByGroup = floatService.getThresholds();
      const thresholds = groupInfo ? thresholdsByGroup[groupInfo.key] : null;

      // Symbols present in RAW for visibility/logging (all rows considered "analyzed")
      const allSymbols = rows
        .map(row => row.symbol || (Array.isArray(row.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value) : null))
        .filter(Boolean);

      // Analyze all symbols from RAW (no pre-filtering here)
      const candidateSymbols = allSymbols;

      totalCandidates += candidateSymbols.length;

      const BATCH_SIZE = 4;
      const validated = [];
      // Temporarily suppress verbose logs during deep validation
      await suppressLogs(async () => {
        for (let i = 0; i < candidateSymbols.length; i += BATCH_SIZE) {
          const batch = candidateSymbols.slice(i, i + BATCH_SIZE);
          const res = await Promise.all(batch.map(sym => validateSymbolForConfig(configId, sym)));
          validated.push(...res.filter(Boolean));
          if (i + BATCH_SIZE < candidateSymbols.length) await new Promise(r => setTimeout(r, 400));
        }
      });

      const orderMap = new Map(candidateSymbols.map((s, idx) => [s, idx]));
      validated.sort((a, b) => (orderMap.get(a.ticker) ?? 0) - (orderMap.get(b.ticker) ?? 0));

      const beforeTickers = (validatedFloatLists[configId] || []).map(v => v.ticker).join(',');
      validatedFloatLists[configId] = validated;
      const afterTickers = validated.map(v => v.ticker).join(',');
      totalValidated += validated.length;

      if (beforeTickers !== afterTickers) {
        broadcastToClients({
          type: 'FLOAT_LIST_VALIDATED',
          data: { config_id: configId, results: validated },
          timestamp: new Date().toISOString()
        });
      }

      // Log analyzed symbols per list: RAW and FLOAT
      const groupLabel = groupInfo?.key || '?';
      const validatedTickers = validated.map(v => v.ticker).filter(Boolean);

      // Also scan buy signals on each analysis cycle
      await scanBuySignalsForConfig(configId);

    }

    // No verbose summary; symbols already logged above per group
  } catch (e) {
  } finally {
    isRawAnalyzeRunning = false;
  }
}

// DISABLED: analyzeRawToplists to prevent conflicts with computeRawFiveTechChecks
// setInterval(analyzeRawToplists, RAW_ANALYZE_INTERVAL_MS);

// ---------------------------------------------
// Every 10s: compute raw unified five-tech checks and momentum checks, broadcast both
// ---------------------------------------------
const RAW_TECH_CHECK_INTERVAL_MS = 10000;
let lastRawTechChecksResult = { meetsTech: [], meetsMomentum: [] };
// Authoritative current sets for hydration and multi-user consistency
let currentMeetsTechSet = new Set();
let currentMeetsMomentumSet = new Set();
const analysisInProgress = new Set(); // Track symbols currently being analyzed to avoid duplicates

// Instant analysis for a specific config when WebSocket update arrives
async function analyzeConfigStocksInstantly(configId) {
  // Wait for any ongoing analysis to complete
  while (isAnalysisRunning) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  isAnalysisRunning = true;
  
  try {
    const rows = toplistService.toplistByConfig?.[configId] || [];
    if (rows.length === 0) return;
    
    const groupInfo = floatService.getGroupInfoByConfig(configId);
    const origin = groupInfo?.key || '?';
    const thresholds = floatService.getThresholds()[origin];
    const isManualConfig = configId === '692117e2b7bb6ba7a6ae6f6c';
    
    if (!thresholds && !isManualConfig) return;
    
    console.log(`⚡ INSTANT ANALYSIS for config ${configId} (${origin}): ${rows.length} stocks`);
    
    // Helper parsers
    const parsePercent = (val) => {
      if (val === null || val === undefined) return null;
      const clean = String(val).replace(/[^0-9.\-]/g, '');
      const num = parseFloat(clean);
      return isNaN(num) ? null : num;
    };
    const parseIntLike = (val) => {
      if (val === null || val === undefined) return null;
      const clean = String(val).replace(/[^0-9\-]/g, '');
      const num = parseInt(clean, 10);
      return isNaN(num) ? null : num;
    };
    const parseVolume = (val) => {
      if (val === null || val === undefined) return null;
      const raw = String(val).trim();
      const num = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
      if (isNaN(num)) return null;
      const upper = raw.toUpperCase();
      if (upper.includes('B')) return Math.round(num * 1_000_000_000);
      if (upper.includes('M')) return Math.round(num * 1_000_000);
      if (upper.includes('K')) return Math.round(num * 1_000);
      return Math.round(num);
    };
    const pickColumnValue = (columnsByKey, candidates, fallbackMatcher) => {
      for (const key of candidates) {
        if (columnsByKey.has(key)) return columnsByKey.get(key).value;
      }
      if (fallbackMatcher) {
        for (const [k, obj] of columnsByKey.entries()) {
          if (fallbackMatcher(k)) return obj.value;
        }
      }
      return null;
    };
    
    // Analyze in small batches for responsiveness
    const BATCH_SIZE = 2;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(async (row) => {
        try {
          const symbol = row?.symbol || (Array.isArray(row?.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value) : null);
          if (!symbol || analysisInProgress.has(String(symbol).trim().toUpperCase())) {
            return null;
          }
          const normalizedSymbol = String(symbol).trim().toUpperCase();
          analysisInProgress.add(normalizedSymbol);
          const res = await analyzeSymbol(normalizedSymbol);
          analysisInProgress.delete(normalizedSymbol);
          return res ? { symbol: normalizedSymbol, meetsTech: !!res.meetsTech, meetsMomentum: !!res.meetsMomentum, indicators: res.indicators || null, lastClose: res.lastClose || null, momentum: res.momentum || null } : null;
        } catch (e) {
          const sym = row?.symbol || 'unknown';
          const normalized = String(sym).trim().toUpperCase();
          analysisInProgress.delete(normalized);
          return null;
        }
      }));
      
      // Broadcast each result immediately
      for (const r of results) {
        if (!r) continue;
        const normalizedSymbol = String(r.symbol).trim().toUpperCase();
        
        // Broadcast update
        broadcastToClients({
          type: 'STOCK_TECH_UPDATE',
          data: {
            symbol: normalizedSymbol,
            meetsTech: r.meetsTech,
            meetsMomentum: r.meetsMomentum,
            indicators: r.indicators
          },
          timestamp: new Date().toISOString()
        });
        // Update authoritative cache sets immediately for hydration
        if (r.meetsTech) currentMeetsTechSet.add(normalizedSymbol); else currentMeetsTechSet.delete(normalizedSymbol);
        if (r.meetsMomentum) currentMeetsMomentumSet.add(normalizedSymbol); else currentMeetsMomentumSet.delete(normalizedSymbol);
        lastRawTechChecksResult = {
          meetsTech: Array.from(currentMeetsTechSet),
          meetsMomentum: Array.from(currentMeetsMomentumSet)
        };
        
        // Check for buy signal if conditions met
        if (buysEnabled && r.meetsTech && r.meetsMomentum && r.indicators) {
          const hist1m = r.indicators?.macd1m?.histogram;
          if (typeof hist1m === 'number') {
            const prevHist = lastMacd1mHistogramByTicker.get(r.symbol);
            // CRITICAL: Only trigger on negative-to-positive crossover (prevHist was negative/zero, hist1m is now positive)
            // Do NOT update the map until after we've checked the crossover to avoid race conditions
            const crossedUp = typeof prevHist === 'number' && prevHist <= 0 && hist1m > 0;
            
            // SAFEGUARD: Explicitly prevent buying on positive-to-negative crossover (opposite direction)
            const crossedDown = typeof prevHist === 'number' && prevHist > 0 && hist1m <= 0;
            if (crossedDown) {
              console.warn(`⚠️ SKIPPED BUY (wrong direction): ${r.symbol} - MACD 1m histogram crossed DOWN (prev=${prevHist?.toFixed(4)}, current=${hist1m.toFixed(4)}). Only buying on negative→positive crossover.`);
              lastMacd1mHistogramByTicker.set(r.symbol, hist1m);
              continue;
            }
            
            // Only update map after checking crossover
            lastMacd1mHistogramByTicker.set(r.symbol, hist1m);
            
            if (crossedUp && !hasBoughtToday(r.symbol)) {
              const nowIso = new Date().toISOString();
              
              console.log(`✅ MACD CROSSOVER DETECTED: ${r.symbol} - Previous: ${prevHist?.toFixed(4)}, Current: ${hist1m.toFixed(4)} (negative→positive)`);
              
              // Use new buy order logic with LIMIT orders and quantity based on price
              const buyResult = await sendBuyOrder(r.symbol, configId, origin);
              
              console.log(`🛒 INSTANT BUY: ${r.symbol} - MACD 1m histogram: ${hist1m.toFixed(4)}, Quantity: ${buyResult.quantity}, Limit Price: ${buyResult.limitPrice}`);
              if (buyResult.stopLoss) {
                console.log(`🛡️ Stop-loss created for ${r.symbol}: ${buyResult.stopLoss.stopLossPrice} (offset: -${buyResult.stopLoss.stopLossOffset?.toFixed(2)})`);
              }
              
              // Use momentum calculated from analyzeSymbol (at exact buy moment)
              const entry = {
                ticker: r.symbol,
                timestamp: toUTC4(nowIso),
                price: buyResult.limitPrice || r.lastClose || null,
                configId: configId,
                group: origin,
                notifyStatus: buyResult.notifyStatus,
                indicators: r.indicators || null,
                momentum: r.momentum || null,
                quantity: buyResult.quantity,
                orderType: 'LIMIT',
                limitPrice: buyResult.limitPrice,
                stopLoss: buyResult.stopLoss
              };
              buyList.unshift(entry);
              lastBuyTsByTicker.set(r.symbol, nowIso);
              broadcastToClients({ type: 'BUY_SIGNAL', data: entry, timestamp: nowIso });
            }
          } else if ((ticker === 'RR' || ticker === 'ACAD')) {
            console.log(`  ⚠️ SKIPPED: MACD 1m histogram missing or invalid (${hist1m})`);
          }
        }
        
        // Remove from in-progress
        analysisInProgress.delete(normalizedSymbol);
      }
      
      // Small delay between batches
      if (i + BATCH_SIZE < rows.length) await new Promise(r => setTimeout(r, 200));
    }
  } catch (e) {
    console.error('Error in instant analysis:', e.message);
  } finally {
    isAnalysisRunning = false;
  }
}

async function computeRawFiveTechChecks() {
  // Wait for any ongoing analysis to complete
  while (isAnalysisRunning) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  isAnalysisRunning = true;
  
  try {
    const toplistMap = toplistService.toplistByConfig || {};
    // Build symbol->origin map
    const symbolOriginMap = new Map();
    Object.keys(toplistMap).forEach((configId) => {
      const groupInfo = floatService.getGroupInfoByConfig(configId);
      const origin = groupInfo?.key || '?';
      const rows = toplistMap[configId] || [];
      rows.forEach((row) => {
        const sym = row?.symbol || (Array.isArray(row?.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value) : null);
        if (sym) symbolOriginMap.set(sym, origin);
      });
    });
    const allSymbols = Array.from(symbolOriginMap.keys());
    if (allSymbols.length === 0) {
      lastRawTechChecksResult = { meetsTech: [], meetsMomentum: [] };
      broadcastToClients({
        type: 'RAW_TECH_CHECKS',
        data: lastRawTechChecksResult,
        timestamp: new Date().toISOString()
      });
      return;
    }
    const meetsTechSet = new Set();
    const meetsMomentumSet = new Set();
    const BATCH_SIZE = 4;
    for (let i = 0; i < allSymbols.length; i += BATCH_SIZE) {
      const batch = allSymbols.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(async (symbol) => {
        try {
          const res = await analyzeSymbol(symbol);
          return { symbol, meetsTech: !!res.meetsTech, meetsMomentum: !!res.meetsMomentum, indicators: res.indicators || null, lastClose: res.lastClose || null, momentum: res.momentum || null };
        } catch (e) {
          return { symbol, meetsTech: false, meetsMomentum: false, indicators: null, lastClose: null };
        }
      }));
      // Process each result immediately for live updates
      for (const r of results) {
        const ticker = r.symbol;
        const normalizedSymbol = String(ticker).trim().toUpperCase();
        
        // Decide new state
        const newTech = !!r.meetsTech;
        const newMomentum = !!r.meetsMomentum;
        const prevTech = meetsTechSet.has(normalizedSymbol);
        const prevMomentum = meetsMomentumSet.has(normalizedSymbol);

        // Update sets (add if meets, remove if doesn't)
        if (newTech) meetsTechSet.add(normalizedSymbol); else meetsTechSet.delete(normalizedSymbol);
        if (newMomentum) meetsMomentumSet.add(normalizedSymbol); else meetsMomentumSet.delete(normalizedSymbol);
        
        // Broadcast only on state change to reduce flicker/noise
        if (prevTech !== newTech || prevMomentum !== newMomentum) {
          broadcastToClients({
            type: 'STOCK_TECH_UPDATE',
            data: {
              symbol: normalizedSymbol,
              meetsTech: newTech,
              meetsMomentum: newMomentum
            },
            timestamp: new Date().toISOString()
          });
        }
        
        // Log changes for visibility (info level only)
        if (newTech && newMomentum) {
          log('info', `🟢 ${normalizedSymbol}: Tech ✓ Momentum ✓`);
        } else if (newTech) {
          log('info', `🟡 ${normalizedSymbol}: Tech ✓`);
        } else if (!newTech && (prevTech || prevMomentum)) {
          log('info', `⚪ ${normalizedSymbol}: Unmarked`);
        }
        
        // Debug logging for specific stocks
        if (ticker === 'RR' || ticker === 'ACAD') {
          logIfDebugTicker(ticker, `\n🔍 DEBUG ${ticker}:`);
          logIfDebugTicker(ticker, `  - Buys Enabled: ${buysEnabled}`);
          logIfDebugTicker(ticker, `  - Meets Tech: ${r.meetsTech}`);
          logIfDebugTicker(ticker, `  - Meets Momentum: ${r.meetsMomentum}`);
          logIfDebugTicker(ticker, `  - Has Indicators: ${!!r.indicators}`);
          if (r.indicators?.macd1m) {
            logIfDebugTicker(ticker, `  - MACD 1m histogram: ${r.indicators.macd1m.histogram}`);
            logIfDebugTicker(ticker, `  - MACD 1m macd: ${r.indicators.macd1m.macd}`);
          }
          if (r.indicators?.macd5m) {
            logIfDebugTicker(ticker, `  - MACD 5m histogram: ${r.indicators.macd5m.histogram}`);
            logIfDebugTicker(ticker, `  - MACD 5m macd: ${r.indicators.macd5m.macd}`);
          }
          logIfDebugTicker(ticker, `  - Already bought today: ${hasBoughtToday(ticker)}`);
        }
        
        if (buysEnabled) {
          if (r.meetsTech && r.meetsMomentum && r.indicators) {
            const hist1m = r.indicators?.macd1m?.histogram;
            if (typeof hist1m === 'number') {
              const prevHist = lastMacd1mHistogramByTicker.get(ticker);
              // CRITICAL: Only trigger on negative-to-positive crossover (prevHist was negative/zero, hist1m is now positive)
              // Do NOT update the map until after we've checked the crossover to avoid race conditions
              const crossedUp = typeof prevHist === 'number' && prevHist <= 0 && hist1m > 0;
              
              // SAFEGUARD: Explicitly prevent buying on positive-to-negative crossover (opposite direction)
              const crossedDown = typeof prevHist === 'number' && prevHist > 0 && hist1m <= 0;
              if (crossedDown) {
                console.warn(`⚠️ SKIPPED BUY (wrong direction): ${ticker} - MACD 1m histogram crossed DOWN (prev=${prevHist?.toFixed(4)}, current=${hist1m.toFixed(4)}). Only buying on negative→positive crossover.`);
                lastMacd1mHistogramByTicker.set(ticker, hist1m);
                continue;
              }
              
              // Only update map after checking crossover
              lastMacd1mHistogramByTicker.set(ticker, hist1m);
              
              // Check if already bought today
              if (!crossedUp) {
                if (ticker === 'RR' || ticker === 'ACAD') {
                  console.log(`  ⚠️ SKIPPED: MACD 1m histogram did not cross up (prev=${prevHist}, current=${hist1m})`);
                }
                continue;
              }
              if (hasBoughtToday && hasBoughtToday(ticker)) {
                if (ticker === 'RR' || ticker === 'ACAD') {
                  console.log(`  ⚠️ SKIPPED: Already bought today`);
                }
                continue;
              }
              
              const nowIso = new Date().toISOString();
              const origin = symbolOriginMap.get(ticker) || '?';
              
              console.log(`✅ MACD CROSSOVER DETECTED: ${ticker} - Previous: ${prevHist?.toFixed(4)}, Current: ${hist1m.toFixed(4)} (negative→positive)`);
              
              // Use new buy order logic with LIMIT orders and quantity based on price
              const buyResult = await sendBuyOrder(ticker, null, origin);
              
              console.log(`🛒 BUY TRIGGERED: ${ticker} - MACD 1m histogram cross: ${hist1m.toFixed(4)}, Quantity: ${buyResult.quantity}, Limit Price: ${buyResult.limitPrice}`);
              if (buyResult.stopLoss) {
                console.log(`🛡️ Stop-loss created for ${ticker}: ${buyResult.stopLoss.stopLossPrice} (offset: -${buyResult.stopLoss.stopLossOffset?.toFixed(2)})`);
              }
              
              // Use momentum calculated from analyzeSymbol (at exact buy moment)
              const entry = {
                ticker,
                timestamp: toUTC4(nowIso),
                price: buyResult.limitPrice || r.lastClose || null,
                configId: null,
                group: origin,
                notifyStatus: buyResult.notifyStatus,
                indicators: r.indicators || null,
                momentum: r.momentum || null,
                quantity: buyResult.quantity,
                orderType: 'LIMIT',
                limitPrice: buyResult.limitPrice,
                stopLoss: buyResult.stopLoss
              };
              buyList.unshift(entry);
              lastBuyTsByTicker.set(ticker, nowIso);
              broadcastToClients({ type: 'BUY_SIGNAL', data: entry, timestamp: nowIso });
            } else if (ticker === 'RR' || ticker === 'ACAD') {
              console.log(`  ⚠️ SKIPPED: MACD 1m histogram missing or invalid (${hist1m})`);
            }
          } else {
            if (ticker === 'RR' || ticker === 'ACAD') {
              console.log(`  ⚠️ SKIPPED: meetsTech=${r.meetsTech}, meetsMomentum=${r.meetsMomentum}, hasIndicators=${!!r.indicators}`);
            }
          }
        }
      }
      
      if (i + BATCH_SIZE < allSymbols.length) await new Promise(r => setTimeout(r, 400));
    }
    // Store and broadcast latest meets sets (ensure uppercase for consistency)
    lastRawTechChecksResult = {
      meetsTech: Array.from(meetsTechSet).map(s => String(s).trim().toUpperCase()),
      meetsMomentum: Array.from(meetsMomentumSet).map(s => String(s).trim().toUpperCase())
    };
    console.log(`✓ RAW_TECH_CHECKS: ${lastRawTechChecksResult.meetsTech.length} stocks meet tech: ${lastRawTechChecksResult.meetsTech.join(', ')}`);
    console.log(`✓ RAW_TECH_CHECKS: ${lastRawTechChecksResult.meetsMomentum.length} stocks meet momentum: ${lastRawTechChecksResult.meetsMomentum.join(', ')}`);
    broadcastToClients({
      type: 'RAW_TECH_CHECKS',
      data: lastRawTechChecksResult,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('Error computing raw tech checks:', e.message);
  } finally {
    isAnalysisRunning = false;
  }
}
// DISABLED: Periodic analysis to prevent conflicts and flickering
// setInterval(computeRawFiveTechChecks, RAW_TECH_CHECK_INTERVAL_MS);
// setTimeout(() => computeRawFiveTechChecks(), 5000);

// Helper: scan buy signals for a specific config from current validated list
async function scanBuySignalsForConfig(configId) {
  try {
    const list = validatedFloatLists[configId] || [];
    const nowIso = new Date().toISOString();
    for (const item of list) {
      const ticker = item.ticker;
      const hist = item.indicators?.macd1m?.histogram;
      if (typeof hist !== 'number') continue;
      const prev = lastMacd1mHistogramByTicker.get(ticker);
      // CRITICAL: Only trigger on negative-to-positive crossover (prev was negative/zero, hist is now positive)
      // Do NOT update the map until after we've checked the crossover to avoid race conditions
      const crossedUp = typeof prev === 'number' && prev <= 0 && hist > 0;
      
      // Only update map after checking crossover
      lastMacd1mHistogramByTicker.set(ticker, hist);
      
      // For RAW analysis, ALWAYS require negative-to-positive crossover (not just positive)
      const shouldTrigger = buysEnabled && crossedUp;
      if (!shouldTrigger) continue;
      if (hasBoughtToday && hasBoughtToday(ticker)) continue;
      
      const groupKey = floatService.getGroupInfoByConfig(configId)?.key || null;
      
      console.log(`✅ MACD CROSSOVER DETECTED (scanBuySignalsForConfig): ${ticker} - Previous: ${prev?.toFixed(4)}, Current: ${hist.toFixed(4)} (negative→positive)`);
      
      // Use new buy order logic with LIMIT orders and quantity based on price
      const buyResult = await sendBuyOrder(ticker, configId, groupKey);
      
      // Calculate momentum at exact buy moment using fresh analysis
      let momentum = null;
      try {
        const analysis = await analyzeSymbol(ticker);
        momentum = analysis.momentum || null;
        // Also update indicators if they're more recent
        if (analysis.indicators) {
          item.indicators = analysis.indicators;
        }
      } catch (e) {
        console.error(`Error calculating momentum for ${ticker} at buy moment: ${e.message}`);
      }
      
      const entry = {
        ticker,
        timestamp: toUTC4(nowIso),
        price: buyResult.limitPrice || item.lastCandle?.close || item.price || null,
        configId: configId,
        group: groupKey,
        notifyStatus: buyResult.notifyStatus,
        indicators: item.indicators || null,
        momentum: momentum,
        quantity: buyResult.quantity,
        orderType: 'LIMIT',
        limitPrice: buyResult.limitPrice,
        stopLoss: buyResult.stopLoss
      };
      buyList.unshift(entry);
      if (typeof lastBuyTsByTicker !== 'undefined') {
        lastBuyTsByTicker.set(ticker, nowIso);
      }
      broadcastToClients({ type: 'BUY_SIGNAL', data: entry, timestamp: nowIso });
    }
  } catch (e) {
    console.error('Error scanning buy signals:', e.message);
  }
}

// Create a valid example alert that passes all conditions
function createValidExampleAlert(alert) {
  const currentPrice = alert.price;
  
  // Create indicators that pass all conditions
  const indicators = {
    ema1m12: currentPrice * 0.99, // EMA 12 for 1m
    ema1m18: currentPrice * 0.98, // Slightly below current price
    ema1m20: currentPrice * 0.97, // EMA 20 for 1m
    ema1m26: currentPrice * 0.96, // EMA 26 for 1m
    ema1m200: currentPrice * 0.85, // Well below current price
    ema5m18: currentPrice * 0.99, // Slightly below current price
    ema5m20: currentPrice * 0.98, // EMA 20 for 5m
    ema5m200: currentPrice * 0.90, // Below current price
    macd1m: {
      macd: 0.15,
      signal: 0.12,
      histogram: 0.03 // Positive
    },
    macd5m: {
      macd: 0.25,
      signal: 0.20,
      histogram: 0.05 // Positive
    },
    vwap1m: currentPrice * 0.95, // Below current price
    lod: currentPrice * 0.92, // Low of day
    hod: currentPrice * 1.08 // High of day
  };

  // Create evaluation that passes all conditions
  const evaluation = {
    score: "7/7",
    allConditionsMet: true,
    failedConditions: []
  };

  return {
    ticker: alert.ticker,
    timestamp: alert.timestamp,
    price: alert.price,
    volume: alert.volume,
    indicators: indicators,
    evaluation: evaluation,
    lastCandle: {
      close: currentPrice,
      volume: alert.volume
    }
  };
}

// Create real stock alerts with actual market data
async function createRealStockAlerts() {
  const popularStocks = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NFLX'];
  const realAlerts = [];
  
  
  for (let i = 0; i < popularStocks.length; i++) {
    const ticker = popularStocks[i];
    const minutesAgo = (i + 1) * 2; // Stagger alerts by 2 minutes each
    
    try {
      // Get current price for the stock
      const currentPrice = await polygonService.getCurrentPrice(ticker);
      
      // Create alert with real price
      const alert = {
        ticker: ticker,
        symbol: ticker,
        timestamp: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        time: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        created_at: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        instrument: ticker,
        price: currentPrice,
        volume: Math.floor(Math.random() * 2000000) + 500000, // Random volume between 500k-2.5M
        alert_type: 'real_stock_alert',
        color: '#00ff00',
        text_color: '#ffffff',
        config_id: 'real_stock_config'
      };
      
      realAlerts.push(alert);
      
      // Small delay to avoid API rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      
      // Fallback to a reasonable price if API fails
      const fallbackPrices = {
        'AAPL': 185.42,
        'TSLA': 248.75,
        'NVDA': 875.30,
        'MSFT': 412.85,
        'GOOGL': 142.60,
        'AMZN': 155.80,
        'META': 485.25,
        'NFLX': 625.40
      };
      
      const alert = {
        ticker: ticker,
        symbol: ticker,
        timestamp: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        time: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        created_at: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        instrument: ticker,
        price: fallbackPrices[ticker] || 100.00,
        volume: Math.floor(Math.random() * 2000000) + 500000,
        alert_type: 'real_stock_alert_fallback',
        color: '#00ff00',
        text_color: '#ffffff',
        config_id: 'real_stock_config'
      };
      
      realAlerts.push(alert);
    }
  }
  
  return realAlerts;
}

// Create 3 forced valid alerts with real market data
async function createForcedValidAlerts() {
  const testStocks = ['AAPL', 'TSLA', 'NVDA']; // Top 3 popular stocks
  const forcedValidAlerts = [];
  
  
  for (let i = 0; i < testStocks.length; i++) {
    const ticker = testStocks[i];
    const minutesAgo = (i + 1) * 1; // Stagger by 1 minute each
    
    try {
      // Get current price for the stock
      const currentPrice = await polygonService.getCurrentPrice(ticker);
      
      // Create alert with real price but force it as valid
      const alert = {
        ticker: ticker,
        symbol: ticker,
        timestamp: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        time: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        created_at: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        instrument: ticker,
        price: currentPrice,
        volume: Math.floor(Math.random() * 2000000) + 500000,
        alert_type: 'forced_valid_alert', // Special type to force as valid
        color: '#00ff00',
        text_color: '#ffffff',
        config_id: 'forced_valid_config'
      };
      
      forcedValidAlerts.push(alert);
      
      // Small delay to avoid API rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      
      // Fallback prices for the top 3 stocks
      const fallbackPrices = {
        'AAPL': 185.42,
        'TSLA': 248.75,
        'NVDA': 875.30
      };
      
      const alert = {
        ticker: ticker,
        symbol: ticker,
        timestamp: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        time: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        created_at: new Date(Date.now() - (minutesAgo * 60000)).toISOString(),
        instrument: ticker,
        price: fallbackPrices[ticker] || 100.00,
        volume: Math.floor(Math.random() * 2000000) + 500000,
        alert_type: 'forced_valid_alert_fallback',
        color: '#00ff00',
        text_color: '#ffffff',
        config_id: 'forced_valid_config'
      };
      
      forcedValidAlerts.push(alert);
    }
  }
  
  return forcedValidAlerts;
}

// Helper function to process alert normally (without special handling)
async function processAlertNormally(alert, validateNASDAQ = false) {
  try {
    const ticker = chartsWatcherService.extractTicker(alert);
    const timestamp = chartsWatcherService.extractTimestamp(alert);
    
    // Use price from ChartsWatcher alert (prioritize close, then price field)
    const currentPrice = alert.close || alert.price || null;
    

    
    // Validate NASDAQ listing if requested
    if (validateNASDAQ) {
      try {
        await polygonService.validateNASDAQ(ticker);
      } catch (validationError) {
        return null;
      }
    }
    
    // Enhanced data fetching strategy with extended trading hours support
    let candles1m, candles5m;
    let isExtendedHours = false;
    
    // Check if we're currently in extended trading hours
    const currentSession = polygonService.getCurrentTradingSession();
    const useExtendedHours = polygonService.isExtendedHours();
    
    // console.log(`[Extended Hours] Processing ${ticker} - Current session: ${currentSession}, Extended hours: ${useExtendedHours}`);
    
    try {
      if (useExtendedHours) {
        // Use extended trading hours data with adaptive fetching
        // console.log(`[Extended Hours] Fetching extended hours data for ${ticker}`);
        
        // Try adaptive fetching with progressively longer periods
        const timeRanges = [
          { days: 7, hours: 168 },
          { days: 15, hours: 360 },
          { days: 30, hours: 720 },
          { days: 60, hours: 1440 }
        ];
        
        let fetchSuccess = false;
        for (const timeRange of timeRanges) {
          try {
            const [extendedData1m, extendedData5m] = await Promise.all([
              polygonService.fetchExtendedHoursCandles(ticker, 1, true, timeRange.days),
              polygonService.fetchExtendedHoursCandles(ticker, 5, true, timeRange.days)
            ]);
            
            const tempCandles1m = extendedData1m.candles;
            const tempCandles5m = extendedData5m.candles;
            
            // Check if we have enough candles for EMA200 (need at least 200 for both 1m and 5m)
            if (tempCandles1m.length >= 200 && tempCandles5m.length >= 200) {
              // console.log(`[Adaptive] Successful fetch for ${ticker}: ${tempCandles1m.length} 1m candles, ${tempCandles5m.length} 5m candles with ${timeRange.days} days`);
              candles1m = tempCandles1m;
              candles5m = tempCandles5m;
              fetchSuccess = true;
              break;
            } else {
              // console.log(`[Adaptive] Insufficient candles for ${ticker} with ${timeRange.days} days: ${tempCandles1m.length} 1m, ${tempCandles5m.length} 5m (need 200+ for both)`);
            }
          } catch (error) {
            // console.log(`[Adaptive] Error fetching ${ticker} with ${timeRange.days} days: ${error.message}`);
          }
        }
        
        if (!fetchSuccess) {
          // console.warn(`[Adaptive] Failed to fetch sufficient candles for ${ticker} after trying all time ranges`);
          // Use the last attempt's data anyway
          const [extendedData1m, extendedData5m] = await Promise.all([
            polygonService.fetchExtendedHoursCandles(ticker, 1, true, 60),
            polygonService.fetchExtendedHoursCandles(ticker, 5, true, 60)
          ]);
          candles1m = extendedData1m.candles;
          candles5m = extendedData5m.candles;
        }
        
        isExtendedHours = true;
        
        // console.log(`[Extended Hours] Retrieved ${candles1m.length} 1m candles and ${candles5m.length} 5m candles for ${ticker}`);
      } else {
        // Use regular market hours data
        // console.log(`[Extended Hours] Fetching regular market hours data for ${ticker}`);
        
        // Start with 10 days for better EMA200 accuracy, extend if needed
        let daysToFetch = 10;
        let attemptCount = 0;
        const maxAttempts = 4; // Try 10, 15, 20, 30 days
        
        while (attemptCount < maxAttempts) {
          const hoursBack = daysToFetch * 24;
          const dateRange = polygonService.getExtendedDateRange(hoursBack);
          const from = dateRange.from;
          const to = dateRange.to;
          
          // Fetch OHLCV data
          [candles1m, candles5m] = await Promise.all([
            polygonService.fetch1MinuteCandles(ticker, from, to),
            polygonService.fetch5MinuteCandles(ticker, from, to)
          ]);
          
          if (!candles1m || candles1m.length === 0) {
            return null;
          }
          
          // Try market hours filtering first
          const marketHoursCandles1m = candles1m.filter(candle => {
            const candleDate = new Date(candle.timestamp);
            const utcHours = candleDate.getUTCHours();
            const utcMinutes = candleDate.getUTCMinutes();
            const utcTimeInMinutes = (utcHours * 60) + utcMinutes;
            const marketStartUTC = 13 * 60 + 30; // 13:30 UTC = 9:30 AM ET
            const marketEndUTC = 20 * 60;        // 20:00 UTC = 4:00 PM ET
            return utcTimeInMinutes >= marketStartUTC && utcTimeInMinutes < marketEndUTC;
          });
          
          const marketHoursCandles5m = candles5m?.filter(candle => {
            const candleDate = new Date(candle.timestamp);
            const utcHours = candleDate.getUTCHours();
            const utcMinutes = candleDate.getUTCMinutes();
            const utcTimeInMinutes = (utcHours * 60) + utcMinutes;
            const marketStartUTC = 13 * 60 + 30;
            const marketEndUTC = 20 * 60;
            return utcTimeInMinutes >= marketStartUTC && utcTimeInMinutes < marketEndUTC;
          }) || [];
          
          // Check if we have enough market hours data for EMA200
          if (marketHoursCandles1m.length >= 200 && marketHoursCandles5m.length >= 50) {
            // Use market hours data
            candles1m = marketHoursCandles1m;
            candles5m = marketHoursCandles5m;
            break;
          } else if (candles1m.length >= 200 && attemptCount === maxAttempts - 1) {
            // Last attempt: use all candles if we have enough
            break;
          } else {
            // Not enough data, try longer period
            daysToFetch = daysToFetch === 10 ? 15 : daysToFetch === 15 ? 20 : 30;
          }
          attemptCount++;
        }
      }
    } catch (error) {
      console.error(`[Extended Hours] Error fetching data for ${ticker}:`, error);
      return null;
    }
    
    if (!candles1m || candles1m.length < 200 || !candles5m || candles5m.length < 50) {
      console.error(`[Extended Hours] Insufficient candles for ${ticker}: 1m=${candles1m?.length || 0}, 5m=${candles5m?.length || 0}`);
      return null;
    }
    
    
    // Log data freshness
    const last1mTime = new Date(candles1m[candles1m.length - 1].timestamp);
    const last5mTime = new Date(candles5m[candles5m.length - 1].timestamp);
    const now = new Date();
    const hoursSinceLast1m = Math.round((now - last1mTime) / (1000 * 60 * 60));
    const hoursSinceLast5m = Math.round((now - last5mTime) / (1000 * 60 * 60));
    
    // Fetch real-time current price from Polygon (includes extended hours)
    let realTimePrice = null;
    try {
      realTimePrice = await polygonService.getCurrentPrice(ticker);
      console.log(`[Price] Fetched real-time price for ${ticker}: ${realTimePrice} (extended hours supported)`);
    } catch (priceError) {
      console.log(`[Price] Could not fetch real-time price for ${ticker}, using alert price: ${currentPrice}`);
      realTimePrice = currentPrice;
    }
    
    // Update last candle close prices with real-time price (most recent value)
    // This ensures indicators are calculated with the most current price
    if (realTimePrice !== null && candles1m.length > 0) {
      const lastCandle1m = candles1m[candles1m.length - 1];
      if (lastCandle1m) {
        lastCandle1m.close = realTimePrice;
        // Also update high if price is higher
        if (realTimePrice > lastCandle1m.high) {
          lastCandle1m.high = realTimePrice;
        }
        // Also update low if price is lower
        if (realTimePrice < lastCandle1m.low) {
          lastCandle1m.low = realTimePrice;
        }
        console.log(`[Price] Updated last 1m candle close for ${ticker} with real-time price: ${realTimePrice}`);
      }
    }
    
    if (realTimePrice !== null && candles5m.length > 0) {
      const lastCandle5m = candles5m[candles5m.length - 1];
      if (lastCandle5m) {
        lastCandle5m.close = realTimePrice;
        // Also update high if price is higher
        if (realTimePrice > lastCandle5m.high) {
          lastCandle5m.high = realTimePrice;
        }
        // Also update low if price is lower
        if (realTimePrice < lastCandle5m.low) {
          lastCandle5m.low = realTimePrice;
        }
        console.log(`[Price] Updated last 5m candle close for ${ticker} with real-time price: ${realTimePrice}`);
      }
    }
    
    // Calculate indicators with extended hours support (now using updated candle data with real-time price)
    const indicatorData = await indicatorsService.calculateAllIndicators(ticker, candles1m, candles5m, isExtendedHours);
    
    // Add current price to indicator data for condition evaluation (use real-time price)
    indicatorData.currentPrice = realTimePrice || currentPrice;
    
    // Evaluate conditions
    const evaluation = conditionsService.evaluateConditions(indicatorData);
    
    // Debug logging for ALL stocks to compare with modal
    console.log(`\n🏢 STOCK API EVALUATION for ${ticker}:`);
    console.log(`  All conditions met: ${evaluation.allConditionsMet}`);
    console.log(`  Failed conditions:`, evaluation.failedConditions.map(fc => fc.name));
    console.log(`  Real-time price used: ${realTimePrice || currentPrice} (includes extended hours)`);
    console.log(`  Indicators:`, {
      macd5mHistogram: indicatorData.indicators.macd5m?.histogram,
      macd5mMacd: indicatorData.indicators.macd5m?.macd,
      macd1mMacd: indicatorData.indicators.macd1m?.macd,
      ema1m18: indicatorData.indicators.ema1m18,
      ema5m18: indicatorData.indicators.ema5m18,
      ema5m200: indicatorData.indicators.ema5m200
    });
    
    // Debug logging for specific stocks
    
    return {
      ticker,
      timestamp,
      price: realTimePrice || currentPrice, // Use real-time price (includes extended hours)
      volume: alert.volume || 0,
      change: alert.change || 0,
      changePercent: alert.changePercent || 0,
      alert,
      indicators: indicatorData.indicators,
      evaluation,
      lastCandle: indicatorData.lastCandle,
      chartswatcherData: {
        open: alert.open || null,
        high: alert.high || null,
        low: alert.low || null,
        close: alert.close || null,
        volume: alert.volume || null,
        change: alert.change || null,
        changePercent: alert.changePercent || null,
        rawColumns: alert.raw_columns || null,
        alertType: alert.alert_type || null,
        color: alert.color || null,
        textColor: alert.text_color || null
      }
    };
    
    } catch (error) {
    console.error(`Error processing alert normally for ${alert.ticker || 'unknown'}:`, error);
    return null;
  }
}

// Helper function to process a single alert
async function processAlert(alert, validateNASDAQ = false) {
  try {
    const ticker = chartsWatcherService.extractTicker(alert);
    const timestamp = chartsWatcherService.extractTimestamp(alert);
    
    // Use price from ChartsWatcher alert (prioritize close, then price field)
    const currentPrice = alert.close || alert.price || null;
    
    
    // Log ChartsWatcher data if available
    if (alert.alert_type === 'websocket_alert') {
      if (alert.volume) console.log(`   Volume: ${alert.volume.toLocaleString()}`);
      if (alert.changePercent) console.log(`   Change: ${alert.changePercent > 0 ? '+' : ''}${alert.changePercent}%`);
      if (alert.high || alert.low) console.log(`   Range: $${alert.low || 'N/A'} - $${alert.high || 'N/A'}`);
    }
    
    // Check if this is a valid example alert - return pre-calculated valid data
    if (alert.alert_type === 'valid_example_alert') {
      const validAlert = createValidExampleAlert(alert);
      return validAlert;
    }
    
    // Check if this is a forced valid alert - process with real data but force as valid
    if (alert.alert_type === 'forced_valid_alert' || alert.alert_type === 'forced_valid_alert_fallback') {
      
      // Process the alert normally to get real indicators
      const result = await processAlertNormally(alert, validateNASDAQ);
      
      if (result) {
        // Force the evaluation to be valid regardless of actual conditions
        result.evaluation = {
          conditions: {
            macd5mPositive: true,
            macd1mPositive: true,
            ema18Above200_1m: true,
            ema18AboveVwap_1m: true,
            vwapAboveEma200_1m: true,
            closeAboveEma18_1m: true,
            ema200AboveEma18_5m: true
          },
          passedConditions: 7,
          totalConditions: 7,
          allConditionsMet: true,
          failedConditions: [],
          score: "7/7"
        };
        
        return result;
      }
    }
    
    // Check if this is a real stock alert - process normally but with real data
    if (alert.alert_type === 'real_stock_alert' || alert.alert_type === 'real_stock_alert_fallback') {
    }
    
    // Process the alert normally (this handles all the regular processing logic)
    return await processAlertNormally(alert, validateNASDAQ);
    
  } catch (error) {
    return null;
  }
}

// API Routes

// Get all alerts (raw data)
app.get('/api/alerts', async (req, res) => {
  try {
    if (!alertsEnabled) {
      return res.json({ success: true, data: [], count: 0, message: 'Alerts disabled' });
    }
    const alerts = await chartsWatcherService.fetchAlerts();
    res.json({
      success: true,
      data: alerts,
      count: alerts.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch alerts from ChartsWatcher API. Please check API credentials and network connection.'
    });
  }
});

// Get processed alerts (valid and filtered)
app.get('/api/alerts/processed', async (req, res) => {
  try {
    if (!alertsEnabled) {
      return res.json({
        success: true,
        data: { valid: [], filtered: [], total: 0, processed: 0, skipped: 0 },
        message: 'Alerts disabled'
      });
    }
    
    // Fetch alerts from ChartsWatcher
    const alerts = await chartsWatcherService.fetchAlerts();
    
    // Create real stock alerts with live market data (only if no real alerts)
    const realStockAlerts = alerts.length > 0 ? [] : await createRealStockAlerts();
    
    // Combine all alerts
    const alertsToProcess = alerts.length > 0 
      ? alerts 
      : realStockAlerts;
    
    if (alertsToProcess.length === 0) {
      return res.json({
        success: true,
        data: {
          valid: [],
          filtered: [],
          total: 0,
          processed: 0,
          skipped: 0
        }
      });
    }
    
    // Process all alerts in parallel (with concurrency limit)
    const BATCH_SIZE = 5; // Process 5 alerts at a time to avoid API rate limits
    const results = [];
    
    for (let i = 0; i < alertsToProcess.length; i += BATCH_SIZE) {
      const batch = alertsToProcess.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(processAlert));
      results.push(...batchResults.filter(result => result !== null));
      
      // Small delay between batches to respect API rate limits
      if (i + BATCH_SIZE < alertsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Separate valid and filtered alerts
    const validAlerts = results.filter(result => result.evaluation.allConditionsMet);
    const filteredAlerts = results.filter(result => !result.evaluation.allConditionsMet);
    
    
    res.json({
      success: true,
      data: {
        valid: validAlerts,
        filtered: filteredAlerts,
        total: results.length,
        processed: results.length,
        skipped: alertsToProcess.length - results.length
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to process alerts. Please check ChartsWatcher API connection and Polygon.io API credentials.'
    });
  }
});

// Get only valid alerts
app.get('/api/alerts/valid', async (req, res) => {
  try {
    const response = await fetch(`http://localhost:${PORT}/api/alerts/processed`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error);
    }
    
    res.json({
      success: true,
      data: data.data.valid,
      count: data.data.valid.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get only filtered alerts
app.get('/api/alerts/filtered', async (req, res) => {
  try {
    const response = await fetch(`http://localhost:${PORT}/api/alerts/processed`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error);
    }
    
    res.json({
      success: true,
      data: data.data.filtered,
      count: data.data.filtered.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const chartsWatcherStatus = chartsWatcherService.getConnectionStatus();
  
  res.json({
    success: true,
    message: 'Trading Alerts API is running',
    timestamp: new Date().toISOString(),
    chartsWatcher: {
      connected: chartsWatcherStatus.isConnected,
      configID: chartsWatcherStatus.configID,
      alertCount: chartsWatcherStatus.alertCount,
      reconnectAttempts: chartsWatcherStatus.reconnectAttempts
    }
  });
});

// ChartsWatcher connection status endpoint
app.get('/api/chartswatcher/status', (req, res) => {
  const status = chartsWatcherService.getConnectionStatus();
  
  res.json({
    success: true,
    data: status
  });
});

// Helper function to recalculate indicators for a symbol
async function recalculateIndicatorsForSymbol(symbol, groupKey) {
  try {
    // Fetch candles using extended hours
    const extendedData1m = await polygonService.fetchExtendedHoursCandles(symbol, 1, true, 7);
    const extendedData5m = await polygonService.fetchExtendedHoursCandles(symbol, 5, true, 7);
    
    if (!extendedData1m?.candles || extendedData5m?.candles || 
        extendedData1m.candles.length === 0 || extendedData5m.candles.length === 0) {
      return null;
    }

    const candles1m = extendedData1m.candles;
    const candles5m = extendedData5m.candles;

    // Calculate indicators using Polygon-compliant logic
    const isExtendedHours = new Date().getHours() >= 4 && new Date().getHours() < 20;
    const indicatorData = await indicatorsService.calculateAllIndicators(symbol, candles1m, candles5m, isExtendedHours);

    return indicatorData;
  } catch (error) {
    console.error(`[Toplist] Error recalculating indicators for ${symbol}:`, error.message);
    return null;
  }
}

// Toplist data endpoint
app.get('/api/toplist', async (req, res) => {
  try {
    const toplistData = await toplistService.fetchToplistData();
    
    // Recalculate indicators for all symbols using Polygon-compliant logic
    const enrichedToplistData = {};
    
    for (const [configId, rows] of Object.entries(toplistData)) {
      enrichedToplistData[configId] = await Promise.all(rows.map(async (row) => {
        const symbol = row.symbol || (Array.isArray(row.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value) : null);
        
        if (!symbol) return row;

        try {
          // Recalculate indicators for this symbol
          const indicatorData = await recalculateIndicatorsForSymbol(symbol, configId);
          
          if (indicatorData && indicatorData.indicators) {
            // Add recalculated indicator values to the row
            const newColumns = [...(row.columns || [])];
            
            // Update MACD 1m values
            if (indicatorData.indicators.macd1m) {
              updateColumn(newColumns, 'MACD1mColumn', indicatorData.indicators.macd1m.macd);
              updateColumn(newColumns, 'MACD1mSignalColumn', indicatorData.indicators.macd1m.signal);
              updateColumn(newColumns, 'MACD1mHistogramColumn', indicatorData.indicators.macd1m.histogram);
            }
            
            // Update MACD 5m values
            if (indicatorData.indicators.macd5m) {
              updateColumn(newColumns, 'MACD5mColumn', indicatorData.indicators.macd5m.macd);
              updateColumn(newColumns, 'MACD5mSignalColumn', indicatorData.indicators.macd5m.signal);
              updateColumn(newColumns, 'MACD5mHistogramColumn', indicatorData.indicators.macd5m.histogram);
            }
            
            // Update EMA values
            if (indicatorData.indicators.ema1m18 !== undefined) updateColumn(newColumns, 'EMA18_1m', indicatorData.indicators.ema1m18);
            if (indicatorData.indicators.ema1m200 !== undefined) updateColumn(newColumns, 'EMA200_1m', indicatorData.indicators.ema1m200);
            if (indicatorData.indicators.ema5m18 !== undefined) updateColumn(newColumns, 'EMA18_5m', indicatorData.indicators.ema5m18);
            if (indicatorData.indicators.ema5m200 !== undefined) updateColumn(newColumns, 'EMA200_5m', indicatorData.indicators.ema5m200);
            
            row.columns = newColumns;
          }
        } catch (error) {
          console.error(`[Toplist] Error enriching ${symbol}:`, error.message);
        }
        
        return row;
      }));
    }
    
    res.json({
      success: true,
      data: enrichedToplistData,
      count: Object.values(enrichedToplistData).reduce((acc, rows) => acc + rows.length, 0)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch toplist data from ChartsWatcher API. Please check API credentials and network connection.'
    });
  }
});

// Helper function to update or add a column
function updateColumn(columns, key, value) {
  if (value === null || value === undefined) return;
  
  const existingIndex = columns.findIndex(c => c.key === key);
  if (existingIndex >= 0) {
    columns[existingIndex].value = value.toFixed(6);
  } else {
    columns.push({ key, value: value.toFixed(6), text_color: '#cccccc', color: '#cccccc' });
  }
}

// Restart toplist WebSocket connection
app.post('/api/toplist/restart', async (req, res) => {
  try {
    const ok = await toplistService.restart();
    res.json({ success: ok, status: toplistService.getConnectionStatus() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Endpoints for float lists and thresholds
app.get('/api/float/validated', (req, res) => {
  res.json({ success: true, data: validatedFloatLists });
});

app.get('/api/float/thresholds', (req, res) => {
  res.json({ success: true, data: floatService.getThresholds() });
});

app.post('/api/float/thresholds', (req, res) => {
  try {
    const { groupKey, values } = req.body || {};
    if (!groupKey || !values) return res.status(400).json({ success: false, error: 'Missing groupKey or values' });
    floatService.setThresholds(groupKey, values);
    const updatedThresholds = floatService.getThresholds();
    // Broadcast updated thresholds to all connected clients
    broadcastToClients({
      type: 'FLOAT_THRESHOLDS',
      data: updatedThresholds,
      timestamp: new Date().toISOString()
    });
    res.json({ success: true, data: updatedThresholds });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Manual Weights Configuration
app.get('/api/manual/weights', (req, res) => {
  res.json({ 
    success: true, 
    data: MANUAL_WEIGHTS,
    source: isDbConnected() ? 'database' : 'memory'
  });
});

app.post('/api/manual/weights', async (req, res) => {
  const { weights } = req.body;
  if (!weights) return res.status(400).json({ success: false, error: 'Missing weights' });

  const sum = Object.values(weights).reduce((a, b) => a + Number(b), 0);
  
  let newWeights = {};
  
  if (sum > 1.1) {
     if (Math.abs(sum - 100) > 0.1) {
       return res.status(400).json({ success: false, error: `Total must be 100% (got ${sum.toFixed(1)}%)` });
     }
     for (const key in weights) {
       newWeights[key] = Number(weights[key]) / 100;
     }
  } else {
     if (Math.abs(sum - 1) > 0.001) {
        return res.status(400).json({ success: false, error: `Total must be 1.0 (got ${sum.toFixed(3)})` });
     }
     for (const key in weights) {
       newWeights[key] = Number(weights[key]);
     }
  }

  MANUAL_WEIGHTS = { ...MANUAL_WEIGHTS, ...newWeights };
  
  broadcastManualUpdate();
  
  const persisted = await persistManualWeights(MANUAL_WEIGHTS);

  res.json({ 
    success: true, 
    data: MANUAL_WEIGHTS,
    persisted,
    warning: persisted ? undefined : 'Database not connected; changes are kept in memory only'
  });
});

// Manual Buy Quantities Configuration endpoints
app.get('/api/manual/buy-quantities', (req, res) => {
  res.json({ 
    success: true, 
    data: MANUAL_BUY_QUANTITIES,
    source: isDbConnected() ? 'database' : 'memory'
  });
});

app.post('/api/manual/buy-quantities', async (req, res) => {
  const { buyQuantities } = req.body;
  if (!buyQuantities || typeof buyQuantities !== 'object') {
    return res.status(400).json({ success: false, error: 'Missing buyQuantities' });
  }

  // Validate and normalize buy quantities
  const newBuyQuantities = {};
  for (const [group, quantity] of Object.entries(buyQuantities)) {
    const num = Number(quantity);
    if (!Number.isNaN(num) && num > 0) {
      newBuyQuantities[group] = Math.round(num);
    }
  }

  if (Object.keys(newBuyQuantities).length === 0) {
    return res.status(400).json({ success: false, error: 'No valid buy quantities provided' });
  }

  MANUAL_BUY_QUANTITIES = { ...MANUAL_BUY_QUANTITIES, ...newBuyQuantities };
  
  const persisted = await persistManualBuyQuantities(MANUAL_BUY_QUANTITIES);

  res.json({ 
    success: true, 
    data: MANUAL_BUY_QUANTITIES,
    persisted,
    warning: persisted ? undefined : 'Database not connected; changes are kept in memory only'
  });
});

// Buy list endpoints
app.get('/api/buys', (req, res) => {
  res.json({ success: true, data: buyList });
});

app.post('/api/buys/reset', (req, res) => {
  buyList.splice(0, buyList.length);
  lastBuyTsByTicker.clear();
  res.json({ success: true, data: [] });
});

// Buy enable/disable endpoints
app.get('/api/buys/enabled', (req, res) => {
  res.json({ success: true, data: { enabled: buysEnabled } });
});

app.post('/api/buys/enabled', (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    const wasEnabled = buysEnabled;
    buysEnabled = enabled;
    res.json({ success: true, data: { enabled: buysEnabled } });
    if (!wasEnabled && buysEnabled) {
      // Fire-and-forget catch-up buys; do not await
      processCatchupBuys();
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// L2 Market Depth endpoints
app.get('/api/l2/status', (req, res) => {
  try {
    const status = l2Service.getStatus();
    res.json({ success: true, data: status });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/l2/connect', async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ success: false, error: 'Symbol is required' });
    }

    const cleanSymbol = symbol.trim().toUpperCase();
    await l2Service.connect(cleanSymbol);
    const status = l2Service.getStatus();
    res.json({ success: true, data: status });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/l2/disconnect', (req, res) => {
  try {
    l2Service.disconnect();
    res.json({ success: true, data: { isConnected: false, symbol: null } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Helper function to send buy order using new LIMIT order logic
// Returns { success: boolean, notifyStatus: string, responseData: any, errorMessage: string | null, quantity: number, limitPrice: number | null }
async function sendBuyOrder(symbol, configId = null, groupKey = null) {
  try {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    if (!normalizedSymbol) {
      return {
        success: false,
        notifyStatus: 'ERROR: Invalid symbol',
        responseData: null,
        errorMessage: 'Invalid symbol',
        quantity: 0,
        limitPrice: null,
        stopLoss: null
      };
    }

    // Prevent duplicate buys when an active position already exists
    const existingPosition = positionsCache.get(normalizedSymbol);
    const existingQty = existingPosition ? parseFloat(existingPosition.Quantity || '0') : 0;
    if (existingQty > 0) {
      console.log(`ℹ️ sendBuyOrder: Skipping ${normalizedSymbol} because an active position exists (${existingQty} shares).`);
      return {
        success: false,
        notifyStatus: 'SKIPPED: Position already active',
        responseData: { message: 'Position already active' },
        errorMessage: null,
        quantity: 0,
        limitPrice: null,
        stopLoss: null
      };
    }

    // Get current stock price using Polygon service
    let currentPrice = null;
    try {
      currentPrice = await polygonService.getCurrentPrice(symbol);
      if (!currentPrice || currentPrice <= 0) {
        console.warn(`⚠️ Could not get valid price for ${symbol}, trying lastClose from analysis...`);
        const analysis = await analyzeSymbol(symbol);
        currentPrice = analysis?.lastClose || null;
      }
    } catch (priceErr) {
      console.error(`Error getting price for ${symbol}:`, priceErr.message);
      try {
        const analysis = await analyzeSymbol(symbol);
        currentPrice = analysis?.lastClose || null;
      } catch (analyzeErr) {
        console.error(`Error analyzing ${symbol} for price:`, analyzeErr.message);
      }
    }
    
    if (!currentPrice || currentPrice <= 0) {
      return {
        success: false,
        notifyStatus: 'ERROR: Could not determine current price',
        responseData: null,
        errorMessage: `Could not determine current price for ${symbol}`,
        quantity: 0,
        limitPrice: null
      };
    }
    
    // Calculate quantity based on price ranges (using configured buy quantities)
    const priceGroup = getPriceGroup(currentPrice);
    if (!priceGroup) {
      // Price outside supported range - skip buy
      console.warn(`⚠️ Skipping buy for ${symbol}: price ${currentPrice} is outside supported range (0-30)`);
      return {
        success: false,
        notifyStatus: `ERROR: Price ${currentPrice} outside supported range (0-30)`,
        responseData: null,
        errorMessage: `Price ${currentPrice} is outside supported range (0-30). Only prices between 0-30 are supported.`,
        quantity: 0,
        limitPrice: currentPrice
      };
    }
    
    // Get quantity from configured buy quantities, or use default
    let quantity = MANUAL_BUY_QUANTITIES[priceGroup];
    if (!quantity || quantity <= 0) {
      // Fallback to defaults if not configured
      const defaults = {
        '0-5': 2002,
        '5-10': 1001,
        '10-12': 757,
        '12-20': 500,
        '20-30': 333
      };
      quantity = defaults[priceGroup] || 500;
    }
    
    // Build order body according to Sections Bot API documentation
    const orderBody = {
      symbol: symbol,
      side: 'BUY',
      order_type: 'Limit',
      quantity: quantity,
      limit_price: currentPrice
    };
    
    console.log(`📤 Sending autobuy order: ${quantity} ${symbol} at LIMIT price ${currentPrice}`);
    
    // Send buy order to external service using POST /order
    let notifyStatus = '';
    let responseData = null;
    let errorMessage = null;
    
    try {
      const resp = await fetch('https://sections-bot.inbitme.com/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(orderBody)
      });
      
      notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
      
      // Try to get response body
      let responseText = '';
      try {
        responseText = await resp.text();
        if (responseText) {
          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = responseText;
          }
        }
      } catch (textErr) {
        console.error(`⚠️ Could not read response body:`, textErr.message);
      }
      
      if (resp.ok) {
        console.log(`✅ Autobuy order sent for ${symbol}: ${notifyStatus}`, responseData ? `Response: ${JSON.stringify(responseData)}` : '');
      } else {
        errorMessage = extractErrorMessage(responseData, responseText, resp.status, resp.statusText);
        console.error(`❌ Error in autobuy for ${symbol}:`, {
          status: notifyStatus,
          response: responseData,
          body: responseText,
          extractedError: errorMessage
        });
      }
    } catch (err) {
      notifyStatus = `ERROR: ${err.message}`;
      errorMessage = err.message;
      console.error(`❌ Network/Parse error in autobuy for ${symbol}:`, {
        message: err.message,
        stack: err.stack
      });
    }
    
    const isSuccess = notifyStatus.startsWith('200') || notifyStatus.startsWith('201');
    
    // Stop-loss orders are now handled by StopLimitService automatically
    let stopLossResult = null;
    
    return {
      success: isSuccess,
      notifyStatus,
      responseData,
      errorMessage: !isSuccess ? errorMessage : null,
      quantity,
      limitPrice: currentPrice,
      stopLoss: stopLossResult
    };
  } catch (e) {
    console.error(`❌ Error in sendBuyOrder for ${symbol}:`, e);
    return {
      success: false,
      notifyStatus: `ERROR: ${e.message}`,
      responseData: null,
      errorMessage: e.message,
      quantity: 0,
      limitPrice: null,
      stopLoss: null
    };
  }
}

// Stop-loss orders are now handled by StopLimitService automatically - no queue needed

// Helper function to extract meaningful error messages from API responses
// Handles HTML error pages (like Cloudflare) and JSON error responses
function extractErrorMessage(responseData, responseText, statusCode, statusText) {
  // If responseData is an object, try to extract error message
  if (responseData && typeof responseData === 'object') {
    return responseData.message || responseData.error || responseData.detail || JSON.stringify(responseData);
  }
  
  // If responseData is a string, check if it's HTML
  if (responseData && typeof responseData === 'string') {
    const trimmed = responseData.trim();
    
    // Check if it's HTML (starts with <!DOCTYPE or <html)
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.toLowerCase().includes('<html')) {
      // Try to extract error information from HTML
      // Look for common error page patterns
      const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) {
        const title = titleMatch[1].trim();
        // Extract error code if present (e.g., "500: Internal server error")
        const errorMatch = title.match(/(\d{3}):\s*(.+)/i);
        if (errorMatch) {
          return `API Error ${errorMatch[1]}: ${errorMatch[2]}`;
        }
        // If title contains error info, use it
        if (title.toLowerCase().includes('error')) {
          return `API Error: ${title}`;
        }
      }
      
      // Look for error messages in common HTML error page structures
      const h1Match = trimmed.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (h1Match) {
        const h1 = h1Match[1].trim();
        if (h1.toLowerCase().includes('error') || h1.toLowerCase().includes('server')) {
          return `API Error: ${h1}`;
        }
      }
      
      // Fallback: return generic error with status code
      return `API returned HTML error page (HTTP ${statusCode} ${statusText || ''})`;
    }
    
    // Not HTML, return as-is (might be plain text error)
    return trimmed;
  }
  
  // Fallback to status code
  return `HTTP ${statusCode} ${statusText || ''}`;
}

const ACTIVE_ORDER_STATUS_SET = new Set(['ACK', 'DON', 'REC', 'QUE', 'QUEUED']);
function isActiveOrderStatus(status) {
  return ACTIVE_ORDER_STATUS_SET.has((status || '').toUpperCase());
}

// Track last time we received an order update from websocket
let lastOrderUpdateTime = null;

// Maintain WebSocket connection to positions to keep cache updated
let positionsWs = null;
let positionsWsReconnectTimer = null;
let lastPositionsError = null;

// Maintain WebSocket connection to orders to keep cache updated
let ordersWs = null;
let ordersWsReconnectTimer = null;
let lastOrdersConnectAttempt = 0;
let ordersReconnectAttempts = 0;
let lastOrdersError = null;

function connectPositionsWebSocket() {
  const apiKey = process.env.PNL_API_KEY;
  const wsBaseUrl = process.env.PNL_WS_BASE_URL || 'wss://sections-bot.inbitme.com';
  
  if (!apiKey) {
    console.warn('⚠️ PNL_API_KEY not configured, cannot connect to positions WebSocket');
    return;
  }
  
  lastPositionsConnectAttempt = Date.now();

  // Close existing connection if any
  if (positionsWs) {
    try {
      positionsWs.close();
    } catch (e) {}
    positionsWs = null;
  }
  
  const wsUrl = `${wsBaseUrl}/ws/positions?api_key=${encodeURIComponent(apiKey)}`;
  console.log('🔌 Connecting to positions WebSocket for stop-loss monitoring...');
  
  try {
    positionsWs = new WebSocket(wsUrl);
    
    positionsWs.on('open', () => {
      console.log('✅ Positions WebSocket connected for stop-loss monitoring');
       lastPositionUpdateTime = Date.now();
       positionsReconnectAttempts = 0;
       lastPositionsError = null;
      // Clear reconnect timer on successful connection
      if (positionsWsReconnectTimer) {
        clearTimeout(positionsWsReconnectTimer);
        positionsWsReconnectTimer = null;
      }
    });
    
    positionsWs.on('message', (data) => {
      try {
        const messageStr = Buffer.isBuffer(data) ? data.toString('utf8') : data.toString();
        const dataObj = JSON.parse(messageStr);
        
        lastPositionUpdateTime = Date.now();

        // Skip heartbeat messages
        if (dataObj.Heartbeat) {
          return;
        }
        
        // Handle position updates
        if (dataObj.PositionID && dataObj.Symbol) {
          const symbol = dataObj.Symbol.toUpperCase();
          const quantity = parseFloat(dataObj.Quantity || '0');
          
          if (quantity > 0) {
            // Update cache with position
            positionsCache.set(symbol, {
              ...dataObj,
              Symbol: symbol,
              lastUpdated: Date.now()
            });
            // Schedule save to database
            if (cachePersistenceService) {
              cachePersistenceService.schedulePositionSave(symbol);
            }
            console.log(`📊 Position cache updated: ${symbol} (${quantity} shares)`);
            // Debug: Log if this is a new position after a sell (for buy-sell-buy scenario)
            console.log(`🔍 [DEBUG] Position exists in cache for ${symbol}: Quantity=${quantity}, AveragePrice=${dataObj.AveragePrice || 'N/A'}`);
            
            // CRITICAL: If position exists, remove from recently sold tracking
            // This allows StopLimit creation for legitimate rebuys
            const normalizedSymbol = symbol.toUpperCase();
            if (recentlySoldSymbols.has(normalizedSymbol)) {
              console.log(`✅ [DEBUG] Position exists for ${normalizedSymbol} - removing from recently sold tracking (rebuy detected)`);
              recentlySoldSymbols.delete(normalizedSymbol);
            }
            
            // Check StopLimit tracker for P&L-based updates
            // CRITICAL: StopLimit tracker is DISABLED
            if (STOPLIMIT_ENABLED) {
              checkStopLimitTracker(normalizedSymbol, dataObj);
            }
          }
        } else {
          // Position closed or quantity is 0, remove from cache
          const normalizedSymbol = symbol.toUpperCase(); // Normalize for StopLimit cleanup
          console.log(`📊 Position closed or quantity is 0: ${symbol} - removing from cache`);
          positionsCache.delete(symbol);
          // Schedule save to database (to delete from DB)
          if (cachePersistenceService) {
            cachePersistenceService.schedulePositionSave(symbol);
          }
          if (typeof lastBuyTsByTicker !== 'undefined' && lastBuyTsByTicker.has(symbol)) {
            lastBuyTsByTicker.delete(symbol);
            console.log(`🔁 Reset buy lock for ${symbol} (position closed)`);
          }
          
          // CRITICAL: Clean up StopLimit tracking when position is closed (clean repository pattern)
          const repoEntry = stopLimitOrderRepository.get(normalizedSymbol);
          if (repoEntry) {
            console.log(`🧹 [STOPLIMIT_REPO] Position closed for ${normalizedSymbol} - removing StopLimit order ${repoEntry.orderId}`);
            stopLimitOrderRepository.delete(normalizedSymbol);
          }
          
          // Clean up in-progress creation flag
          stopLimitCreationBySymbol.delete(normalizedSymbol);
        console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (after creation)`);
          
          // CRITICAL: Mark symbol as recently sold to prevent StopLimit creation loops
          recentlySoldSymbols.set(normalizedSymbol, Date.now());
          console.log(`🏷️ [DEBUG] Marked ${normalizedSymbol} as recently sold (timestamp: ${Date.now()})`);
          
          // Clean up StopLimit tracker progress
          stopLimitTrackerProgress.delete(normalizedSymbol);
          
          // Clean up filled StopLimit tracking (position closed, can create new StopLimit if rebought)
          stopLimitFilledSymbols.delete(normalizedSymbol);
          
          console.log(`📊 Position removed from cache: ${symbol}`);
        }
        
      } catch (err) {
        console.error('⚠️ Error parsing positions WebSocket message:', err.message);
      }
    });
    
    positionsWs.on('error', (error) => {
      console.error('❌ Positions WebSocket error:', error.message);
      lastPositionUpdateTime = null;
      lastPositionsError = error?.message || 'Unknown error';
    });
    
    positionsWs.on('close', (code, reason) => {
      console.log(`🔌 Positions WebSocket closed (${code}): ${reason || 'No reason'}`);
      positionsWs = null;
      lastPositionUpdateTime = null;
      if (reason) {
        lastPositionsError = reason.toString();
      }
      
      // Reconnect after delay (exponential backoff, max 30 seconds)
      positionsReconnectAttempts = Math.min(positionsReconnectAttempts + 1, 6);
      const delay = Math.min(30000, 1000 * Math.pow(2, Math.max(0, positionsReconnectAttempts - 1)));
      positionsWsReconnectTimer = setTimeout(() => {
        console.log('🔄 Reconnecting positions WebSocket...');
        connectPositionsWebSocket();
      }, delay);
    });
    
  } catch (err) {
    console.error('❌ Failed to create positions WebSocket:', err.message);
    positionsWs = null;
    lastPositionUpdateTime = null;
    positionsReconnectAttempts = Math.min(positionsReconnectAttempts + 1, 6);
    // Retry after delay
    const delay = Math.min(30000, 1000 * Math.pow(2, Math.max(0, positionsReconnectAttempts - 1)));
    positionsWsReconnectTimer = setTimeout(() => {
      console.log('🔄 Retrying positions WebSocket connection after error...');
      connectPositionsWebSocket();
    }, delay);
  }
}

// Connect to orders WebSocket to cache orders
function connectOrdersWebSocket() {
  const apiKey = process.env.PNL_API_KEY;
  const wsBaseUrl = process.env.PNL_WS_BASE_URL || 'wss://sections-bot.inbitme.com';
  
  if (!apiKey) {
    console.warn('⚠️ PNL_API_KEY not configured, cannot connect to orders WebSocket');
    return;
  }
  
  // Close existing connection if any
  if (ordersWs) {
    try {
      ordersWs.close();
    } catch (e) {}
    ordersWs = null;
  }
  
  lastOrdersConnectAttempt = Date.now();
  const wsUrl = `${wsBaseUrl}/ws/orders?api_key=${encodeURIComponent(apiKey)}`;
  console.log('🔌 Connecting to orders WebSocket for orders cache...');
  
  try {
    ordersWs = new WebSocket(wsUrl);
    
    ordersWs.on('open', () => {
      console.log('✅ Orders WebSocket connected for orders cache');
      ordersReconnectAttempts = 0;
      lastOrdersError = null;
      // Clear reconnect timer on successful connection
      if (ordersWsReconnectTimer) {
        clearTimeout(ordersWsReconnectTimer);
        ordersWsReconnectTimer = null;
      }
    });
    
    ordersWs.on('message', async (data) => {
      try {
        const messageStr = Buffer.isBuffer(data) ? data.toString('utf8') : data.toString();
        const dataObj = JSON.parse(messageStr);
        
        // Skip heartbeat messages and stream status
        if (dataObj.Heartbeat || dataObj.StreamStatus) {
          return;
        }
        
        // Handle order updates
        if (dataObj.OrderID) {
          const order = dataObj;
          const orderId = order.OrderID;
          const status = (order.Status || '').toUpperCase();
          const isFilled = (status === 'FLL' || status === 'FIL');
          const isBuy = (order.Legs?.[0]?.BuyOrSell || '').toUpperCase() === 'BUY';
          const pending = pendingManualBuyOrders.get(orderId);
          const symbol = order.Legs?.[0]?.Symbol || 'UNKNOWN';

          // Debug logging for tracked orders
          if (pending) {
            console.log(`🔍 [DEBUG] Order update for TRACKED manual buy: ${orderId} (${symbol}, Status: ${status})`);
            console.log(`🔍 [DEBUG] Order details:`, JSON.stringify({
              OrderID: order.OrderID,
              Status: order.Status,
              OrderType: order.OrderType,
              Symbol: symbol,
              Legs: order.Legs?.map(l => ({
                Symbol: l.Symbol,
                BuyOrSell: l.BuyOrSell,
                QuantityOrdered: l.QuantityOrdered,
                QuantityRemaining: l.QuantityRemaining,
                ExecQuantity: l.ExecQuantity,
                FilledPrice: order.FilledPrice
              }))
            }, null, 2));
            console.log(`🔍 [DEBUG] Pending data:`, JSON.stringify(pending, null, 2));
            console.log(`🔍 [DEBUG] isFilled=${isFilled}, isBuy=${isBuy}, willTriggerStopLimit=${isFilled && isBuy && pending}`);
          }

          // Update last order update time to track websocket activity
          lastOrderUpdateTime = Date.now();

          // Update cache with order
          ordersCache.set(orderId, {
            ...order,
            lastUpdated: Date.now()
          });
          // Schedule save to database
          if (cachePersistenceService) {
            cachePersistenceService.scheduleOrderSave(orderId);
          }

          // CRITICAL: Register StopLimit orders in repository when they arrive via WebSocket
          // This ensures the repository is the single source of truth for active StopLimit orders
          // This must happen BEFORE handleManualBuyFilled checks, so it can see existing orders
          const orderType = (order.OrderType || '').toUpperCase();
          const legSide = (order.Legs?.[0]?.BuyOrSell || '').toUpperCase();
          if ((orderType === 'STOPLIMIT' || orderType === 'STOP_LIMIT') && legSide === 'SELL') {
            // CRITICAL: StopLimit logic is DISABLED - log but don't register
            if (!STOPLIMIT_ENABLED) {
              console.log(`⏸️ [STOPLIMIT] StopLimit order ${orderId} received via WebSocket but logic is DISABLED - ignoring registration for ${symbol}`);
              // Still process the order normally (it exists), just don't register in repository
            } else {
              registerStopLimitOrder(order);
            }
            
            // CRITICAL: Guard removal is now handled in registerStopLimitOrder with delay
            // This prevents race conditions where handleManualBuyFilled is still running
            // when the guard is cleared
            
            // CRITICAL: If StopLimit was REJECTED with "remaining on sell orders" message,
            // it means there's already an active stop-loss order. Find and register it.
            if (status === 'REJ' || status === 'REJECTED') {
              const stopLimitSymbol = (symbol || '').toUpperCase();
              const rejectReason = (order.RejectReason || '').toLowerCase();
              if (rejectReason.includes('remaining on sell orders') || rejectReason.includes('remaining on sell')) {
                console.log(`⚠️ [DEBUG] StopLimit ${orderId} rejected for ${stopLimitSymbol} - searching for existing active stop-loss order...`);
                
                // Search for existing active stop-loss orders in cache
                const existingStopLimit = findExistingStopLimitSellForSymbol(stopLimitSymbol);
                if (existingStopLimit) {
                  console.log(`✅ [DEBUG] Found existing active StopLimit ${existingStopLimit.orderId} for ${stopLimitSymbol} - already registered`);
                  // Remove from creation guard since we found the existing order
                  if (stopLimitCreationBySymbol.has(stopLimitSymbol)) {
                    stopLimitCreationBySymbol.delete(stopLimitSymbol);
                    console.log(`🔓 [DEBUG] Removed ${stopLimitSymbol} from stopLimitCreationBySymbol guard (found existing order)`);
                  }
                } else {
                  // Search cache directly for any active stop-loss orders
                  let foundActiveOrder = null;
                  for (const [cachedOrderId, cachedOrder] of ordersCache.entries()) {
                    const cachedLeg = cachedOrder.Legs?.[0];
                    const cachedSymbol = (cachedLeg?.Symbol || '').toUpperCase();
                    const cachedSide = (cachedLeg?.BuyOrSell || '').toUpperCase();
                    const cachedType = (cachedOrder.OrderType || '').toUpperCase();
                    const cachedStatus = (cachedOrder.Status || '').toUpperCase();
                    
                    if (cachedSymbol === stopLimitSymbol && 
                        cachedSide === 'SELL' && 
                        (cachedType === 'STOPLIMIT' || cachedType === 'STOP_LIMIT') &&
                        (cachedStatus === 'ACK' || cachedStatus === 'DON' || cachedStatus === 'REC')) {
                      foundActiveOrder = cachedOrder;
                      console.log(`✅ [DEBUG] Found active StopLimit ${cachedOrderId} in cache for ${stopLimitSymbol} - registering in repository`);
                      registerStopLimitOrder(cachedOrder);
                      // Remove from creation guard
                      if (stopLimitCreationBySymbol.has(stopLimitSymbol)) {
                        stopLimitCreationBySymbol.delete(stopLimitSymbol);
                        console.log(`🔓 [DEBUG] Removed ${stopLimitSymbol} from stopLimitCreationBySymbol guard (registered existing order)`);
                      }
                      break;
                    }
                  }
                  
                  if (!foundActiveOrder) {
                    console.warn(`⚠️ [DEBUG] Could not find existing active StopLimit for ${stopLimitSymbol} despite rejection message`);
                  }
                }
              }
            }
          }

          // When a tracked manual BUY reaches FLL/FIL: create or modify StopLimit SELL
          // CRITICAL: Only process if it's a BUY order AND it's in pendingManualBuyOrders
          // This ensures we only process orders we're tracking, not random FLL messages
          if (isFilled && isBuy && pending) {
            // CRITICAL: Validate this is actually a tracked buy order
            // Check that pending data matches the order
            const pendingSymbol = (pending.symbol || '').toString().toUpperCase();
            const orderSymbol = (symbol || '').toUpperCase();
            
            if (pendingSymbol !== orderSymbol) {
              console.warn(`⚠️ [DEBUG] Symbol mismatch: pending=${pendingSymbol}, order=${orderSymbol} for order ${orderId}. Skipping.`);
              pendingManualBuyOrders.delete(orderId);
              return;
            }
            
            // CRITICAL: Check if this order was already processed (prevent duplicate processing)
            // This handles cases where WebSocket sends multiple FLL messages for the same order
            if (processedFllOrders.has(orderId)) {
              console.log(`⏭️ [DEBUG] Order ${orderId} (${symbol}) already processed for FLL - skipping duplicate WebSocket message`);
              // Still remove from pending to clean up
              pendingManualBuyOrders.delete(orderId);
              return; // Don't process again
            }
            
            const normalizedSymbol = (symbol || '').toUpperCase();
            
            // CRITICAL: Check if StopLimit already exists BEFORE marking as processed
            // Check BOTH repository AND database to prevent creating duplicate StopLimit orders
            const existingStopLimit = getActiveStopLimitOrder(normalizedSymbol);
            if (existingStopLimit) {
              console.log(`✅ [DEBUG] StopLimit already exists for ${normalizedSymbol} (${existingStopLimit.orderId}). Skipping creation.`);
              // Mark as processed to prevent retry
              processedFllOrders.add(orderId);
              pendingManualBuyOrders.delete(orderId);
              // Update quantity if needed
              const position = positionsCache.get(normalizedSymbol);
              const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
              if (positionQty > 0) {
                modifyOrderQuantity(existingStopLimit.orderId, positionQty).catch(err => {
                  console.error(`❌ [DEBUG] Error updating StopLimit quantity:`, err);
                });
              }
              return; // Don't process - StopLimit already exists
            }
            
            // CRITICAL: Also check database directly (authoritative source of truth)
            // This catches cases where repository might be empty but database has the order
            if (cachePersistenceService) {
              const dbCheck = await cachePersistenceService.checkDatabaseForActiveStopLimit(normalizedSymbol);
              if (dbCheck) {
                console.log(`✅ [DEBUG] Database check found active StopLimit ${dbCheck.orderId} for ${normalizedSymbol} (status: ${dbCheck.status}). Skipping creation.`);
                
                // Register in repository if not already there
                if (!stopLimitOrderRepository.has(normalizedSymbol)) {
                  stopLimitOrderRepository.set(normalizedSymbol, {
                    orderId: dbCheck.orderId,
                    order: dbCheck.order,
                    openedDateTime: dbCheck.openedDateTime,
                    status: dbCheck.status
                  });
                  console.log(`✅ [STOPLIMIT_REPO] Registered StopLimit ${dbCheck.orderId} from database for ${normalizedSymbol}`);
                }
                
                // Mark as processed to prevent retry
                processedFllOrders.add(orderId);
                pendingManualBuyOrders.delete(orderId);
                // Update quantity if needed
                const position = positionsCache.get(normalizedSymbol);
                const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
                if (positionQty > 0) {
                  modifyOrderQuantity(dbCheck.orderId, positionQty).catch(err => {
                    console.error(`❌ [DEBUG] Error updating StopLimit quantity:`, err);
                  });
                }
                return; // Don't process - StopLimit already exists in database
              }
            }
            
            // CRITICAL: Mark as processed IMMEDIATELY to prevent duplicate processing
            // Do this BEFORE any async operations
            processedFllOrders.add(orderId);
            console.log(`✅ [DEBUG] Marked order ${orderId} (${symbol}) as processed for FLL`);
            
            // CRITICAL: Remove from pendingManualBuyOrders FIRST to prevent duplicate processing
            // This ensures that even if WebSocket sends multiple FLL updates, we only process once
            pendingManualBuyOrders.delete(orderId);
            console.log(`✅ [DEBUG] Removed ${orderId} from pendingManualBuyOrders. Remaining: ${pendingManualBuyOrders.size}`);
            
            // CRITICAL: Check if StopLimit was already filled for this symbol - prevent creating new one
            const filledStopLimit = stopLimitFilledSymbols.get(normalizedSymbol);
            if (filledStopLimit) {
              console.warn(`⚠️ [DEBUG] Symbol ${normalizedSymbol} had StopLimit filled previously (order ${filledStopLimit.orderId}). Skipping StopLimit creation to prevent loops.`);
              
              // Check if position still exists - if not, remove from filled tracking
              const position = positionsCache.get(normalizedSymbol);
              if (!position || parseFloat(position.Quantity || '0') <= 0) {
                stopLimitFilledSymbols.delete(normalizedSymbol);
                console.log(`🧹 [DEBUG] Position closed for ${normalizedSymbol} - removed from filled StopLimit tracking`);
              }
              
              return; // Don't call handleManualBuyFilled if StopLimit was already filled
            }
            
            // CRITICAL: Check repository FIRST before processing to prevent duplicate creation
            // If a StopLimit already exists in repository, just update quantity instead of creating new one
            const existingRepoOrder = getActiveStopLimitOrder(normalizedSymbol);
            if (existingRepoOrder) {
              console.log(`✅ [DEBUG] StopLimit already exists in repository for ${normalizedSymbol} (${existingRepoOrder.orderId}). Updating quantity instead of creating new one.`);
              
              // Update quantity to match position
              const position = positionsCache.get(normalizedSymbol);
              const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
              if (positionQty > 0) {
                modifyOrderQuantity(existingRepoOrder.orderId, positionQty).catch(err => {
                  console.error(`❌ [DEBUG] Error updating StopLimit quantity for ${normalizedSymbol}:`, err);
                });
              }
              return; // Don't call handleManualBuyFilled if order already exists
            }
            
            // CRITICAL: StopLimit logic is DISABLED - skip creation
            if (!STOPLIMIT_ENABLED) {
              console.log(`⏸️ [STOPLIMIT] StopLimit creation is DISABLED - skipping for order ${orderId} (${symbol})`);
              // Still mark as processed to prevent retry
              processedFllOrders.add(orderId);
              pendingManualBuyOrders.delete(orderId);
              return;
            }
            
            console.log(`🚀 [DEBUG] Triggering StopLimit creation/modification for filled manual buy ${orderId} (${symbol})`);
            
            // Don't remove from cache yet - let handleManualBuyFilled complete first
            // The order will be removed from cache after this block if status is terminal
            // Only call if not already in progress (prevent duplicate calls)
            if (!stopLimitCreationInProgress.has(orderId)) {
              handleManualBuyFilled(orderId, order, pending).catch(err => {
                console.error(`❌ [DEBUG] Error in handleManualBuyFilled for ${orderId}:`, err);
                console.error(`❌ [DEBUG] Stack:`, err.stack);
                // On error, remove from processed set so it can be retried if needed
                processedFllOrders.delete(orderId);
              });
            } else {
              console.log(`⏸️ [DEBUG] StopLimit creation already in progress for ${orderId}, skipping WebSocket trigger`);
            }
          }

          // Log order updates for debugging (only for active orders)
          if (isActiveOrderStatus(order.Status)) {
            console.log(`📋 Order cache updated: ${orderId} (${symbol}, Status: ${order.Status})`);
          }

          // Remove order from cache if it's cancelled or filled (status indicates completion)
          // NOTE: For FLL/FIL orders, we keep it in cache briefly so handleManualBuyFilled can find existing StopLimits
          // The order will be cleaned up on next status update or after a delay
          // CRITICAL: Only remove filled orders if they're NOT tracked manual buys (already processed)
          // Tracked manual buys are removed from pendingManualBuyOrders when FLL is detected, so pending will be null
          if (status === 'CAN' || status === 'EXP') {
            ordersCache.delete(orderId);
            if (cachePersistenceService) {
              cachePersistenceService.scheduleOrderSave(orderId);
            }
            console.log(`📋 Order removed from cache: ${orderId} (Status: ${order.Status})`);
          } else if ((status === 'FIL' || status === 'FLL') && !pending) {
            // Only remove filled orders from cache if they're not tracked manual buys
            // If pending is null, it means we already processed this order (removed from pendingManualBuyOrders)
            // Wait a bit before removing to ensure handleManualBuyFilled has time to complete
            setTimeout(() => {
              if (ordersCache.has(orderId)) {
                ordersCache.delete(orderId);
                if (cachePersistenceService) {
                  cachePersistenceService.scheduleOrderSave(orderId);
                }
                console.log(`📋 Order removed from cache after delay: ${orderId} (Status: ${order.Status})`);
              }
            }, 5000); // 5 second delay to allow StopLimit creation to complete
          }
        }
      } catch (err) {
        console.error('⚠️ Error parsing orders WebSocket message:', err.message);
      }
    });
    
    ordersWs.on('error', (error) => {
      console.error('❌ Orders WebSocket error:', error.message);
      lastOrdersError = error?.message || 'Unknown error';
    });
    
    ordersWs.on('close', (code, reason) => {
      console.log(`🔌 Orders WebSocket closed (${code}): ${reason || 'No reason'}`);
      ordersWs = null;
      if (reason) {
        lastOrdersError = reason.toString();
      }
      
      // Reconnect after delay (exponential backoff, max 30 seconds)
      ordersReconnectAttempts = Math.min(ordersReconnectAttempts + 1, 6);
      const delay = Math.min(30000, 1000 * Math.pow(2, Math.max(0, ordersReconnectAttempts - 1)));
      ordersWsReconnectTimer = setTimeout(() => {
        console.log('🔄 Reconnecting orders WebSocket...');
        connectOrdersWebSocket();
      }, delay);
    });
    
  } catch (err) {
    console.error('❌ Failed to create orders WebSocket:', err.message);
    ordersWs = null;
    lastOrdersError = err?.message || 'Failed to connect';
    ordersReconnectAttempts = Math.min(ordersReconnectAttempts + 1, 6);
    // Retry after delay
    ordersWsReconnectTimer = setTimeout(() => {
      connectOrdersWebSocket();
    }, Math.min(30000, 1000 * Math.pow(2, Math.max(0, ordersReconnectAttempts - 1))));
  }
}

function describeReadyState(state) {
  switch (state) {
    case WebSocket.CONNECTING:
      return 'CONNECTING';
    case WebSocket.OPEN:
      return 'OPEN';
    case WebSocket.CLOSING:
      return 'CLOSING';
    case WebSocket.CLOSED:
      return 'CLOSED';
    default:
      return 'UNKNOWN';
  }
}

// Initialize positions WebSocket connection
if (process.env.PNL_API_KEY) {
  connectPositionsWebSocket();
  connectOrdersWebSocket();
} else {
  console.warn('⚠️ PNL_API_KEY not set, positions and orders monitoring disabled');
}

// Check if a position exists for a symbol using the cache
function checkPositionExists(symbol) {
  const normalizedSymbol = symbol.toUpperCase();
  const position = positionsCache.get(normalizedSymbol);
  
  if (position) {
    // Check if position has quantity (position exists)
    const quantity = parseFloat(position.Quantity || '0');
    return quantity > 0;
  }
  
  return false;
}

// Stop-loss orders are now handled automatically by StopLimitService when positions are detected

// Test external buy webhook endpoint (no buy list mutation)
app.post('/api/buys/test', async (req, res) => {
  try {
    const symbol = (req.body?.symbol || '').toString().trim().toUpperCase();
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Missing symbol' });
    }
    
    console.log(`🛒 Manual buy signal for ${symbol}`);
    
    // Get current stock price using Polygon service
    let currentPrice = null;
    try {
      currentPrice = await polygonService.getCurrentPrice(symbol);
      if (!currentPrice || currentPrice <= 0) {
        console.warn(`⚠️ Could not get valid price for ${symbol}, trying lastClose from analysis...`);
        // Fallback to lastClose from analysis
        const analysis = await analyzeSymbol(symbol);
        currentPrice = analysis?.lastClose || null;
      }
    } catch (priceErr) {
      console.error(`Error getting price for ${symbol}:`, priceErr.message);
      // Fallback to lastClose from analysis
      try {
        const analysis = await analyzeSymbol(symbol);
        currentPrice = analysis?.lastClose || null;
      } catch (analyzeErr) {
        console.error(`Error analyzing ${symbol} for price:`, analyzeErr.message);
      }
    }
    
    if (!currentPrice || currentPrice <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Could not determine current price for ${symbol}. Please try again.` 
      });
    }
    
    // Calculate quantity based on price ranges (using configured buy quantities)
    const priceGroup = getPriceGroup(currentPrice);
    if (!priceGroup) {
      // Price outside supported range - skip buy
      return res.status(400).json({ 
        success: false, 
        error: `Price ${currentPrice} is outside supported range (0-30). Only prices between 0-30 are supported.` 
      });
    }
    
    // Get quantity from configured buy quantities, or use default
    let quantity = MANUAL_BUY_QUANTITIES[priceGroup];
    if (!quantity || quantity <= 0) {
      // Fallback to defaults if not configured
      const defaults = {
        '0-5': 2002,
        '5-10': 1001,
        '10-12': 757,
        '12-20': 500,
        '20-30': 333
      };
      quantity = defaults[priceGroup] || 500;
    }
    
    // Build order body according to Sections Bot API documentation
    // https://inbitme.gitbook.io/sections-bot/xKy06Pb8j01LsqEnmSik/rest-api/ordenes
    const orderBody = {
      symbol: symbol,
      side: 'BUY',
      order_type: 'Limit', // Default to Limit as requested
      quantity: quantity,
      limit_price: currentPrice
    };
    
    console.log(`📤 Sending buy order: ${quantity} ${symbol} at LIMIT price ${currentPrice}`);
    
    // Send buy order to external service using POST /order
    let notifyStatus = '';
    let responseData = null;
    let errorMessage = null;
    
    try {
      const resp = await fetch('https://sections-bot.inbitme.com/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(orderBody)
      });
      
      notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
      
      // Try to get response body
      let responseText = '';
      try {
        responseText = await resp.text();
        if (responseText) {
          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = responseText;
          }
        }
      } catch (textErr) {
        console.error(`⚠️ Could not read response body:`, textErr.message);
      }
      
      if (resp.ok) {
        console.log(`✅ Buy order sent for ${symbol}: ${notifyStatus}`, responseData ? `Response: ${JSON.stringify(responseData)}` : '');
      } else {
        errorMessage = extractErrorMessage(responseData, responseText, resp.status, resp.statusText);
        console.error(`❌ Error buying ${symbol}:`, {
          status: notifyStatus,
          response: responseData,
          body: responseText,
          extractedError: errorMessage
        });
      }
    } catch (err) {
      notifyStatus = `ERROR: ${err.message}`;
      errorMessage = err.message;
      console.error(`❌ Network/Parse error buying ${symbol}:`, {
        message: err.message,
        stack: err.stack
      });
    }

    // If Sections Bot returned an order id, track it for status (ACK/DON/FLL/REJ) and FLL→StopLimit logic
    let orderIdFromApi = null;
    if (responseData && typeof responseData === 'object') {
      orderIdFromApi = responseData.order_id ?? responseData.OrderID ?? responseData.orderId ?? null;
      if (orderIdFromApi != null && (notifyStatus.startsWith('200') || notifyStatus.startsWith('201'))) {
        const oid = String(orderIdFromApi);
        pendingManualBuyOrders.set(oid, { symbol, quantity, limitPrice: currentPrice });
        console.log(`📌 [DEBUG] Tracking manual buy order ${oid} for ${symbol} (qty ${quantity}, limitPrice ${currentPrice})`);
        console.log(`📌 [DEBUG] Full response data:`, JSON.stringify(responseData, null, 2));
        console.log(`📌 [DEBUG] Total tracked manual buys: ${pendingManualBuyOrders.size}`);
        
        // NOTE: We do NOT create StopLimit here even if response shows FLL status
        // The API response status might be stale or incorrect. We wait for WebSocket
        // to confirm FLL status before creating StopLimit to ensure accuracy.
        // The WebSocket handler will call handleManualBuyFilled when it receives FLL status.
      } else if (orderIdFromApi == null) {
        console.warn(`⚠️ [DEBUG] Buy order sent for ${symbol} but no order_id in response. Response:`, JSON.stringify(responseData, null, 2));
      }
    }

    // Find which config/origin this symbol belongs to
    let configId = null;
    let groupKey = null;
    const toplistMap = toplistService.toplistByConfig || {};
    outer: for (const configIdKey of Object.keys(toplistMap)) {
      const rows = toplistMap[configIdKey] || [];
      for (const row of rows) {
        const sym = row?.symbol || (Array.isArray(row?.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value) : null);
        if ((sym || '').toUpperCase() === symbol) {
          configId = configIdKey;
          const groupInfo = floatService.getGroupInfoByConfig(configIdKey);
          groupKey = groupInfo?.key || null;
          break outer;
        }
      }
    }

    // Analyze symbol to get indicators and momentum at buy moment
    let indicators = null;
    let momentum = null;
    let price = currentPrice;
    try {
      const analysis = await analyzeSymbol(symbol);
      if (analysis) {
        indicators = analysis.indicators || null;
        momentum = analysis.momentum || null;
        // Use currentPrice if available, otherwise use lastClose
        if (!price && analysis.lastClose) {
          price = analysis.lastClose;
        }
      }
    } catch (analyzeErr) {
      console.error(`Error analyzing ${symbol} for manual buy:`, analyzeErr.message);
    }
    
    const isBuySuccess = notifyStatus.startsWith('200') || notifyStatus.startsWith('201');
    
    // Stop-loss orders are now handled automatically by StopLimitService when positions are detected
    let stopLossResult = null;
    
    // Create buy entry and add to buy list
    const nowIso = new Date().toISOString();
    const entry = {
      ticker: symbol,
      timestamp: toUTC4(nowIso),
      price: price,
      configId: configId,
      group: groupKey,
      notifyStatus,
      indicators: indicators,
      momentum: momentum,
      manual: true, // Mark as manual buy
      quantity: quantity,
      orderType: 'LIMIT',
      limitPrice: currentPrice,
      stopLoss: stopLossResult
    };
    
    buyList.unshift(entry);
    lastBuyTsByTicker.set(symbol, nowIso);
    
    // Broadcast to clients
    broadcastToClients({ type: 'BUY_SIGNAL', data: entry, timestamp: nowIso });
    
    const isSuccess = isBuySuccess;
    
    // Handle network errors with 500, otherwise return 200 with success flag
    if (notifyStatus.startsWith('ERROR:')) {
      return res.status(500).json({
        success: false,
        error: errorMessage || `Failed to buy ${symbol}: Network or parsing error`,
        data: { symbol, quantity, orderType: 'LIMIT', limitPrice: currentPrice, notifyStatus, response: responseData }
      });
    }
    
    console.log(`✅ Manual buy logged for ${symbol} - Added to buy list`);
    
    return res.status(200).json({
      success: isSuccess,
      error: !isSuccess ? (errorMessage || `Failed to buy ${symbol}`) : undefined,
      data: {
        symbol,
        quantity,
        orderType: 'LIMIT',
        limitPrice: currentPrice,
        notifyStatus,
        response: responseData,
        addedToBuyList: true,
        orderId: orderIdFromApi || undefined
      }
    });
  } catch (e) {
    console.error(`❌ Error in manual buy for ${req.body?.symbol}:`, e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Test external sell webhook endpoint
app.post('/api/sells/test', async (req, res) => {
  try {
    const symbol = (req.body?.symbol || '').toString().trim().toUpperCase();
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Missing symbol' });
    }
    
    console.log(`🛒 Manual sell signal for ${symbol}`);
    
    // Get current stock price using Polygon service
    let currentPrice = null;
    try {
      currentPrice = await polygonService.getCurrentPrice(symbol);
      if (!currentPrice || currentPrice <= 0) {
        console.warn(`⚠️ Could not get valid price for ${symbol}, trying lastClose from analysis...`);
        const analysis = await analyzeSymbol(symbol);
        currentPrice = analysis?.lastClose || null;
      }
    } catch (priceErr) {
      console.error(`Error getting price for ${symbol}:`, priceErr.message);
      try {
        const analysis = await analyzeSymbol(symbol);
        currentPrice = analysis?.lastClose || null;
      } catch (analyzeErr) {
        console.error(`Error analyzing ${symbol} for price:`, analyzeErr.message);
      }
    }
    
    if (!currentPrice || currentPrice <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Could not determine current price for ${symbol}. Please try again.` 
      });
    }
    
    // Calculate quantity based on price ranges
    let quantity;
    if (currentPrice > 0 && currentPrice <= 5) {
      quantity = 2002;
    } else if (currentPrice > 5 && currentPrice <= 10) {
      quantity = 1001;
    } else if (currentPrice > 10 && currentPrice <= 12) {
      quantity = 757;
    } else {
      return res.status(400).json({ 
        success: false, 
        error: `Price ${currentPrice} is outside supported range (0-12). Only prices between 0-12 are supported.` 
      });
    }
    
    const orderBody = {
      symbol: symbol,
      side: 'SELL',
      order_type: 'Limit', 
      quantity: quantity,
      limit_price: currentPrice
    };
    
    console.log(`📤 Sending sell order: ${quantity} ${symbol} at LIMIT price ${currentPrice}`);
    
    let notifyStatus = '';
    let responseData = null;
    let errorMessage = null;
    
    try {
      const resp = await fetch('https://sections-bot.inbitme.com/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(orderBody)
      });
      
      notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
      
      let responseText = '';
      try {
        responseText = await resp.text();
        if (responseText) {
          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = responseText;
          }
        }
      } catch (textErr) {
        console.error(`⚠️ Could not read response body:`, textErr.message);
      }
      
      if (resp.ok) {
        console.log(`✅ Sell order sent for ${symbol}: ${notifyStatus}`, responseData ? `Response: ${JSON.stringify(responseData)}` : '');
      } else {
        errorMessage = extractErrorMessage(responseData, responseText, resp.status, resp.statusText);
        console.error(`❌ Error selling ${symbol}:`, {
          status: notifyStatus,
          response: responseData,
          body: responseText,
          extractedError: errorMessage
        });
      }
    } catch (err) {
      notifyStatus = `ERROR: ${err.message}`;
      errorMessage = err.message;
      console.error(`❌ Network/Parse error selling ${symbol}:`, {
        message: err.message,
        stack: err.stack
      });
    }
    
    const isSuccess = notifyStatus.startsWith('200') || notifyStatus.startsWith('201');
    
    if (notifyStatus.startsWith('ERROR:')) {
      return res.status(500).json({
        success: false,
        error: errorMessage || `Failed to sell ${symbol}: Network or parsing error`,
        data: { symbol, quantity, orderType: 'LIMIT', limitPrice: currentPrice, notifyStatus, response: responseData }
      });
    }
    
    console.log(`✅ Manual sell executed for ${symbol}`);
    
    return res.status(200).json({ 
      success: isSuccess, 
      error: !isSuccess ? (errorMessage || `Failed to sell ${symbol}`) : undefined,
      data: { 
        symbol, 
        quantity, 
        orderType: 'LIMIT', 
        limitPrice: currentPrice, 
        notifyStatus, 
        response: responseData
      } 
    });
  } catch (e) {
    console.error(`❌ Error in manual sell for ${req.body?.symbol}:`, e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET fallback for testing (easier to try in browser): /api/buys/test?symbol=ELWS
// Uses the same logic as POST endpoint
app.get('/api/buys/test', async (req, res) => {
  try {
    // Extract symbol from query instead of body
    const symbol = (req.query.symbol || '').toString().trim().toUpperCase();
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Missing symbol' });
    }
    
    console.log(`🛒 Manual buy signal (GET) for ${symbol}`);
    
    // Get current stock price using Polygon service
    let currentPrice = null;
    try {
      currentPrice = await polygonService.getCurrentPrice(symbol);
      if (!currentPrice || currentPrice <= 0) {
        console.warn(`⚠️ Could not get valid price for ${symbol}, trying lastClose from analysis...`);
        const analysis = await analyzeSymbol(symbol);
        currentPrice = analysis?.lastClose || null;
      }
    } catch (priceErr) {
      console.error(`Error getting price for ${symbol}:`, priceErr.message);
      try {
        const analysis = await analyzeSymbol(symbol);
        currentPrice = analysis?.lastClose || null;
      } catch (analyzeErr) {
        console.error(`Error analyzing ${symbol} for price:`, analyzeErr.message);
      }
    }
    
    if (!currentPrice || currentPrice <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Could not determine current price for ${symbol}. Please try again.` 
      });
    }
    
    // Calculate quantity based on price ranges
    let quantity;
    if (currentPrice > 0 && currentPrice <= 5) {
      quantity = 2002;
    } else if (currentPrice > 5 && currentPrice <= 10) {
      quantity = 1001;
    } else if (currentPrice > 10 && currentPrice <= 12) {
      quantity = 757;
    } else {
      return res.status(400).json({ 
        success: false, 
        error: `Price ${currentPrice} is outside supported range (0-12). Only prices between 0-12 are supported.` 
      });
    }
    
    const orderBody = {
      symbol: symbol,
      side: 'BUY',
      order_type: 'Limit',
      quantity: quantity,
      limit_price: currentPrice
    };
    
    console.log(`📤 Sending buy order: ${quantity} ${symbol} at LIMIT price ${currentPrice}`);
    
    let notifyStatus = '';
    let responseData = null;
    let errorMessage = null;
    
    try {
      const resp = await fetch('https://sections-bot.inbitme.com/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(orderBody)
      });
      
      notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
      
      let responseText = '';
      try {
        responseText = await resp.text();
        if (responseText) {
          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = responseText;
          }
        }
      } catch (textErr) {
        console.error(`⚠️ Could not read response body:`, textErr.message);
      }
      
      if (resp.ok) {
        console.log(`✅ Buy order sent for ${symbol}: ${notifyStatus}`, responseData ? `Response: ${JSON.stringify(responseData)}` : '');
      } else {
        errorMessage = extractErrorMessage(responseData, responseText, resp.status, resp.statusText);
        console.error(`❌ Error buying ${symbol}:`, {
          status: notifyStatus,
          response: responseData,
          body: responseText,
          extractedError: errorMessage
        });
      }
    } catch (err) {
      notifyStatus = `ERROR: ${err.message}`;
      errorMessage = err.message;
      console.error(`❌ Network/Parse error buying ${symbol}:`, {
        message: err.message,
        stack: err.stack
      });
    }
    
    // Find which config/origin this symbol belongs to
    let configId = null;
    let groupKey = null;
    const toplistMap = toplistService.toplistByConfig || {};
    outer: for (const configIdKey of Object.keys(toplistMap)) {
      const rows = toplistMap[configIdKey] || [];
      for (const row of rows) {
        const sym = row?.symbol || (Array.isArray(row?.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value) : null);
        if ((sym || '').toUpperCase() === symbol) {
          configId = configIdKey;
          const groupInfo = floatService.getGroupInfoByConfig(configIdKey);
          groupKey = groupInfo?.key || null;
          break outer;
        }
      }
    }
    
    let indicators = null;
    let momentum = null;
    let price = currentPrice;
    try {
      const analysis = await analyzeSymbol(symbol);
      if (analysis) {
        indicators = analysis.indicators || null;
        momentum = analysis.momentum || null;
        if (!price && analysis.lastClose) {
          price = analysis.lastClose;
        }
      }
    } catch (analyzeErr) {
      console.error(`Error analyzing ${symbol} for manual buy:`, analyzeErr.message);
    }
    
    const nowIso = new Date().toISOString();
    const entry = {
      ticker: symbol,
      timestamp: toUTC4(nowIso),
      price: price,
      configId: configId,
      group: groupKey,
      notifyStatus,
      indicators: indicators,
      momentum: momentum,
      manual: true,
      quantity: quantity,
      orderType: 'LIMIT',
      limitPrice: currentPrice
    };
    
    buyList.unshift(entry);
    lastBuyTsByTicker.set(symbol, nowIso);
    
    broadcastToClients({ type: 'BUY_SIGNAL', data: entry, timestamp: nowIso });
    
    const isSuccess = notifyStatus.startsWith('200') || notifyStatus.startsWith('201');
    
    if (notifyStatus.startsWith('ERROR:')) {
      return res.status(500).json({
        success: false,
        error: errorMessage || `Failed to buy ${symbol}: Network or parsing error`,
        data: { symbol, quantity, orderType: 'LIMIT', limitPrice: currentPrice, notifyStatus, response: responseData }
      });
    }
    
    console.log(`✅ Manual buy logged for ${symbol} - Added to buy list`);
    
    return res.status(200).json({ 
      success: isSuccess, 
      error: !isSuccess ? (errorMessage || `Failed to buy ${symbol}`) : undefined,
      data: { 
        symbol, 
        quantity, 
        orderType: 'LIMIT', 
        limitPrice: currentPrice, 
        notifyStatus, 
        response: responseData,
        addedToBuyList: true 
      } 
    });
  } catch (e) {
    console.error(`❌ Error in manual buy (GET) for ${req.query?.symbol}:`, e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Buy trigger mode endpoints
app.get('/api/buys/trigger-mode', (req, res) => {
  res.json({ success: true, data: { mode: buyTriggerMode } });
});

app.post('/api/buys/trigger-mode', (req, res) => {
  try {
    const mode = (req.body?.mode || '').toString();
    if (mode !== 'cross' && mode !== 'positive') {
      return res.status(400).json({ success: false, error: 'Invalid mode. Use "cross" or "positive"' });
    }
    buyTriggerMode = mode;
    res.json({ success: true, data: { mode: buyTriggerMode } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Helper function to get active orders for a symbol
// Returns array of order objects with order_id, side, symbol, etc.
async function getActiveOrdersForSymbol(symbol) {
  try {
    // Note: This assumes the API has an endpoint to get orders by symbol
    // If not available, we'll need to get all orders and filter
    // For now, we'll try to get orders from WebSocket connection or assume we track them
    // Since we don't have direct API access, we'll need to track orders in memory or use WebSocket
    // For implementation, we'll create a function that can be called when needed
    console.log(`📋 Getting active orders for ${symbol}...`);
    
    // TODO: Implement actual API call to get orders if available
    // For now, return empty array - we'll track orders via WebSocket or store them
    return [];
  } catch (e) {
    console.error(`❌ Error getting active orders for ${symbol}:`, e);
    return [];
  }
}

// Helper function to delete an order by order_id
// Returns { success: boolean, error: string | null }
async function deleteOrder(orderId) {
  try {
    if (!orderId || !orderId.toString().trim()) {
      console.warn(`⚠️ Cannot delete order: invalid order ID`);
      return { success: false, error: 'Invalid order ID' };
    }

    const orderIdStr = orderId.toString().trim();
    console.log(`🗑️ Deleting order: ${orderIdStr}`);

    const resp = await fetch(`https://sections-bot.inbitme.com/order/${encodeURIComponent(orderIdStr)}`, {
      method: 'DELETE',
      headers: {
        'Accept': '*/*'
      }
    });

    const status = `${resp.status} ${resp.statusText || ''}`.trim();
    
    // Check if deletion was successful (200 or 204 are success codes)
    if (resp.ok || resp.status === 200 || resp.status === 204) {
      console.log(`✅ Order ${orderIdStr} deleted successfully: ${status}`);
      
      // Immediately remove order from cache after successful deletion
      // The websocket will eventually send an update, but we remove it now to prevent
      // the order from being detected as active in subsequent checks
      if (ordersCache.has(orderIdStr)) {
        ordersCache.delete(orderIdStr);
        // Schedule save to database (to delete from DB)
        if (cachePersistenceService) {
          cachePersistenceService.scheduleOrderSave(orderIdStr);
        }
        console.log(`🗑️ Removed order ${orderIdStr} from cache after deletion`);
      }
      
      return { success: true, status };
    } else {
      let errorMessage = `HTTP ${status}`;
      try {
        const errorData = await resp.json();
        if (errorData && typeof errorData === 'object') {
          errorMessage = errorData.message || errorData.error || errorData.detail || JSON.stringify(errorData);
        }
      } catch {
        // Response might not be JSON
      }
      console.error(`❌ Error deleting order ${orderIdStr}:`, errorMessage);
      return { success: false, error: errorMessage, status };
    }
  } catch (err) {
    console.error(`❌ Network error deleting order ${orderId}:`, err.message);
    return { success: false, error: err.message };
  }
}

const SECTIONS_BOT_ORDER_URL = 'https://sections-bot.inbitme.com/order';

// Find existing active SELL StopLimit order for a symbol. Returns { orderId, quantity, order } or null.
// This function searches tracking map → pending map → cache to catch orders in any state
// Find existing active SELL StopLimit order for a symbol (clean repository pattern)
// Returns { orderId, quantity, order } or null
function findExistingStopLimitSellForSymbol(symbol) {
  const normalized = (symbol || '').toUpperCase();
  
  // Use repository as single source of truth (pattern from sections-buy-bot-main)
  const repoEntry = getActiveStopLimitOrder(normalized);
  
  if (repoEntry) {
    const leg = repoEntry.order.Legs?.[0];
    const qty = parseInt(leg?.QuantityRemaining || leg?.QuantityOrdered || '0', 10) || 0;
    console.log(`✅ [STOPLIMIT_REPO] Found active StopLimit order for ${normalized}: ${repoEntry.orderId} (qty ${qty}, status ${repoEntry.status})`);
    return { orderId: repoEntry.orderId, quantity: qty, order: repoEntry.order };
  }
  
  // CRITICAL: Fallback to cache search if repository doesn't have the order
  // This handles cases where order was ACK'd but not yet registered in repository
  // or repository was cleared but order still exists in cache
  for (const [cachedOrderId, cachedOrder] of ordersCache.entries()) {
    const cachedLeg = cachedOrder.Legs?.[0];
    const cachedSymbol = (cachedLeg?.Symbol || '').toUpperCase();
    const cachedSide = (cachedLeg?.BuyOrSell || '').toUpperCase();
    const cachedType = (cachedOrder.OrderType || '').toUpperCase();
    const cachedStatus = (cachedOrder.Status || '').toUpperCase();
    
    if (cachedSymbol === normalized && 
        cachedSide === 'SELL' && 
        (cachedType === 'STOPLIMIT' || cachedType === 'STOP_LIMIT')) {
      // Check if order is active (not terminal)
      const terminalStatuses = new Set(['CAN', 'FIL', 'FLL', 'EXP', 'REJ', 'OUT']);
      if (!terminalStatuses.has(cachedStatus)) {
        const qty = parseInt(cachedLeg?.QuantityRemaining || cachedLeg?.QuantityOrdered || '0', 10) || 0;
        console.log(`✅ [STOPLIMIT_CACHE] Found active StopLimit order in cache for ${normalized}: ${cachedOrderId} (qty ${qty}, status ${cachedStatus})`);
        // Register in repository for future lookups
        registerStopLimitOrder(cachedOrder);
        return { orderId: cachedOrderId, quantity: qty, order: cachedOrder };
      }
    }
  }
  
  console.log(`ℹ️ [STOPLIMIT_REPO] No active StopLimit order found for ${normalized}`);
  return null;
}

// Price Adjustment Table (from sections-buy-bot-main)
function getPriceAdjustment(price) {
  if (price < 5) {
    return 0.15;
  } else if (price < 10) {
    return 0.20;
  } else {
    return 0.25;
  }
}

// Create a SELL StopLimit order using sections-buy-bot-main logic
// Logic: limit_price = current_price - adjustment, stop_price = limit_price * 1.002
async function createStopLimitSellOrder(symbol, quantity, buyPrice) {
  // CRITICAL: StopLimit logic is DISABLED - return early
  if (!STOPLIMIT_ENABLED) {
    console.log(`⏸️ [STOPLIMIT] StopLimit creation is DISABLED - skipping for ${symbol}`);
    return { success: false, error: 'StopLimit creation is disabled' };
  }
  
  // Validate inputs
  const normalizedSymbol = (symbol || '').toUpperCase();
  const qty = Math.floor(Number(quantity)) || 0;
  const buy = Number(buyPrice) || 0;
  
  if (!normalizedSymbol || qty <= 0 || buy <= 0) {
    console.error(`❌ [DEBUG] Invalid parameters for StopLimit: symbol=${normalizedSymbol}, quantity=${qty}, buyPrice=${buy}`);
    return { success: false, error: 'Invalid parameters' };
  }
  
  // CRITICAL: Get current bid price from position (like sections-buy-bot-main)
  // sections-buy-bot-main uses position.bid, not buy price
  const position = positionsCache.get(normalizedSymbol);
  const currentPrice = position ? parseFloat(position.Bid || position.Last || position.AveragePrice || '0') : buy;
  
  // Use buy price as fallback if position not found
  const price = currentPrice > 0 ? currentPrice : buy;
  
  // CRITICAL: Check StopLimit tracker config FIRST before calculating default prices
  // Tracker config takes priority over default sections-buy-bot-main logic
  let useTrackerInitialStop = false;
  let trackerInitialStopPrice = 0;
  let matchedGroupId = null;
  
  // Debug: Log all tracker config groups
  console.log(`🔍 [STOPLIMIT_TRACKER] Checking tracker config for ${normalizedSymbol} (buy price: ${buy})`);
  console.log(`🔍 [STOPLIMIT_TRACKER] Tracker config has ${stopLimitTrackerConfig.size} group(s)`);
  
  // Check tracker config FIRST - this takes priority
  for (const [groupId, group] of stopLimitTrackerConfig.entries()) {
    console.log(`🔍 [STOPLIMIT_TRACKER] Checking group ${groupId}: enabled=${group.enabled}, minPrice=${group.minPrice}, maxPrice=${group.maxPrice}, initialStopPrice=${group.initialStopPrice}`);
    
    if (!group.enabled) {
      console.log(`⏭️ [STOPLIMIT_TRACKER] Group ${groupId} is disabled, skipping`);
      continue;
    }
    
    // Check if buy price falls within this group's price range
    const buyPriceInRange = buy >= group.minPrice && buy <= group.maxPrice;
    // CRITICAL: initialStopPrice is an OFFSET (difference), not an absolute price
    // It can be negative (e.g., -0.15 means stop_price = buy_price - 0.15)
    const hasInitialStopPrice = group.initialStopPrice != null && group.initialStopPrice !== 0;
    
    if (buyPriceInRange && hasInitialStopPrice) {
      // CRITICAL: initialStopPrice is an OFFSET from buy price, not an absolute price
      // Example: buy=$5.50, initialStopPrice=-0.15 → stop_price = $5.50 + (-0.15) = $5.35
      trackerInitialStopPrice = buy + group.initialStopPrice;
      useTrackerInitialStop = true;
      matchedGroupId = groupId;
      console.log(`✅ [STOPLIMIT_TRACKER] MATCHED! Using initial stop_price offset ${group.initialStopPrice} from group ${groupId} for ${normalizedSymbol}`);
      console.log(`✅ [STOPLIMIT_TRACKER] Calculated stop_price: ${buy} + ${group.initialStopPrice} = ${trackerInitialStopPrice} (buy price: ${buy}, range: ${group.minPrice}-${group.maxPrice})`);
      break;
    } else {
      console.log(`❌ [STOPLIMIT_TRACKER] Group ${groupId} doesn't match: buy=${buy}, range=${group.minPrice}-${group.maxPrice}, initialStopPrice=${group.initialStopPrice}, buyPriceInRange=${buyPriceInRange}, hasInitialStopPrice=${hasInitialStopPrice}`);
    }
  }
  
  // Calculate prices based on tracker config or default logic
  let stopPrice;
  let limitPrice;
  
  if (useTrackerInitialStop) {
    // TRACKER CONFIG: Use initial stop_price offset from tracker config
    // trackerInitialStopPrice is already calculated as: buy + initialStopPrice (offset)
    stopPrice = Math.max(0, trackerInitialStopPrice);
    // Calculate limit_price from stop_price (limit_price = stop_price / 1.002)
    limitPrice = Math.max(0, stopPrice / 1.002);
    console.log(`📊 [STOPLIMIT_TRACKER] Using tracker config values: stop_price=${stopPrice.toFixed(2)} (buy ${buy.toFixed(2)} + offset), limit_price=${limitPrice.toFixed(2)} (calculated from stop_price / 1.002)`);
  } else {
    // DEFAULT: Use sections-buy-bot-main logic
    console.log(`⚠️ [STOPLIMIT_TRACKER] No matching tracker config found for ${normalizedSymbol} (buy price: ${buy}). Using default sections-buy-bot-main logic.`);
    
    // Calculate limit_price using price adjustment table (sections-buy-bot-main logic)
    const adjustment = getPriceAdjustment(price);
    limitPrice = Math.max(0, price - adjustment);
    // Calculate stop_price (sections-buy-bot-main: stop_price = limit_price * 1.002)
    stopPrice = Math.max(0, limitPrice * 1.002);
    console.log(`📊 [STOPLIMIT_TRACKER] Using default values: price=${price}, adjustment=${adjustment}, limit_price=${limitPrice}, stop_price=${stopPrice}`);
  }
  
  // Round to 2 decimal places (like sections-buy-bot-main)
  limitPrice = Math.round(limitPrice * 100) / 100;
  stopPrice = Math.round(stopPrice * 100) / 100;
  
  // CRITICAL: Double-check flag before making API call (defense in depth)
  if (!STOPLIMIT_ENABLED) {
    console.log(`⏸️ [STOPLIMIT] StopLimit creation is DISABLED - aborting API call for ${normalizedSymbol}`);
    return { success: false, error: 'StopLimit creation is disabled' };
  }
  
  const body = {
    symbol: normalizedSymbol,
    side: 'SELL',
    order_type: 'StopLimit',
    quantity: qty,
    stop_price: stopPrice,
    limit_price: limitPrice
  };
  // Calculate adjustment for logging (only used if not using tracker config)
  const adjustment = useTrackerInitialStop ? null : getPriceAdjustment(price);
  
  console.log(`📤 [DEBUG] Creating StopLimit SELL order for ${normalizedSymbol}:`, JSON.stringify({
    ...body,
    buy_price: `$${buy.toFixed(2)}`,
    current_price: `$${price.toFixed(2)}`,
    price_adjustment: adjustment,
    stop_price: `$${stopPrice.toFixed(2)}`,
    limit_price: `$${limitPrice.toFixed(2)}`,
    calculation_method: useTrackerInitialStop ? 'tracker_initial_stop' : 'sections_buy_bot_main',
    tracker_group_id: matchedGroupId || null,
    tracker_initial_stop_price: useTrackerInitialStop ? trackerInitialStopPrice : null,
    tracker_initial_stop_offset: useTrackerInitialStop ? (stopLimitTrackerConfig.get(matchedGroupId)?.initialStopPrice || null) : null
  }, null, 2));
  
  const resp = await fetch(SECTIONS_BOT_ORDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await resp.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { }
  
  if (!resp.ok) {
    console.error(`❌ [DEBUG] Create StopLimit SELL failed for ${normalizedSymbol}:`, {
      status: resp.status,
      statusText: resp.statusText,
      response: data || text,
      requestBody: body
    });
    return { success: false, error: data?.message || data?.detail || String(resp.status) };
  }
  
  // Extract order ID from response
  // Order will be registered in repository when WebSocket confirms ACK status
  const orderId = data?.order_id ?? data?.OrderID ?? data?.orderId ?? null;
  if (orderId) {
    const orderIdStr = String(orderId);
    console.log(`📋 [STOPLIMIT_REPO] StopLimit order created for ${normalizedSymbol}, order ID ${orderIdStr} (will be registered when ACK'd)`);
  } else {
    console.warn(`⚠️ [DEBUG] StopLimit order created for ${normalizedSymbol} but no order_id in response:`, JSON.stringify(data, null, 2));
  }
  
  console.log(`✅ [DEBUG] StopLimit SELL created successfully for ${normalizedSymbol}:`, {
    qty: body.quantity,
    stop_price: `$${body.stop_price.toFixed(2)}`,
    limit_price: `$${body.limit_price.toFixed(2)}`,
    orderId: orderId,
    response: data
  });
  return { success: true, data, orderId };
}

// Modify order quantity via PUT /order (Sections Bot Modificar Orden).
async function modifyOrderQuantity(orderId, newQuantity) {
  const body = { order_id: String(orderId), quantity: Math.floor(Number(newQuantity)) || 0 };
  console.log(`📤 [DEBUG] Modifying order quantity:`, JSON.stringify(body, null, 2));
  
  const resp = await fetch(SECTIONS_BOT_ORDER_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await resp.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { }
  
  if (!resp.ok) {
    console.error(`❌ [DEBUG] Modify order ${orderId} quantity failed:`, {
      status: resp.status,
      statusText: resp.statusText,
      response: data || text
    });
    return { success: false, error: data?.message || data?.detail || String(resp.status) };
  }
  console.log(`✅ [DEBUG] Order ${orderId} quantity updated successfully:`, {
    newQuantity: body.quantity,
    response: data
  });
  return { success: true, data };
}

// Modify StopLimit order stop_price and limit_price
async function modifyStopLimitPrice(orderId, stopPrice, limitPrice) {
  const body = { 
    order_id: String(orderId), 
    stop_price: parseFloat(stopPrice) || 0,
    limit_price: parseFloat(limitPrice) || 0
  };
  console.log(`📤 [DEBUG] Modifying StopLimit order prices:`, JSON.stringify(body, null, 2));
  
  const resp = await fetch(SECTIONS_BOT_ORDER_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await resp.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { }
  
  if (!resp.ok) {
    console.error(`❌ [DEBUG] Modify StopLimit order ${orderId} prices failed:`, {
      status: resp.status,
      statusText: resp.statusText,
      response: data || text
    });
    return { success: false, error: data?.message || data?.detail || String(resp.status) };
  }
  console.log(`✅ [DEBUG] StopLimit order ${orderId} prices updated successfully:`, {
    stopPrice: body.stop_price,
    limitPrice: body.limit_price,
    response: data
  });
  return { success: true, data };
}

// Check StopLimit tracker and update orders based on P&L (sections-buy-bot-main pattern)
// CRITICAL: This function ONLY updates existing StopLimit orders, NEVER creates new ones
// StopLimit orders are created by handleManualBuyFilled when buy orders fill
async function checkStopLimitTracker(symbol, position) {
  // CRITICAL: StopLimit logic is DISABLED - return early
  if (!STOPLIMIT_ENABLED) {
    return;
  }
  try {
    const normalizedSymbol = (symbol || '').toUpperCase();
    const avgPrice = parseFloat(position.AveragePrice || '0');
    const currentPnl = parseFloat(position.UnrealizedProfitLoss || '0');
    
    if (avgPrice <= 0 || !normalizedSymbol) return;
    
    // CRITICAL: Check repository FIRST (sections-buy-bot-main pattern: ensure_has_cancel_order)
    // If no StopLimit exists in repository, don't do anything - it will be created by handleManualBuyFilled
    const existingStopLimit = getActiveStopLimitOrder(normalizedSymbol);
    if (!existingStopLimit) {
      // No active StopLimit in repository - this is normal if:
      // 1. Buy order just filled and StopLimit hasn't been created yet
      // 2. StopLimit was filled/cancelled
      // Don't create here - let handleManualBuyFilled handle creation
      return;
    }
    
    // Find matching group by price range
    let matchingGroup = null;
    let matchingGroupId = null;
    
    for (const [groupId, group] of stopLimitTrackerConfig.entries()) {
      if (!group.enabled) continue;
      if (avgPrice >= group.minPrice && avgPrice <= group.maxPrice) {
        matchingGroup = group;
        matchingGroupId = groupId;
        break;
      }
    }
    
    if (!matchingGroup || !matchingGroup.steps || matchingGroup.steps.length === 0) {
      return; // No matching group or no steps configured
    }
    
    // Get current progress for this symbol
    const progress = stopLimitTrackerProgress.get(normalizedSymbol);
    const currentStepIndex = progress ? progress.currentStepIndex : -1;
    
    // Find the highest step that the P&L has reached
    let newStepIndex = -1;
    for (let i = 0; i < matchingGroup.steps.length; i++) {
      const step = matchingGroup.steps[i];
      const stepPnl = parseFloat(step.pnl || '0');
      if (currentPnl >= stepPnl) {
        newStepIndex = i;
      } else {
        break;
      }
    }
    
    // If we've reached a new step, update the StopLimit order
    if (newStepIndex > currentStepIndex && newStepIndex >= 0) {
      const newStep = matchingGroup.steps[newStepIndex];
      const newStopPrice = parseFloat(newStep.stop || '0');
      
      if (newStopPrice > 0) {
        // Use existing StopLimit from repository (already checked above)
        const stopLimitOrderId = existingStopLimit.orderId;
        
        // Calculate limit_price using sections-buy-bot-main logic: limit_price = stop_price / 1.002
        const newLimitPrice = Math.max(0, newStopPrice / 1.002);
        // Round to 2 decimal places
        const roundedLimitPrice = Math.round(newLimitPrice * 100) / 100;
        
        console.log(`📈 [STOPLIMIT_TRACKER] ${normalizedSymbol} reached step ${newStepIndex + 1} (P&L: $${currentPnl.toFixed(2)}). Updating StopLimit ${stopLimitOrderId} to stop_price: $${newStopPrice.toFixed(2)}, limit_price: $${roundedLimitPrice.toFixed(2)}`);
        
        const result = await modifyStopLimitPrice(stopLimitOrderId, newStopPrice, roundedLimitPrice);
        
        if (result.success) {
          // Update progress
          stopLimitTrackerProgress.set(normalizedSymbol, {
            groupId: matchingGroupId,
            currentStepIndex: newStepIndex,
            lastPnl: currentPnl,
            lastUpdate: Date.now()
          });
          console.log(`✅ [STOPLIMIT_TRACKER] Successfully updated StopLimit for ${normalizedSymbol} to step ${newStepIndex + 1}`);
        } else {
          console.error(`❌ [STOPLIMIT_TRACKER] Failed to update StopLimit for ${normalizedSymbol}:`, result.error);
        }
      }
    }
    
    // Update progress even if no step change (to track current P&L)
    if (progress) {
      progress.lastPnl = currentPnl;
      progress.lastUpdate = Date.now();
    } else if (matchingGroup && existingStopLimit) {
      // Initialize progress if not exists (only if StopLimit exists)
      stopLimitTrackerProgress.set(normalizedSymbol, {
        groupId: matchingGroupId,
        currentStepIndex: -1,
        lastPnl: currentPnl,
        lastUpdate: Date.now()
      });
    }
  } catch (err) {
    console.error(`❌ [STOPLIMIT_TRACKER] Error checking tracker for ${symbol}:`, err);
  }
}

// When a tracked manual BUY order reaches FLL/FIL: create new StopLimit SELL or add to existing.
async function handleManualBuyFilled(orderId, order, pending) {
  // CRITICAL: StopLimit logic is DISABLED - return early
  if (!STOPLIMIT_ENABLED) {
    console.log(`⏸️ [STOPLIMIT] StopLimit creation is DISABLED - skipping for order ${orderId}`);
    return;
  }
  
  // Prevent duplicate calls for the same order
  if (stopLimitCreationInProgress.has(orderId)) {
    console.log(`⏸️ [DEBUG] StopLimit creation already in progress for order ${orderId}, skipping duplicate call`);
    return;
  }
  
  const symbol = (pending.symbol || (order.Legs?.[0]?.Symbol || '')).toString().toUpperCase();
  const normalizedSymbol = symbol;
  
  // CRITICAL: Check database FIRST before any other checks (authoritative source of truth)
  // This ensures we catch orders that exist in DB even if repository is empty
  if (cachePersistenceService) {
    const dbCheck = await cachePersistenceService.checkDatabaseForActiveStopLimit(normalizedSymbol);
    if (dbCheck) {
      console.log(`🛑 [DEBUG] Database check found active StopLimit ${dbCheck.orderId} for ${normalizedSymbol} (status: ${dbCheck.status}) - aborting creation!`);
      
      // Register in repository if not already there
      if (!stopLimitOrderRepository.has(normalizedSymbol)) {
        stopLimitOrderRepository.set(normalizedSymbol, {
          orderId: dbCheck.orderId,
          order: dbCheck.order,
          openedDateTime: dbCheck.openedDateTime,
          status: dbCheck.status
        });
        console.log(`✅ [STOPLIMIT_REPO] Registered StopLimit ${dbCheck.orderId} from database for ${normalizedSymbol}`);
      }
      
      // Update quantity if needed
      const position = positionsCache.get(normalizedSymbol);
      const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
      if (positionQty > 0) {
        modifyOrderQuantity(dbCheck.orderId, positionQty).catch(err => {
          console.error(`❌ [DEBUG] Error updating StopLimit quantity:`, err);
        });
      }
      return; // CRITICAL: Exit early - order already exists in database
    }
  }
  
  // CRITICAL: Symbol-level guard - prevent multiple StopLimit creations for the same symbol
  // This must be checked BEFORE any async operations
  if (stopLimitCreationBySymbol.has(normalizedSymbol)) {
    console.log(`🛑 [DEBUG] StopLimit creation already in progress for symbol ${normalizedSymbol} (order ${orderId}), aborting to prevent duplicate!`);
    // Check repository - if StopLimit exists, update quantity instead
    const existingRepoOrder = getActiveStopLimitOrder(normalizedSymbol);
    if (existingRepoOrder) {
      console.log(`✅ [DEBUG] Found existing StopLimit ${existingRepoOrder.orderId} in repository for ${normalizedSymbol} - updating quantity`);
      const position = positionsCache.get(normalizedSymbol);
      const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
      if (positionQty > 0) {
        modifyOrderQuantity(existingRepoOrder.orderId, positionQty).catch(err => {
          console.error(`❌ [DEBUG] Error updating StopLimit quantity:`, err);
        });
      }
    }
    return; // CRITICAL: Exit early if symbol is already being processed
  }
  
  console.log(`🎯 [DEBUG] Order object:`, JSON.stringify({
    OrderID: order.OrderID,
    Status: order.Status,
    OrderType: order.OrderType,
    FilledPrice: order.FilledPrice,
    LimitPrice: order.LimitPrice,
    Legs: order.Legs
  }, null, 2));
  console.log(`🎯 [DEBUG] Pending data:`, JSON.stringify(pending, null, 2));
  
  const leg = order.Legs && order.Legs[0] ? order.Legs[0] : null;
  const quantity = Math.floor(Number(pending.quantity || leg?.ExecQuantity || leg?.QuantityOrdered || 0)) || 0;
  
  // CRITICAL: Always use pending.limitPrice (the buy order's limit price) as the buy price
  // This is the price at which we bought
  // DO NOT use order.FilledPrice or order.LimitPrice as they might be different or stale
  // Note: createStopLimitSellOrder will use sections-buy-bot-main logic with current bid price
  const fillPrice = parseFloat(pending.limitPrice || 0) || 0;
  
  // Validate fillPrice - must be positive and match the buy order price
  if (fillPrice <= 0) {
    console.error(`❌ [DEBUG] handleManualBuyFilled: Invalid fillPrice ${fillPrice} for ${normalizedSymbol}. Pending:`, JSON.stringify(pending, null, 2), `Order:`, JSON.stringify(order, null, 2));
    return;
  }
  
  // Log warning if order prices don't match pending price (for debugging)
  const orderFilledPrice = parseFloat(order.FilledPrice || 0) || 0;
  const orderLimitPrice = parseFloat(order.LimitPrice || 0) || 0;
  if (orderFilledPrice > 0 && Math.abs(orderFilledPrice - fillPrice) > 0.01) {
    console.warn(`⚠️ [DEBUG] Price mismatch: pending.limitPrice=${fillPrice}, order.FilledPrice=${orderFilledPrice} for ${normalizedSymbol}`);
  }
  if (orderLimitPrice > 0 && Math.abs(orderLimitPrice - fillPrice) > 0.01) {
    console.warn(`⚠️ [DEBUG] Price mismatch: pending.limitPrice=${fillPrice}, order.LimitPrice=${orderLimitPrice} for ${normalizedSymbol}`);
  }
  
  // CRITICAL: Check if StopLimit was already filled for this symbol - prevent creating new StopLimit
  // This prevents loops when StopLimit is FLL but position still exists
  const filledStopLimit = stopLimitFilledSymbols.get(normalizedSymbol);
  if (filledStopLimit) {
    const timeSinceFilled = Date.now() - filledStopLimit.timestamp;
    const FILLED_STOPLIMIT_THRESHOLD = 60000; // 60 seconds - if StopLimit was filled recently, don't create new one
    
    if (timeSinceFilled < FILLED_STOPLIMIT_THRESHOLD) {
      console.warn(`⚠️ [DEBUG] Symbol ${normalizedSymbol} had StopLimit filled ${timeSinceFilled}ms ago (order ${filledStopLimit.orderId}). Skipping StopLimit creation to prevent loops.`);
      // Clean up any stale tracking (repository pattern)
      stopLimitOrderRepository.delete(normalizedSymbol);
      stopLimitCreationBySymbol.delete(normalizedSymbol);
      
      // Check if position still exists - if not, remove from filled tracking
      const position = positionsCache.get(normalizedSymbol);
      if (!position || parseFloat(position.Quantity || '0') <= 0) {
        stopLimitFilledSymbols.delete(normalizedSymbol);
        console.log(`🧹 [DEBUG] Position closed for ${normalizedSymbol} - removed from filled StopLimit tracking`);
      }
      
      return;
    } else {
      // Enough time has passed, remove from filled tracking (can create new StopLimit if needed)
      console.log(`✅ [DEBUG] StopLimit was filled ${timeSinceFilled}ms ago (>${FILLED_STOPLIMIT_THRESHOLD}ms) for ${normalizedSymbol}. Removing from filled tracking.`);
      stopLimitFilledSymbols.delete(normalizedSymbol);
    }
  }
  
  // CRITICAL: Check if symbol was recently sold - prevent StopLimit creation loops
  const recentlySoldTimestamp = recentlySoldSymbols.get(normalizedSymbol);
  if (recentlySoldTimestamp) {
    const timeSinceSold = Date.now() - recentlySoldTimestamp;
    const RECENTLY_SOLD_THRESHOLD = 15000; // 15 seconds - enough time for position to close, cleanup, and WebSocket updates
    
    if (timeSinceSold < RECENTLY_SOLD_THRESHOLD) {
      console.warn(`⚠️ [DEBUG] Symbol ${normalizedSymbol} was recently sold ${timeSinceSold}ms ago (<${RECENTLY_SOLD_THRESHOLD}ms). Skipping StopLimit creation to prevent loops.`);
      // Clean up any stale tracking (repository pattern)
      stopLimitOrderRepository.delete(normalizedSymbol);
      stopLimitCreationBySymbol.delete(normalizedSymbol);
      
      // Also clean up any cancelled/filled StopLimit orders in cache
      for (const [orderId, cachedOrder] of ordersCache.entries()) {
        if (!cachedOrder?.Legs?.length) continue;
        const orderType = (cachedOrder.OrderType || '').toUpperCase();
        if (orderType !== 'STOPLIMIT' && orderType !== 'STOP_LIMIT') continue;
        
        const leg = cachedOrder.Legs[0];
        const legSymbol = (leg.Symbol || '').toUpperCase();
        const legSide = (leg.BuyOrSell || '').toUpperCase();
        if (legSymbol === normalizedSymbol && legSide === 'SELL') {
          const cachedStatus = (cachedOrder.Status || '').toUpperCase();
          if (['CAN', 'FIL', 'FLL', 'EXP', 'REJ'].includes(cachedStatus)) {
            console.log(`🗑️ [DEBUG] Removing stale StopLimit order ${orderId} from cache (recently sold check)`);
            ordersCache.delete(orderId);
          }
        }
      }
      
      return;
    } else {
      // Enough time has passed, remove from recently sold tracking
      console.log(`✅ [DEBUG] Symbol ${normalizedSymbol} was sold ${timeSinceSold}ms ago (>${RECENTLY_SOLD_THRESHOLD}ms). Removing from recently sold tracking.`);
      recentlySoldSymbols.delete(normalizedSymbol);
    }
  }
  
  // CRITICAL: If position exists now, remove from recently sold (it was rebought)
  // This ensures we can create StopLimit for legitimate rebuys
  if (recentlySoldSymbols.has(normalizedSymbol)) {
    const position = positionsCache.get(normalizedSymbol);
    if (position && parseFloat(position.Quantity || '0') > 0) {
      console.log(`✅ [DEBUG] Symbol ${normalizedSymbol} was recently sold but position exists now (rebuy). Removing from recently sold tracking.`);
      recentlySoldSymbols.delete(normalizedSymbol);
    }
  }
  
  // CRITICAL: Verify position actually exists before creating StopLimit
  // This prevents creating StopLimit for positions that were just sold
  // However, we need to wait a bit for positions WebSocket to update the cache
  // (there's a timing difference between orders WebSocket and positions WebSocket)
  let existingPosition = positionsCache.get(normalizedSymbol);
  let hasExistingPosition = existingPosition && parseFloat(existingPosition.Quantity || '0') > 0;
  
  // If position not found immediately, wait for positions WebSocket to update (up to 1.5 seconds)
  // This handles the race condition where buy order fills before position appears in cache
  // REDUCED: Changed from 3 seconds (6 * 500ms) to 1.5 seconds (3 * 500ms) for faster StopLimit creation
  if (!hasExistingPosition) {
    console.log(`⏳ [DEBUG] Position not found in cache for ${normalizedSymbol} immediately. Waiting for positions WebSocket update...`);
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms between checks
      existingPosition = positionsCache.get(normalizedSymbol);
      hasExistingPosition = existingPosition && parseFloat(existingPosition.Quantity || '0') > 0;
      if (hasExistingPosition) {
        console.log(`✅ [DEBUG] Position found in cache for ${normalizedSymbol} after ${(i + 1) * 500}ms wait`);
        break;
      }
    }
  }
  
  // DEFENSIVE: If position still doesn't exist after waiting, it was likely sold
  // Clean up any stale StopLimit tracking and abort
  if (!hasExistingPosition) {
    console.warn(`⚠️ [DEBUG] handleManualBuyFilled: No position found for ${normalizedSymbol} after waiting - position may have been sold. Cleaning up any stale StopLimit tracking...`);
      // Clean up any stale tracking (repository pattern)
      stopLimitOrderRepository.delete(normalizedSymbol);
      stopLimitCreationBySymbol.delete(normalizedSymbol);
    console.log(`🧹 [DEBUG] Cleaned up stale StopLimit tracking for ${normalizedSymbol} (no position exists after wait)`);
    return;
  }
  
  console.log(`🎯 [DEBUG] Extracted values:`, {
    symbol: normalizedSymbol,
    quantity,
    fillPrice,
    filledPrice: order.FilledPrice,
    limitPrice: order.LimitPrice,
    pendingLimitPrice: pending.limitPrice,
    legExecQuantity: leg?.ExecQuantity,
    legQuantityOrdered: leg?.QuantityOrdered,
    buyPrice: fillPrice,
    note: 'StopLimit prices calculated using sections-buy-bot-main logic with current bid price',
    hasExistingPosition: hasExistingPosition,
    existingPositionQuantity: hasExistingPosition ? parseFloat(existingPosition.Quantity || '0') : 0
  });
  
  if (!normalizedSymbol || quantity <= 0) {
    console.warn(`⚠️ [DEBUG] handleManualBuyFilled: Invalid data - symbol=${normalizedSymbol}, quantity=${quantity}`);
    return;
  }
  
  // Mark this order as in progress
  stopLimitCreationInProgress.add(orderId);
  
  try {
    // CRITICAL: Check for ANY pending StopLimit orders in cache FIRST (before symbol guard)
    // This catches orders that were just created but not yet ACK'd
    const pendingStopLimitCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
    if (pendingStopLimitCheck) {
      const { orderId: pendingOrderId, order: pendingOrder } = pendingStopLimitCheck;
      const pendingStatus = (pendingOrder?.Status || '').toUpperCase();
      const isPending = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED', 'PENDING'].includes(pendingStatus);
      
      if (isPending) {
        console.log(`🛑 [DEBUG] Found PENDING StopLimit order ${pendingOrderId} (status: ${pendingStatus}) for ${normalizedSymbol} - aborting creation to prevent duplicate!`);
        // Update quantity if needed
        const position = positionsCache.get(normalizedSymbol);
        const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
        if (positionQty > 0) {
          modifyOrderQuantity(pendingOrderId, positionQty).catch(err => {
            console.error(`❌ [DEBUG] Error updating pending StopLimit quantity:`, err);
          });
        }
        return; // CRITICAL: Exit early if pending order exists
      }
    }
    
    // CRITICAL: Early check - if StopLimit creation is already in progress for THIS symbol, wait
    // This prevents race conditions when multiple buys of the same symbol happen quickly
    if (stopLimitCreationBySymbol.has(normalizedSymbol)) {
      console.log(`⏸️ [DEBUG] StopLimit creation already in progress for ${normalizedSymbol}. Waiting...`);
      // Check repository for existing order
      const earlyPendingCheck = getActiveStopLimitOrder(normalizedSymbol);
      
      // Wait for the pending order to be processed (up to 2 seconds)
      // REDUCED: Changed from 5 seconds (10 * 500ms) to 2 seconds (4 * 500ms) for faster StopLimit creation
      for (let i = 0; i < 4; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Use unified search to check for existing order (more reliable than checking maps directly)
        const waitCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
        if (waitCheck) {
          const { orderId: waitOrderId, order: waitOrder } = waitCheck;
          const waitStatus = (waitOrder?.Status || '').toUpperCase();
          const isActive = isActiveOrderStatus(waitStatus);
          const isPending = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(waitStatus);
          
          if (isActive || isPending) {
            console.log(`✅ [DEBUG] Found active StopLimit order ${waitOrderId} after waiting (status: ${waitStatus}). Updating quantity...`);
            // CRITICAL: Use actual position quantity, not order quantity
            // The position quantity reflects the total shares owned (including the new buy)
            const position = positionsCache.get(normalizedSymbol);
            const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
            if (positionQty > 0) {
              // Wait a bit for position to update if needed
              if (positionQty <= parseInt(waitOrder.Legs?.[0]?.QuantityRemaining || waitOrder.Legs?.[0]?.QuantityOrdered || '0', 10) || 0) {
                console.log(`⏳ [DEBUG] Position quantity (${positionQty}) may not include new buy. Waiting...`);
                for (let i = 0; i < 3; i++) {
                  await new Promise(resolve => setTimeout(resolve, 400));
                  const updatedPosition = positionsCache.get(normalizedSymbol);
                  const newQty = updatedPosition ? parseFloat(updatedPosition.Quantity || '0') : 0;
                  if (newQty > positionQty) {
                    positionQty = newQty;
                    break;
                  }
                  positionQty = newQty;
                }
              }
              
              console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares (was: ${waitOrder.Legs?.[0]?.QuantityRemaining || waitOrder.Legs?.[0]?.QuantityOrdered || 0})`);
              const result = await modifyOrderQuantity(waitOrderId, positionQty);
              console.log(`📝 [DEBUG] Modify order result:`, JSON.stringify(result, null, 2));
              
              if (result.success) {
                // Order updated successfully - repository will be updated by WebSocket handler
                return;
              } else {
                console.error(`❌ [DEBUG] Failed to modify StopLimit order ${waitOrderId}: ${result.error}`);
                // Don't create new - order exists, just modification failed
                return;
              }
            } else {
              console.warn(`⚠️ [DEBUG] Position quantity is 0 or not found for ${normalizedSymbol}, cannot update StopLimit`);
            }
          }
        }
        
        // Check if creation is no longer in progress (completed or failed)
        if (!stopLimitCreationBySymbol.has(normalizedSymbol)) {
          // Creation completed, use unified search to check if order exists now
          const completedCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
          if (completedCheck) {
            const { orderId: completedOrderId, order: completedOrder } = completedCheck;
            const completedStatus = (completedOrder?.Status || '').toUpperCase();
            const isActive = isActiveOrderStatus(completedStatus);
            const isPending = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(completedStatus);
            
            if (isActive || isPending) {
              console.log(`✅ [DEBUG] Found active StopLimit order ${completedOrderId} after creation completed (status: ${completedStatus}). Updating quantity...`);
              // CRITICAL: Use actual position quantity, not order quantity
              let position = positionsCache.get(normalizedSymbol);
              let positionQty = position ? parseFloat(position.Quantity || '0') : 0;
              
              // Wait for position to update if needed
              if (positionQty > 0) {
                const orderQty = parseInt(completedOrder.Legs?.[0]?.QuantityRemaining || completedOrder.Legs?.[0]?.QuantityOrdered || '0', 10) || 0;
                if (positionQty <= orderQty) {
                  console.log(`⏳ [DEBUG] Position quantity (${positionQty}) may not include new buy. Waiting...`);
                  for (let i = 0; i < 3; i++) {
                    await new Promise(resolve => setTimeout(resolve, 400));
                    position = positionsCache.get(normalizedSymbol);
                    const newQty = position ? parseFloat(position.Quantity || '0') : 0;
                    if (newQty > positionQty) {
                      positionQty = newQty;
                      break;
                    }
                    positionQty = newQty;
                  }
                }
                
                console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares`);
                const result = await modifyOrderQuantity(completedOrderId, positionQty);
                console.log(`📝 [DEBUG] Modify order result:`, JSON.stringify(result, null, 2));
                
                if (result.success) {
                  // Order updated successfully - repository will be updated by WebSocket handler
                  return;
                } else {
                  console.error(`❌ [DEBUG] Failed to modify StopLimit order ${completedOrderId}: ${result.error}`);
                  // Don't create new - order exists, just modification failed
                  return;
                }
              } else {
                console.warn(`⚠️ [DEBUG] Position quantity is 0 or not found for ${normalizedSymbol}, cannot update StopLimit`);
              }
            }
          }
          break;
        }
      }
      
      // If we've waited and still in progress, check one more time before proceeding using unified search
      const finalWaitCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
      if (finalWaitCheck) {
        const { orderId: finalWaitOrderId, order: finalWaitOrder } = finalWaitCheck;
        const finalWaitStatus = (finalWaitOrder?.Status || '').toUpperCase();
        const isActive = isActiveOrderStatus(finalWaitStatus);
        const isPending = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(finalWaitStatus);
        
        if (isActive || isPending) {
          console.log(`✅ [DEBUG] Found active StopLimit order ${finalWaitOrderId} in final wait check (status: ${finalWaitStatus}). Updating quantity...`);
          // CRITICAL: Use actual position quantity, not order quantity
          let position = positionsCache.get(normalizedSymbol);
          let positionQty = position ? parseFloat(position.Quantity || '0') : 0;
          
          if (positionQty > 0) {
            const orderQty = parseInt(finalWaitOrder.Legs?.[0]?.QuantityRemaining || finalWaitOrder.Legs?.[0]?.QuantityOrdered || '0', 10) || 0;
            if (positionQty <= orderQty) {
              console.log(`⏳ [DEBUG] Position quantity (${positionQty}) may not include new buy. Waiting...`);
              for (let i = 0; i < 3; i++) {
                await new Promise(resolve => setTimeout(resolve, 400));
                position = positionsCache.get(normalizedSymbol);
                const newQty = position ? parseFloat(position.Quantity || '0') : 0;
                if (newQty > positionQty) {
                  positionQty = newQty;
                  break;
                }
                positionQty = newQty;
              }
            }
            
            console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares`);
            const result = await modifyOrderQuantity(finalWaitOrderId, positionQty);
            console.log(`📝 [DEBUG] Modify order result:`, JSON.stringify(result, null, 2));
            
            if (result.success) {
              // Order updated successfully - repository will be updated by WebSocket handler
              return;
            } else {
              console.error(`❌ [DEBUG] Failed to modify StopLimit order ${finalWaitOrderId}: ${result.error}`);
              // Don't create new - order exists, just modification failed
              return;
            }
          } else {
            console.warn(`⚠️ [DEBUG] Position quantity is 0 or not found for ${normalizedSymbol}, cannot update StopLimit`);
          }
        }
      }
    }
    
    // CRITICAL: Unified check for existing StopLimit order
    // Use the improved findExistingStopLimitSellForSymbol which checks repository (single source of truth)
    // This ensures we catch orders regardless of where they are in the system
    console.log(`🔍 [DEBUG] Starting unified check for existing StopLimit for ${normalizedSymbol}...`);
    
    // CRITICAL: Wait briefly for repository to update if order was just created/ACK'd
    // This prevents race conditions where we check before repository is updated
    // REDUCED: Changed from 1000ms to 300ms for faster StopLimit creation
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // CRITICAL: Check repository FIRST (most authoritative source) before unified search
    const repoCheckBeforeUnified = getActiveStopLimitOrder(normalizedSymbol);
    if (repoCheckBeforeUnified) {
      console.log(`🛑 [DEBUG] Repository has active StopLimit ${repoCheckBeforeUnified.orderId} for ${normalizedSymbol} - aborting creation to prevent duplicate!`);
      // Update quantity if needed
      const position = positionsCache.get(normalizedSymbol);
      const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
      if (positionQty > 0) {
        const result = await modifyOrderQuantity(repoCheckBeforeUnified.orderId, positionQty);
        if (result.success) {
          console.log(`✅ [DEBUG] Updated existing StopLimit quantity to ${positionQty}`);
        }
      }
      return; // CRITICAL: Exit early if order exists in repository
    }
    
    // CRITICAL: Double-check for pending orders in cache (not just repository)
    // This catches orders that were just created but not yet registered in repository
    const doubleCheckPending = findExistingStopLimitSellForSymbol(normalizedSymbol);
    if (doubleCheckPending) {
      const { orderId: doubleCheckOrderId, order: doubleCheckOrder } = doubleCheckPending;
      const doubleCheckStatus = (doubleCheckOrder?.Status || '').toUpperCase();
      const isPendingOrActive = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED', 'PENDING'].includes(doubleCheckStatus) || isActiveOrderStatus(doubleCheckStatus);
      
      if (isPendingOrActive) {
        console.log(`🛑 [DEBUG] Double-check found active/pending StopLimit order ${doubleCheckOrderId} (status: ${doubleCheckStatus}) for ${normalizedSymbol} - aborting creation!`);
        // Update quantity if needed
        const position = positionsCache.get(normalizedSymbol);
        const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
        if (positionQty > 0) {
          modifyOrderQuantity(doubleCheckOrderId, positionQty).catch(err => {
            console.error(`❌ [DEBUG] Error updating double-check StopLimit quantity:`, err);
          });
        }
        return; // CRITICAL: Exit early if pending/active order exists
      }
    }
    
    const existingStopLimit = findExistingStopLimitSellForSymbol(normalizedSymbol);
    
    if (existingStopLimit) {
      const { orderId: existingOrderId, quantity: existingQty, order: existingOrder } = existingStopLimit;
      const currentStatus = (existingOrder?.Status || '').toUpperCase();
      
      // Check if order is active or pending (ACK, DON, etc.)
      const isActive = isActiveOrderStatus(currentStatus);
      const isPending = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(currentStatus);
      
      if (isActive || isPending) {
        console.log(`✅ [DEBUG] Found existing StopLimit order ${existingOrderId} (status: ${currentStatus}, qty: ${existingQty}). Updating quantity...`);
        
        // CRITICAL: Wait for position to be updated in cache (for rebuy scenarios)
        // The position might not reflect the new buy quantity yet
        let position = positionsCache.get(normalizedSymbol);
        let positionQty = position ? parseFloat(position.Quantity || '0') : 0;
        
        // If position quantity doesn't seem to include the new buy, wait a bit
        if (positionQty > 0 && positionQty <= existingQty) {
          console.log(`⏳ [DEBUG] Position quantity (${positionQty}) doesn't seem to include new buy yet. Waiting for position update...`);
          for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 400));
            position = positionsCache.get(normalizedSymbol);
            const newPositionQty = position ? parseFloat(position.Quantity || '0') : 0;
            if (newPositionQty > positionQty) {
              positionQty = newPositionQty;
              console.log(`✅ [DEBUG] Position quantity updated to ${positionQty} after ${(i + 1) * 400}ms`);
              break;
            }
            positionQty = newPositionQty;
          }
        }
        
        // If order is pending (not yet fully active), wait briefly for it to stabilize
        // REDUCED: Changed from 1000ms to 300ms for faster StopLimit creation
        if (isPending && !isActive) {
          console.log(`⏳ [DEBUG] Order ${existingOrderId} is pending (${currentStatus}), waiting for stabilization...`);
          await new Promise(resolve => setTimeout(resolve, 300));
          // Re-fetch order to get latest status
          const updatedOrder = ordersCache.get(existingOrderId);
          if (updatedOrder) {
            const updatedStatus = (updatedOrder.Status || '').toUpperCase();
            if (!isActiveOrderStatus(updatedStatus) && !['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(updatedStatus)) {
              console.log(`⚠️ [DEBUG] Order ${existingOrderId} status changed to ${updatedStatus} (not active). Will create new one.`);
              // Remove from repository and continue to create new
              stopLimitOrderRepository.delete(normalizedSymbol);
            } else {
              // Order is still active/pending, proceed with update
              // Re-check position quantity one more time
              position = positionsCache.get(normalizedSymbol);
              positionQty = position ? parseFloat(position.Quantity || '0') : 0;
              
              if (positionQty > 0) {
                const orderQty = parseInt(updatedOrder.Legs?.[0]?.QuantityRemaining || updatedOrder.Legs?.[0]?.QuantityOrdered || '0', 10) || 0;
                console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares (order was: ${orderQty})`);
                const result = await modifyOrderQuantity(existingOrderId, positionQty);
                console.log(`📝 [DEBUG] Modify order result:`, JSON.stringify(result, null, 2));
                
                // CRITICAL: Validate result - if modification failed, log error but don't create duplicate
                if (!result.success) {
                  console.error(`❌ [DEBUG] Failed to modify StopLimit order ${existingOrderId}: ${result.error}`);
                  console.error(`❌ [DEBUG] This might cause issues. Position qty: ${positionQty}, Order qty: ${orderQty}`);
                  // Don't return - let it continue to check if we should create new or retry
                } else {
                  // Order updated successfully - repository will be updated by WebSocket handler
                  return;
                }
              } else {
                console.warn(`⚠️ [DEBUG] Position quantity is 0 or not found for ${normalizedSymbol}, cannot update StopLimit`);
              }
            }
          }
        } else {
          // Order is active, update immediately
          // CRITICAL: Use actual position quantity, not order quantity
          // The position quantity reflects the total shares owned (including the new buy)
          if (positionQty > 0) {
            const orderQty = parseInt(existingOrder.Legs?.[0]?.QuantityRemaining || existingOrder.Legs?.[0]?.QuantityOrdered || '0', 10) || 0;
            console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares (order currently has: ${orderQty})`);
            const result = await modifyOrderQuantity(existingOrderId, positionQty);
            console.log(`📝 [DEBUG] Modify order result:`, JSON.stringify(result, null, 2));
            
            // CRITICAL: Validate result - if modification failed, log error
            if (!result.success) {
              console.error(`❌ [DEBUG] Failed to modify StopLimit order ${existingOrderId}: ${result.error}`);
              console.error(`❌ [DEBUG] Position qty: ${positionQty}, Order qty: ${orderQty}, Status: ${currentStatus}`);
              // Don't return - continue to see if we should retry or create new
              // But mark that we tried to update
            } else {
              // Order updated successfully - repository will be updated by WebSocket handler
              return;
            }
          } else {
            console.warn(`⚠️ [DEBUG] Position quantity is 0 or not found for ${normalizedSymbol}, cannot update StopLimit`);
          }
        }
      } else {
        console.log(`⚠️ [DEBUG] StopLimit order ${existingOrderId} found but status is ${currentStatus} (not active/pending). Removing from repository and creating new one.`);
        // Remove from repository since it's not active
        stopLimitOrderRepository.delete(normalizedSymbol);
      }
    } else {
      console.log(`ℹ️ [DEBUG] No existing StopLimit found for ${normalizedSymbol} in unified check`);
    }
    
    // No existing active StopLimit order found - create new one
    // Check if StopLimit creation is already in progress for this symbol (prevent loops)
    if (stopLimitCreationBySymbol.has(normalizedSymbol)) {
      console.log(`⏸️ [DEBUG] StopLimit creation already in progress for ${normalizedSymbol}, waiting...`);
      // Wait briefly and check again using unified search
      // REDUCED: Changed from 1000ms to 300ms for faster StopLimit creation
      await new Promise(resolve => setTimeout(resolve, 300));
      const waitCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
      if (waitCheck) {
        const { orderId: waitOrderId, order: waitOrder } = waitCheck;
        const waitStatus = (waitOrder?.Status || '').toUpperCase();
        if (isActiveOrderStatus(waitStatus) || ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(waitStatus)) {
          console.log(`✅ [DEBUG] StopLimit was created while waiting (${waitOrderId}), modifying existing order`);
          // CRITICAL: Use actual position quantity, not order quantity
          let position = positionsCache.get(normalizedSymbol);
          let positionQty = position ? parseFloat(position.Quantity || '0') : 0;
          
          if (positionQty > 0) {
            const orderQty = parseInt(waitOrder.Legs?.[0]?.QuantityRemaining || waitOrder.Legs?.[0]?.QuantityOrdered || '0', 10) || 0;
            if (positionQty <= orderQty) {
              console.log(`⏳ [DEBUG] Position quantity (${positionQty}) may not include new buy. Waiting...`);
              for (let i = 0; i < 3; i++) {
                await new Promise(resolve => setTimeout(resolve, 400));
                position = positionsCache.get(normalizedSymbol);
                const newQty = position ? parseFloat(position.Quantity || '0') : 0;
                if (newQty > positionQty) {
                  positionQty = newQty;
                  break;
                }
                positionQty = newQty;
              }
            }
            
            console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares`);
            const result = await modifyOrderQuantity(waitOrderId, positionQty);
            console.log(`📝 [DEBUG] Modify order result:`, JSON.stringify(result, null, 2));
            
            if (result.success) {
              // Order updated successfully - repository will be updated by WebSocket handler
              return;
            } else {
              console.error(`❌ [DEBUG] Failed to modify StopLimit order ${waitOrderId}: ${result.error}`);
              // Don't create new - order exists, just modification failed
              return;
            }
          } else {
            console.warn(`⚠️ [DEBUG] Position quantity is 0 or not found for ${normalizedSymbol}, cannot update StopLimit`);
          }
        }
      }
    }
    
    // CRITICAL: Double-check that creation is not already in progress (race condition guard)
    // This can happen if two different buy orders for the same symbol fill at nearly the same time
    if (stopLimitCreationBySymbol.has(normalizedSymbol)) {
      console.log(`⚠️ [DEBUG] StopLimit creation already in progress for ${normalizedSymbol} (race condition detected). Waiting...`);
      // REDUCED: Changed from 1000ms to 300ms for faster StopLimit creation
      await new Promise(resolve => setTimeout(resolve, 300));
      // Use unified search to check again after waiting
      const raceCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
      if (raceCheck) {
        const { orderId: raceOrderId, order: raceOrder } = raceCheck;
        const raceStatus = (raceOrder?.Status || '').toUpperCase();
        if (isActiveOrderStatus(raceStatus) || ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(raceStatus)) {
          console.log(`✅ [DEBUG] Found active StopLimit order ${raceOrderId} after race condition wait. Updating quantity...`);
          // CRITICAL: Use actual position quantity, not order quantity
          let position = positionsCache.get(normalizedSymbol);
          let positionQty = position ? parseFloat(position.Quantity || '0') : 0;
          
          if (positionQty > 0) {
            const orderQty = parseInt(raceOrder.Legs?.[0]?.QuantityRemaining || raceOrder.Legs?.[0]?.QuantityOrdered || '0', 10) || 0;
            if (positionQty <= orderQty) {
              console.log(`⏳ [DEBUG] Position quantity (${positionQty}) may not include new buy. Waiting...`);
              for (let i = 0; i < 3; i++) {
                await new Promise(resolve => setTimeout(resolve, 400));
                position = positionsCache.get(normalizedSymbol);
                const newQty = position ? parseFloat(position.Quantity || '0') : 0;
                if (newQty > positionQty) {
                  positionQty = newQty;
                  break;
                }
                positionQty = newQty;
              }
            }
            
            console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares`);
            const result = await modifyOrderQuantity(raceOrderId, positionQty);
            console.log(`📝 [DEBUG] Modify order result:`, JSON.stringify(result, null, 2));
            
            if (result.success) {
              // Order updated successfully - repository will be updated by WebSocket handler
              return;
            } else {
              console.error(`❌ [DEBUG] Failed to modify StopLimit order ${raceOrderId}: ${result.error}`);
              // Don't create new - order exists, just modification failed
              return;
            }
          } else {
            console.warn(`⚠️ [DEBUG] Position quantity is 0 or not found for ${normalizedSymbol}, cannot update StopLimit`);
          }
        }
      }
      // If still in progress and no order found, log warning but continue (shouldn't happen)
      if (stopLimitCreationBySymbol.has(normalizedSymbol)) {
        console.warn(`⚠️ [DEBUG] StopLimit creation still in progress for ${normalizedSymbol} after wait. Proceeding with caution...`);
      }
    }
    
    // CRITICAL: One final check before marking as in progress
    // This catches any orders that might have been created between our checks and now
    // REDUCED: Changed from 500ms to 200ms for faster StopLimit creation
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const absoluteFinalCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
    if (absoluteFinalCheck) {
      const { orderId: finalOrderId, order: finalOrder } = absoluteFinalCheck;
      const finalStatus = (finalOrder?.Status || '').toUpperCase();
      const isActive = isActiveOrderStatus(finalStatus);
      const isPending = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(finalStatus);
      
      if (isActive || isPending) {
        console.log(`✅ [DEBUG] Absolute final check found existing StopLimit ${finalOrderId} (status: ${finalStatus}). Updating quantity...`);
        // CRITICAL: Use actual position quantity, not order quantity
        const position = positionsCache.get(normalizedSymbol);
        const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
        if (positionQty > 0) {
          console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares`);
          const result = await modifyOrderQuantity(finalOrderId, positionQty);
          console.log(`📝 [DEBUG] Modify order result:`, JSON.stringify(result, null, 2));
          // Order updated successfully - repository will be updated by WebSocket handler
          return;
        } else {
          console.warn(`⚠️ [DEBUG] Position quantity is 0 or not found for ${normalizedSymbol}, cannot update StopLimit`);
        }
      }
    }
    
    // CRITICAL: Check repository one more time before marking as in progress
    // This is the absolute last check to prevent duplicate creation
    const repoCheckBeforeProgress = getActiveStopLimitOrder(normalizedSymbol);
    if (repoCheckBeforeProgress) {
      console.log(`🛑 [DEBUG] CRITICAL: Repository check found active StopLimit ${repoCheckBeforeProgress.orderId} for ${normalizedSymbol} - aborting creation to prevent duplicate!`);
      // Update quantity if needed
      const position = positionsCache.get(normalizedSymbol);
      const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
      if (positionQty > 0) {
        const result = await modifyOrderQuantity(repoCheckBeforeProgress.orderId, positionQty);
        if (result.success) {
          console.log(`✅ [DEBUG] Updated existing StopLimit quantity to ${positionQty}`);
        }
      }
      return;
    }
    
    // CRITICAL: Check database DIRECTLY before creating (authoritative source of truth)
    // This catches cases where repository might be empty but database has the order
    if (cachePersistenceService) {
      const dbCheck = await cachePersistenceService.checkDatabaseForActiveStopLimit(normalizedSymbol);
      if (dbCheck) {
        console.log(`🛑 [DEBUG] CRITICAL: Database check found active StopLimit ${dbCheck.orderId} for ${normalizedSymbol} (status: ${dbCheck.status}) - aborting creation to prevent duplicate!`);
        
        // Register in repository if not already there
        if (!stopLimitOrderRepository.has(normalizedSymbol)) {
          stopLimitOrderRepository.set(normalizedSymbol, {
            orderId: dbCheck.orderId,
            order: dbCheck.order,
            openedDateTime: dbCheck.openedDateTime,
            status: dbCheck.status
          });
          console.log(`✅ [STOPLIMIT_REPO] Registered StopLimit ${dbCheck.orderId} from database for ${normalizedSymbol}`);
        }
        
        // Update quantity if needed
        const position = positionsCache.get(normalizedSymbol);
        const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
        if (positionQty > 0) {
          const result = await modifyOrderQuantity(dbCheck.orderId, positionQty);
          if (result.success) {
            console.log(`✅ [DEBUG] Updated existing StopLimit quantity to ${positionQty}`);
          }
        }
        return; // CRITICAL: Abort creation - order already exists in database
      }
    }
    
    // Mark symbol as in progress - CRITICAL: Do this AFTER all checks to prevent race conditions
    // CRITICAL: Add symbol to guard BEFORE creating order
    // This prevents other calls from creating duplicate StopLimit orders
    stopLimitCreationBySymbol.add(normalizedSymbol);
    console.log(`🔒 [DEBUG] Added ${normalizedSymbol} to stopLimitCreationBySymbol guard`);
    console.log(`🔒 [DEBUG] Marked ${normalizedSymbol} as in progress for StopLimit creation`);
    console.log(`📊 [DEBUG] Current state - Repository: ${stopLimitOrderRepository.size} entries, In Progress: ${stopLimitCreationBySymbol.size} symbols`);
    
    try {
      // CRITICAL: Before creating a new StopLimit, check for and cancel ANY active sell orders
      // Stocks can only have one active sell order per symbol (broker restriction)
      // This includes Limit, Market, and StopLimit orders
      const findActiveSellOrdersInCache = (symbol) => {
        const normalized = symbol.toUpperCase();
        const activeOrders = [];
        const activeStatuses = new Set(['ACK', 'DON', 'REC', 'QUE', 'QUEUED', 'OPEN', 'NEW', 'PENDING', 'PARTIALLY_FILLED', 'PND']);
        const terminalStatuses = new Set(['FIL', 'FLL', 'CAN', 'EXP', 'REJ', 'OUT', 'CANCELLED', 'FILLED', 'REJECTED', 'EXPIRED']);
        
        for (const [orderId, order] of ordersCache.entries()) {
          if (!order || !order.Legs) continue;
          const status = (order.Status || '').toUpperCase();
          if (terminalStatuses.has(status)) continue;
          const isActive = activeStatuses.has(status) || !status || status === '';
          if (!isActive) continue;
          
          for (const leg of order.Legs) {
            const legSymbol = (leg.Symbol || '').toUpperCase();
            const legSide = (leg.BuyOrSell || '').toUpperCase();
            if (legSymbol === normalized && legSide === 'SELL') {
              activeOrders.push({ orderId, status, order });
              break;
            }
          }
        }
        return activeOrders;
      };
      
      // CRITICAL: Final check before creating - use repository (single source of truth)
      // This catches any orders that might have been created/ACK'd between our earlier check and now
      console.log(`🔍 [DEBUG] Final check before creating StopLimit for ${normalizedSymbol}...`);
      
      // Wait a moment for repository to update if order was just ACK'd
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Check repository directly (most authoritative)
      const repoFinalCheck = getActiveStopLimitOrder(normalizedSymbol);
      if (repoFinalCheck) {
        console.log(`🛑 [DEBUG] Repository final check found active StopLimit ${repoFinalCheck.orderId} - aborting creation!`);
        const position = positionsCache.get(normalizedSymbol);
        const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
        if (positionQty > 0) {
          await modifyOrderQuantity(repoFinalCheck.orderId, positionQty);
        }
        // CRITICAL: Remove from guard before returning
        stopLimitCreationBySymbol.delete(normalizedSymbol);
        console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (found in repository)`);
        return;
      }
      
      // CRITICAL: Check database DIRECTLY before creating (authoritative source of truth)
      // This catches cases where repository might be empty but database has the order
      if (cachePersistenceService) {
        const dbFinalCheck = await cachePersistenceService.checkDatabaseForActiveStopLimit(normalizedSymbol);
        if (dbFinalCheck) {
          console.log(`🛑 [DEBUG] Database final check found active StopLimit ${dbFinalCheck.orderId} (status: ${dbFinalCheck.status}) - aborting creation!`);
          
          // Register in repository if not already there
          if (!stopLimitOrderRepository.has(normalizedSymbol)) {
            stopLimitOrderRepository.set(normalizedSymbol, {
              orderId: dbFinalCheck.orderId,
              order: dbFinalCheck.order,
              openedDateTime: dbFinalCheck.openedDateTime,
              status: dbFinalCheck.status
            });
            console.log(`✅ [STOPLIMIT_REPO] Registered StopLimit ${dbFinalCheck.orderId} from database for ${normalizedSymbol}`);
          }
          
          const position = positionsCache.get(normalizedSymbol);
          const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
          if (positionQty > 0) {
            await modifyOrderQuantity(dbFinalCheck.orderId, positionQty);
          }
          // CRITICAL: Remove from guard before returning
          stopLimitCreationBySymbol.delete(normalizedSymbol);
          console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (found in database)`);
          return;
        }
      }
      
      // Also check via unified search as backup
      const finalCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
      if (finalCheck) {
        const { orderId: finalOrderId, order: finalOrder } = finalCheck;
        const finalStatus = (finalOrder?.Status || '').toUpperCase();
        const isActive = isActiveOrderStatus(finalStatus);
        const isPending = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(finalStatus);
        
        if (isActive || isPending) {
          console.log(`✅ [DEBUG] Found existing StopLimit ${finalOrderId} in final check (status: ${finalStatus}). Updating quantity...`);
          // CRITICAL: Use actual position quantity, not order quantity
          // Wait a bit for position to update if needed
          let position = positionsCache.get(normalizedSymbol);
          let positionQty = position ? parseFloat(position.Quantity || '0') : 0;
          
          if (positionQty > 0) {
            const orderQty = parseInt(finalOrder.Legs?.[0]?.QuantityRemaining || finalOrder.Legs?.[0]?.QuantityOrdered || '0', 10) || 0;
            // If position quantity doesn't seem updated, wait a bit
            if (positionQty <= orderQty) {
              console.log(`⏳ [DEBUG] Position quantity (${positionQty}) may not include new buy. Waiting...`);
              for (let i = 0; i < 3; i++) {
                await new Promise(resolve => setTimeout(resolve, 300));
                position = positionsCache.get(normalizedSymbol);
                const newQty = position ? parseFloat(position.Quantity || '0') : 0;
                if (newQty > positionQty) {
                  positionQty = newQty;
                  break;
                }
                positionQty = newQty;
              }
            }
            
            console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares (order has: ${orderQty})`);
            const result = await modifyOrderQuantity(finalOrderId, positionQty);
            console.log(`📝 [DEBUG] Modify order result:`, JSON.stringify(result, null, 2));
            
            // CRITICAL: Validate result
            if (!result.success) {
              console.error(`❌ [DEBUG] Failed to modify StopLimit order ${finalOrderId} in final check: ${result.error}`);
              // Don't create new - the order exists, just modification failed
              // This prevents duplicate creation
              // CRITICAL: Remove from guard before returning
              stopLimitCreationBySymbol.delete(normalizedSymbol);
              console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (modification failed)`);
              return;
            }
            
            // CRITICAL: Remove from guard after successful update
            stopLimitCreationBySymbol.delete(normalizedSymbol);
            console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (updated existing order)`);
            return;
            
            // Order updated successfully - repository will be updated by WebSocket handler
            return;
          } else {
            console.warn(`⚠️ [DEBUG] Position quantity is 0 or not found for ${normalizedSymbol}, cannot update StopLimit`);
          }
        } else {
          console.log(`⚠️ [DEBUG] Final check found order ${finalOrderId} but status ${finalStatus} is not active/pending. Will create new.`);
        }
      } else {
        console.log(`✅ [DEBUG] Final check confirmed: No existing StopLimit for ${normalizedSymbol}. Proceeding with creation.`);
      }
      
      // Check for any active sell orders
      // CRITICAL: Check for StopLimit orders in active sell orders - they might not have been found by findExistingStopLimitSellForSymbol
      const activeSellOrders = findActiveSellOrdersInCache(normalizedSymbol);
      const stopLimitInActiveSells = activeSellOrders.filter(order => {
        const orderType = (order.order.OrderType || '').toUpperCase();
        return orderType === 'STOPLIMIT' || orderType === 'STOP_LIMIT';
      });
      
      // If we found StopLimit orders in active sells but not in our search, update them
      if (stopLimitInActiveSells.length > 0) {
        console.log(`🛑 [DEBUG] Found ${stopLimitInActiveSells.length} StopLimit order(s) in active sells that weren't found by search!`);
        for (const stopLimitOrder of stopLimitInActiveSells) {
          const stopLimitId = stopLimitOrder.orderId;
          const stopLimitStatus = (stopLimitOrder.status || '').toUpperCase();
          const isActive = isActiveOrderStatus(stopLimitStatus);
          const isPending = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(stopLimitStatus);
          
          if (isActive || isPending) {
            console.log(`🛑 [DEBUG] Found StopLimit order ${stopLimitId} (status: ${stopLimitStatus}) in active sells - updating instead of creating duplicate...`);
            
            // Get position quantity
            let position = positionsCache.get(normalizedSymbol);
            let positionQty = position ? parseFloat(position.Quantity || '0') : 0;
            
            if (positionQty > 0) {
              const orderQty = parseInt(stopLimitOrder.order.Legs?.[0]?.QuantityRemaining || stopLimitOrder.order.Legs?.[0]?.QuantityOrdered || '0', 10) || 0;
              console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares (order has: ${orderQty})`);
              const result = await modifyOrderQuantity(stopLimitId, positionQty);
              
              if (result.success) {
                console.log(`✅ [DEBUG] Successfully updated StopLimit ${stopLimitId} - prevented duplicate creation`);
                // Order updated successfully - repository will be updated by WebSocket handler
                return;
              } else {
                console.error(`❌ [DEBUG] Failed to update StopLimit ${stopLimitId}: ${result.error}`);
                // Order exists but update failed - don't create duplicate
                return;
              }
            }
          }
        }
      }
      
      // Only cancel non-StopLimit sell orders (Limit, Market, etc.)
      const nonStopLimitOrders = activeSellOrders.filter(order => {
        const orderType = (order.order.OrderType || '').toUpperCase();
        return orderType !== 'STOPLIMIT' && orderType !== 'STOP_LIMIT';
      });
      
      if (nonStopLimitOrders.length > 0) {
        console.log(`⚠️ [DEBUG] Found ${nonStopLimitOrders.length} active non-StopLimit sell order(s) for ${normalizedSymbol}. Cancelling them...`);
        for (const sellOrder of nonStopLimitOrders) {
          console.log(`   - Order ${sellOrder.orderId} (Type: ${sellOrder.order.OrderType}, Status: ${sellOrder.status})`);
        }
        
        // Cancel non-StopLimit sell orders
        const cancelOrderDirectly = async (orderId) => {
          try {
            const resp = await fetch(`https://sections-bot.inbitme.com/order/${encodeURIComponent(orderId)}`, {
              method: 'DELETE',
              headers: { 'Accept': '*/*' }
            });
            const isSuccess = resp.ok || resp.status === 200 || resp.status === 204 || resp.status === 404;
            if (isSuccess) {
              console.log(`✅ Cancelled order ${orderId}`);
              ordersCache.delete(orderId);
              return true;
            }
            return false;
          } catch (err) {
            console.error(`❌ Error cancelling order ${orderId}:`, err.message);
            return false;
          }
        };
        
        const cancelResults = await Promise.allSettled(
          nonStopLimitOrders.map(order => cancelOrderDirectly(order.orderId))
        );
        const successCount = cancelResults.filter(r => r.status === 'fulfilled' && r.value === true).length;
        console.log(`✅ Cancelled ${successCount}/${nonStopLimitOrders.length} active non-StopLimit sell order(s) for ${normalizedSymbol}`);
        
        // Wait for cancellation to propagate
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // CRITICAL: One more absolute final check before creating
      // This is the last chance to catch any StopLimit orders that might have been created
      // between our checks and now (race condition protection)
      const absoluteFinalCheckBeforeCreate = findExistingStopLimitSellForSymbol(normalizedSymbol);
      if (absoluteFinalCheckBeforeCreate) {
        const { orderId: absFinalOrderId, order: absFinalOrder } = absoluteFinalCheckBeforeCreate;
        const absFinalStatus = (absFinalOrder?.Status || '').toUpperCase();
        const isActive = isActiveOrderStatus(absFinalStatus);
        const isPending = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(absFinalStatus);
        
        if (isActive || isPending) {
          console.log(`🛑 [DEBUG] CRITICAL: Found existing StopLimit ${absFinalOrderId} in absolute final check before creation! (status: ${absFinalStatus})`);
          console.log(`🛑 [DEBUG] This should not happen - updating quantity instead of creating duplicate...`);
          
          // Get position quantity
          let position = positionsCache.get(normalizedSymbol);
          let positionQty = position ? parseFloat(position.Quantity || '0') : 0;
          
          if (positionQty > 0) {
            const orderQty = parseInt(absFinalOrder.Legs?.[0]?.QuantityRemaining || absFinalOrder.Legs?.[0]?.QuantityOrdered || '0', 10) || 0;
            console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares (order has: ${orderQty})`);
            const result = await modifyOrderQuantity(absFinalOrderId, positionQty);
            
            if (result.success) {
              console.log(`✅ [DEBUG] Successfully updated existing StopLimit ${absFinalOrderId} - prevented duplicate creation`);
              // Order updated successfully - repository will be updated by WebSocket handler
              return;
            } else {
              console.error(`❌ [DEBUG] Failed to update StopLimit ${absFinalOrderId}: ${result.error}`);
              // Order exists but update failed - don't create duplicate
              return;
            }
          }
        }
      }
      
      // No existing StopLimit found - create new one
      // NOTE: createStopLimitSellOrder will use tracker config if available, otherwise defaults to buy_price - 0.15
      console.log(`📝 [DEBUG] No existing StopLimit found. Creating new StopLimit SELL for ${normalizedSymbol} (buy: $${fillPrice.toFixed(2)})...`);
      
      // CRITICAL: One more repository check right before creation (last chance to prevent duplicate)
      const lastRepoCheck = getActiveStopLimitOrder(normalizedSymbol);
      if (lastRepoCheck) {
        console.log(`🛑 [DEBUG] LAST CHECK: Repository has active StopLimit ${lastRepoCheck.orderId} - aborting creation!`);
        const position = positionsCache.get(normalizedSymbol);
        const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
        if (positionQty > 0) {
          await modifyOrderQuantity(lastRepoCheck.orderId, positionQty);
        }
        // CRITICAL: Remove from guard before returning
        stopLimitCreationBySymbol.delete(normalizedSymbol);
        console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (found in last check)`);
        return;
      }
      
      // CRITICAL: Register pending order IMMEDIATELY (sections-buy-bot-main pattern: register_pending_order)
      // This prevents duplicate creation if another call checks repository before API call completes
      // We'll register a placeholder order in the repository with a temporary orderId
      // The real orderId will be updated when the order is ACK'd via WebSocket
      const tempOrderId = `pending_${normalizedSymbol}_${Date.now()}`;
      stopLimitOrderRepository.set(normalizedSymbol, {
        orderId: tempOrderId,
        order: null, // Will be set when ACK'd
        openedDateTime: new Date().toISOString(),
        status: 'PENDING'
      });
      console.log(`📋 [STOPLIMIT_REPO] Registered pending StopLimit order for ${normalizedSymbol} (temp ID: ${tempOrderId}) - prevents duplicate creation (sections-buy-bot-main pattern)`);
      
      const result = await createStopLimitSellOrder(normalizedSymbol, quantity, fillPrice);
      console.log(`📝 [DEBUG] Create StopLimit result:`, JSON.stringify(result, null, 2));
      
      // CRITICAL: After creation, update repository with real orderId (sections-buy-bot-main pattern)
      if (result.success && result.orderId) {
        // Update repository with real orderId (replace temporary pending order)
        const repoEntry = stopLimitOrderRepository.get(normalizedSymbol);
        if (repoEntry && repoEntry.orderId === tempOrderId) {
          stopLimitOrderRepository.set(normalizedSymbol, {
            orderId: String(result.orderId),
            order: null, // Will be set when ACK'd
            openedDateTime: new Date().toISOString(),
            status: 'PENDING'
          });
          console.log(`📋 [STOPLIMIT_REPO] Updated repository with real orderId ${result.orderId} for ${normalizedSymbol} (replaced temp ID: ${tempOrderId})`);
        }
        // Order details will be fully registered when WebSocket confirms ACK status via registerStopLimitOrder
        
        // Wait a moment for order to appear in cache
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Check if multiple StopLimit orders exist now
        const postCreationCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
        if (postCreationCheck && postCreationCheck.orderId !== result.orderId) {
          console.error(`🛑 [DEBUG] CRITICAL: After creating StopLimit ${result.orderId}, found different StopLimit ${postCreationCheck.orderId}!`);
          console.error(`🛑 [DEBUG] This indicates a duplicate was created. Cancelling the new one...`);
          
          // Try to cancel the one we just created
          try {
            const cancelResp = await fetch(`https://sections-bot.inbitme.com/order/${encodeURIComponent(result.orderId)}`, {
              method: 'DELETE',
              headers: { 'Accept': '*/*' }
            });
            if (cancelResp.ok || cancelResp.status === 200 || cancelResp.status === 204 || cancelResp.status === 404) {
              console.log(`✅ Cancelled duplicate StopLimit order ${result.orderId}`);
              // Use the existing one instead - repository will be updated by WebSocket handler
              // CRITICAL: Remove from guard before returning
              stopLimitCreationBySymbol.delete(normalizedSymbol);
              console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (duplicate found)`);
              return;
            }
          } catch (err) {
            console.error(`❌ Error cancelling duplicate StopLimit ${result.orderId}:`, err.message);
          }
        }
      }
      
      // Check if order was rejected and log details
      if (!result.success) {
        console.error(`❌ [DEBUG] StopLimit creation failed for ${normalizedSymbol}:`, result.error);
        
        // CRITICAL: Even if creation failed, check if an order was somehow created
        // This can happen if the API creates the order but returns an error
        await new Promise(resolve => setTimeout(resolve, 1000));
        const postFailureCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
        if (postFailureCheck) {
          console.log(`⚠️ [DEBUG] StopLimit creation reported failure, but found existing StopLimit ${postFailureCheck.orderId}!`);
          console.log(`⚠️ [DEBUG] Order may have been created despite error. Using existing order...`);
          // Update repository with real orderId if found
          const repoEntry = stopLimitOrderRepository.get(normalizedSymbol);
          if (repoEntry && repoEntry.orderId === tempOrderId) {
            stopLimitOrderRepository.set(normalizedSymbol, {
              orderId: String(postFailureCheck.orderId),
              order: postFailureCheck.order || null,
              openedDateTime: postFailureCheck.order?.OpenedDateTime || new Date().toISOString(),
              status: (postFailureCheck.order?.Status || 'PENDING').toUpperCase()
            });
            console.log(`📋 [STOPLIMIT_REPO] Updated repository with found orderId ${postFailureCheck.orderId} for ${normalizedSymbol} (creation reported failure but order exists)`);
          }
          // Repository will be updated by WebSocket handler when order is ACK'd
          // CRITICAL: Remove from guard before returning
          stopLimitCreationBySymbol.delete(normalizedSymbol);
          console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (order found after failure)`);
          return;
        } else {
          // CRITICAL: Remove pending order from repository on failure (sections-buy-bot-main pattern)
          const repoEntry = stopLimitOrderRepository.get(normalizedSymbol);
          if (repoEntry && repoEntry.orderId === tempOrderId) {
            stopLimitOrderRepository.delete(normalizedSymbol);
            console.log(`🗑️ [STOPLIMIT_REPO] Removed pending order from repository for ${normalizedSymbol} (creation failed, no order found)`);
          }
        }
        
        // If rejected, check if there are still active orders
        const postCheck = findActiveSellOrdersInCache(normalizedSymbol);
        if (postCheck.length > 0) {
          console.error(`❌ [DEBUG] StopLimit was rejected. ${postCheck.length} active sell order(s) still exist:`, postCheck.map(o => `${o.orderId} (${o.status})`).join(', '));
        }
      }
      
      // NOTE: Order ID will be saved to tracking map when WebSocket confirms ACK status
      // Don't save it here to prevent loops if order gets rejected
    } finally {
      // CRITICAL: Don't remove guard here - let registerStopLimitOrder handle it when order is ACK'd
      // This ensures the guard stays active until the order is actually registered in repository
      // The guard will be removed by registerStopLimitOrder after a delay (2 seconds)
      // Only remove if creation failed and no order was created
      setTimeout(() => {
        // Check if order was actually created and registered
        const repoCheck = getActiveStopLimitOrder(normalizedSymbol);
        if (!repoCheck && stopLimitCreationBySymbol.has(normalizedSymbol)) {
          // Order was not registered - creation likely failed, safe to remove guard
          stopLimitCreationBySymbol.delete(normalizedSymbol);
          console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (creation failed, no order registered)`);
        } else if (repoCheck) {
          // Order exists - guard will be removed by registerStopLimitOrder when ACK'd
          console.log(`⏳ [DEBUG] Guard for ${normalizedSymbol} will be removed when order ${repoCheck.orderId} is ACK'd`);
        }
      }, 3000); // Check after 3 seconds
    }
  } finally {
    // Remove from in-progress set
    stopLimitCreationInProgress.delete(orderId);
  }
}

// Helper function to get active SELL orders for a symbol from orders websocket
// Analyzes the orders websocket stream to find active sell orders based on active statuses
async function getActiveSellOrdersFromWebSocket(symbol) {
  const normalizedSymbol = symbol.toUpperCase();
  const activeSellOrders = [];
  
  // Check if orders websocket is connected
  const isWebSocketConnected = ordersWs && ordersWs.readyState === WebSocket.OPEN;
  
  if (!isWebSocketConnected) {
    console.warn(`⚠️ Orders websocket not connected - cannot analyze orders for ${normalizedSymbol}`);
    // Try to reconnect if not connected
    if (process.env.PNL_API_KEY && !ordersWs) {
      console.log(`🔄 Attempting to connect orders websocket...`);
      connectOrdersWebSocket();
      // Wait a moment for connection to establish
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return activeSellOrders;
  }
  
  // Wait a brief moment to allow any pending websocket messages to be processed
  // This ensures we have the latest order data from the websocket stream
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Check if websocket is receiving data (has received at least one update)
  if (lastOrderUpdateTime === null) {
    console.warn(`⚠️ Orders websocket connected but no data received yet for ${normalizedSymbol} - waiting for initial data...`);
    // Wait a bit longer for initial data
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  
  // Check how fresh the data is (if last update was more than 5 minutes ago, it might be stale)
  if (lastOrderUpdateTime !== null) {
    const dataAge = Date.now() - lastOrderUpdateTime;
    if (dataAge > 5 * 60 * 1000) {
      console.warn(`⚠️ Orders websocket data might be stale (last update ${Math.round(dataAge / 1000)}s ago) for ${normalizedSymbol}`);
    } else {
      console.log(`✅ Orders websocket data is fresh (last update ${Math.round(dataAge / 1000)}s ago)`);
    }
  }
  
  // Analyze orders from websocket cache (which contains real-time data from websocket stream)
  console.log(`📡 Analyzing orders websocket stream for ${normalizedSymbol}... (${ordersCache.size} orders received from websocket)`);
  
  for (const [orderId, order] of ordersCache.entries()) {
    // Check if order has legs with the symbol we're looking for
    if (order.Legs && Array.isArray(order.Legs)) {
      for (const leg of order.Legs) {
        const legSymbol = (leg.Symbol || '').toUpperCase();
        const buyOrSell = leg.BuyOrSell || '';
        
        // Check if this is a SELL order for the symbol we're looking for
        if (legSymbol === normalizedSymbol && buyOrSell.toUpperCase() === 'SELL') {
          // Check if order status is considered active (includes ACK, DON, REC, QUE, etc.)
          if (isActiveOrderStatus(order.Status)) {
            activeSellOrders.push({
              orderId: orderId,
              order: order,
              symbol: legSymbol,
              status: order.Status,
              quantity: leg.QuantityRemaining || leg.QuantityOrdered || '0'
            });
            console.log(`🔍 Found active SELL order from websocket stream: ${orderId} (${legSymbol}, Status: ${order.Status})`);
            break; // Found a matching leg, no need to check other legs
          }
        }
      }
    }
  }
  
  return activeSellOrders;
}

// Helper function to delete all SELL orders for a symbol
// Analyzes orders websocket to check for active sell orders with status ACK or DON, then deletes them
async function deleteAllSellOrdersForSymbol(symbol) {
  try {
    const normalizedSymbol = symbol.toUpperCase();
    console.log(`🗑️ Deleting all SELL orders for ${normalizedSymbol}...`);
    
    const ordersToDelete = [];
    
    // First, analyze orders websocket stream to get active sell orders with status ACK or DON
    console.log(`📡 Analyzing orders websocket stream for active SELL orders for ${normalizedSymbol}...`);
    const activeSellOrders = await getActiveSellOrdersFromWebSocket(normalizedSymbol);
    
    // Add order IDs from websocket analysis
    for (const sellOrder of activeSellOrders) {
      ordersToDelete.push(sellOrder.orderId);
    }
    
    // Also check buy list for stop-loss order IDs for this symbol (fallback)
    for (const buyEntry of buyList) {
      if (buyEntry.ticker === normalizedSymbol && buyEntry.stopLoss?.orderId) {
        const orderId = buyEntry.stopLoss.orderId;
        // Only add if not already in the list
        if (!ordersToDelete.includes(orderId)) {
          ordersToDelete.push(orderId);
          console.log(`🔍 Found stop-loss order from buy list: ${orderId} (${normalizedSymbol})`);
        }
      }
    }
    
    if (ordersToDelete.length === 0) {
      console.log(`✅ No active SELL orders found for ${normalizedSymbol} (checked orders websocket)`);
      return {
        success: true,
        deleted: 0,
        failed: 0,
        results: []
      };
    }
    
    console.log(`🗑️ Deleting ${ordersToDelete.length} SELL order(s) for ${normalizedSymbol} (from orders websocket analysis)...`);
    
    const deletionResults = [];
    for (const orderId of ordersToDelete) {
      const result = await deleteOrder(orderId);
      deletionResults.push({ orderId, ...result });
      
      // Small delay between deletions to avoid rate limiting
      if (ordersToDelete.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const successful = deletionResults.filter(r => r.success).length;
    const failed = deletionResults.filter(r => !r.success).length;
    
    console.log(`✅ Deleted ${successful} SELL order(s) for ${normalizedSymbol}${failed > 0 ? `, ${failed} failed` : ''}`);
    
    return {
      success: successful > 0 || ordersToDelete.length === 0,
      deleted: successful,
      failed: failed,
      results: deletionResults
    };
  } catch (e) {
    console.error(`❌ Error deleting SELL orders for ${symbol}:`, e);
    return { success: false, error: e.message, deleted: 0, failed: 0, results: [] };
  }
}

// Get StopLimit status for all positions
app.get('/api/stoplimit/positions', requireAuth, (req, res) => {
  try {
    const positionsWithStopLimit = [];
    
    // Iterate through all positions
    for (const [symbol, position] of positionsCache.entries()) {
      const normalizedSymbol = symbol.toUpperCase();
      const quantity = parseFloat(position.Quantity || '0');
      
      if (quantity <= 0) continue; // Skip closed positions
      
      // Find StopLimit SELL order for this symbol (silent version - no debug logs)
      let stopLimit = null;
      for (const [oid, order] of ordersCache.entries()) {
        if (!order?.Legs?.length || !isActiveOrderStatus(order.Status)) continue;
        const ot = (order.OrderType || '').toUpperCase();
        if (ot !== 'STOPLIMIT' && ot !== 'STOP_LIMIT') continue;
        const leg = order.Legs[0];
        const legSymbol = (leg.Symbol || '').toUpperCase();
        const side = (leg.BuyOrSell || '').toUpperCase();
        if (legSymbol === normalizedSymbol && side === 'SELL') {
          const qty = parseInt(leg.QuantityRemaining || leg.QuantityOrdered || '0', 10) || 0;
          stopLimit = { orderId: oid, quantity: qty, order: order };
          break;
        }
      }
      
      positionsWithStopLimit.push({
        symbol: normalizedSymbol,
        positionId: position.PositionID || null,
        quantity: quantity,
        averagePrice: parseFloat(position.AveragePrice || '0') || 0,
        lastPrice: parseFloat(position.Last || '0') || 0,
        unrealizedPL: parseFloat(position.UnrealizedProfitLoss || '0') || 0,
        hasStopLimit: !!stopLimit,
        stopLimitOrderId: stopLimit?.orderId || null,
        stopLimitQuantity: stopLimit?.quantity || 0,
        stopLimitStatus: stopLimit?.order?.Status || null,
        stopPrice: stopLimit?.order?.StopPrice || null,
        limitPrice: stopLimit?.order?.LimitPrice || null
      });
    }
    
    res.json({
      success: true,
      data: positionsWithStopLimit
    });
  } catch (e) {
    console.error('Error getting StopLimit positions:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Cancel/Remove StopLimit order for a symbol
app.delete('/api/stoplimit/positions/:symbol', requireAuth, async (req, res) => {
  try {
    const symbol = (req.params.symbol || '').toString().trim().toUpperCase();
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Missing symbol' });
    }
    
    console.log(`🗑️ Removing StopLimit for ${symbol}...`);
    
    // Find existing StopLimit order
    const stopLimit = findExistingStopLimitSellForSymbol(symbol);
    
    if (!stopLimit) {
      return res.json({
        success: true,
        message: `No active StopLimit found for ${symbol}`,
        data: { symbol, cancelled: false }
      });
    }
    
    // Cancel the StopLimit order
    const result = await deleteOrder(stopLimit.orderId);
    
    if (result.success) {
      console.log(`✅ StopLimit order ${stopLimit.orderId} cancelled for ${symbol}`);
      // Remove from repository
      stopLimitOrderRepository.delete(symbol);
      return res.json({
        success: true,
        message: `StopLimit order cancelled for ${symbol}`,
        data: {
          symbol,
          orderId: stopLimit.orderId,
          cancelled: true
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error || `Failed to cancel StopLimit order for ${symbol}`,
        data: { symbol, orderId: stopLimit.orderId, cancelled: false }
      });
    }
  } catch (e) {
    console.error(`Error removing StopLimit for ${req.params.symbol}:`, e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get order status by order_id (for manual buy tracking: ACK, DON, FLL, REJ)
app.get('/api/orders/:orderId/status', requireAuth, (req, res) => {
  try {
    const orderId = (req.params.orderId || '').trim();
    if (!orderId) return res.status(400).json({ success: false, error: 'Missing order ID' });
    const cached = ordersCache.get(orderId);
    if (cached) {
      const symbol = cached.Legs?.[0]?.Symbol || null;
      return res.json({
        success: true,
        data: { orderId, status: cached.Status || null, symbol, tracked: false }
      });
    }
    const pending = pendingManualBuyOrders.get(orderId);
    if (pending) {
      return res.json({
        success: true,
        data: { orderId, status: 'PENDING', symbol: pending.symbol, quantity: pending.quantity, tracked: true }
      });
    }
    return res.status(404).json({ success: false, error: 'Order not found', data: { orderId } });
  } catch (e) {
    console.error('Error getting order status:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Test endpoint: Simulate sell → buy scenario to test StopLimit creation after sell
app.post('/api/debug/stoplimit/test-sell-buy', requireAuth, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing symbol' 
      });
    }
    
    const normalizedSymbol = (symbol || '').toUpperCase();
    
    console.log(`🧪 [TEST] Testing sell → buy scenario for ${normalizedSymbol}...`);
    
    // Step 1: Simulate manual sell cleanup
    console.log(`🧪 [TEST] Step 1: Simulating manual sell cleanup...`);
    const beforeSellState = {
      inTracking: stopLimitOrderIdsBySymbol.get(normalizedSymbol) || null,
      inPending: pendingStopLimitOrderIds.get(normalizedSymbol) || null,
      inProgress: stopLimitCreationBySymbol.has(normalizedSymbol),
      recentlySold: recentlySoldSymbols.get(normalizedSymbol) || null,
      positionExists: positionsCache.has(normalizedSymbol),
      existingStopLimit: findExistingStopLimitSellForSymbol(normalizedSymbol)
    };
    
    // Simulate sell cleanup
    stopLimitOrderIdsBySymbol.delete(normalizedSymbol);
    pendingStopLimitOrderIds.delete(normalizedSymbol);
    stopLimitCreationBySymbol.delete(normalizedSymbol);
    recentlySoldSymbols.set(normalizedSymbol, Date.now());
    
    // Clean up cancelled orders from cache
    for (const [orderId, cachedOrder] of ordersCache.entries()) {
      if (!cachedOrder?.Legs?.length) continue;
      const orderType = (cachedOrder.OrderType || '').toUpperCase();
      if (orderType !== 'STOPLIMIT' && orderType !== 'STOP_LIMIT') continue;
      
      const leg = cachedOrder.Legs[0];
      const legSymbol = (leg.Symbol || '').toUpperCase();
      const legSide = (leg.BuyOrSell || '').toUpperCase();
      if (legSymbol === normalizedSymbol && legSide === 'SELL') {
        const cachedStatus = (cachedOrder.Status || '').toUpperCase();
        if (['CAN', 'FIL', 'FLL', 'EXP', 'REJ'].includes(cachedStatus)) {
          ordersCache.delete(orderId);
        }
      }
    }
    
    const afterSellState = {
      inTracking: stopLimitOrderIdsBySymbol.get(normalizedSymbol) || null,
      inPending: pendingStopLimitOrderIds.get(normalizedSymbol) || null,
      inProgress: stopLimitCreationBySymbol.has(normalizedSymbol),
      recentlySold: recentlySoldSymbols.get(normalizedSymbol) || null,
      existingStopLimit: findExistingStopLimitSellForSymbol(normalizedSymbol)
    };
    
    console.log(`🧪 [TEST] State after sell cleanup:`, JSON.stringify(afterSellState, null, 2));
    
    // Step 2: Simulate buy (position created)
    console.log(`🧪 [TEST] Step 2: Simulating position creation (buy)...`);
    
    // Simulate position being created (in real scenario, this happens via WebSocket)
    // For test, we add it to cache
    positionsCache.set(normalizedSymbol, {
      Symbol: normalizedSymbol,
      Quantity: '100',
      AveragePrice: '3.19',
      lastUpdated: Date.now()
    });
    
    // Check if recently sold would block
    const recentlySoldTimestamp = recentlySoldSymbols.get(normalizedSymbol);
    const timeSinceSold = recentlySoldTimestamp ? Date.now() - recentlySoldTimestamp : null;
    const wouldBlock = recentlySoldTimestamp && timeSinceSold < 15000;
    
    // Step 3: Simulate buy fill (what would happen in handleManualBuyFilled)
    console.log(`🧪 [TEST] Step 3: Simulating buy fill and StopLimit creation check...`);
    
    // Check what handleManualBuyFilled would do
    const wouldCreateStopLimit = !wouldBlock && !findExistingStopLimitSellForSymbol(normalizedSymbol);
    
    const afterBuyState = {
      inTracking: stopLimitOrderIdsBySymbol.get(normalizedSymbol) || null,
      inPending: pendingStopLimitOrderIds.get(normalizedSymbol) || null,
      inProgress: stopLimitCreationBySymbol.has(normalizedSymbol),
      recentlySold: recentlySoldSymbols.get(normalizedSymbol) || null,
      positionExists: positionsCache.has(normalizedSymbol),
      positionQuantity: positionsCache.get(normalizedSymbol)?.Quantity || 0,
      existingStopLimit: findExistingStopLimitSellForSymbol(normalizedSymbol)
    };
    
    // Cleanup test data
    positionsCache.delete(normalizedSymbol);
    
    res.json({
      success: true,
      data: {
        symbol: normalizedSymbol,
        beforeSell: beforeSellState,
        afterSell: afterSellState,
        afterBuy: afterBuyState,
        test: {
          recentlySoldTracking: recentlySoldTimestamp ? `Set ${timeSinceSold}ms ago` : 'Not set',
          wouldBlockCreation: wouldBlock,
          wouldCreateStopLimit: wouldCreateStopLimit,
          message: wouldBlock 
            ? '✅ Recently sold tracking would prevent StopLimit creation (prevents loops)'
            : wouldCreateStopLimit
              ? '✅ Would create StopLimit (no existing order, not recently sold)'
              : '✅ Would not create StopLimit (existing order found or recently sold)',
          verdict: wouldBlock || !wouldCreateStopLimit
            ? '✅ PASS - No loop would occur'
            : '❌ FAIL - Loop might occur'
        }
      }
    });
  } catch (e) {
    console.error('Error in sell-buy test:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// StopLimit Tracker Configuration API
app.get('/api/stoplimit-tracker/config', requireAuth, (req, res) => {
  try {
    const config = Array.from(stopLimitTrackerConfig.entries()).map(([groupId, group]) => ({
      groupId,
      ...group
    }));
    res.json({ success: true, data: config });
  } catch (e) {
    console.error('Error getting StopLimit tracker config:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/stoplimit-tracker/config', requireAuth, async (req, res) => {
  try {
    const { groups } = req.body;
    
    if (!Array.isArray(groups)) {
      return res.status(400).json({ success: false, error: 'Groups must be an array' });
    }
    
    // Clear existing config
    stopLimitTrackerConfig.clear();
    
    // Add new groups
    groups.forEach((group, index) => {
      const groupId = group.groupId || `group_${Date.now()}_${index}`;
      const minPrice = parseFloat(group.minPrice || '0');
      const maxPrice = parseFloat(group.maxPrice || '999999');
      const initialStopPrice = parseFloat(group.initialStopPrice || '0');
      const enabled = group.enabled !== false;
      const steps = Array.isArray(group.steps) ? group.steps.map(step => ({
        pnl: parseFloat(step.pnl || '0'),
        stop: parseFloat(step.stop || '0')
      })) : [];
      
      stopLimitTrackerConfig.set(groupId, {
        minPrice,
        maxPrice,
        initialStopPrice,
        steps,
        enabled
      });
    });
    
    // Save to MongoDB
    await saveStopLimitTrackerConfigToDb();
    
    console.log(`✅ StopLimit tracker config updated: ${groups.length} group(s)`);
    res.json({ success: true, data: { groups: groups.length } });
  } catch (e) {
    console.error('Error saving StopLimit tracker config:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/stoplimit-tracker/progress', requireAuth, (req, res) => {
  try {
    const progress = Array.from(stopLimitTrackerProgress.entries()).map(([symbol, data]) => ({
      symbol,
      ...data
    }));
    res.json({ success: true, data: progress });
  } catch (e) {
    console.error('Error getting StopLimit tracker progress:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Test endpoint: Simulate rebuy scenario to test StopLimit update
app.post('/api/debug/stoplimit/test-rebuy', requireAuth, async (req, res) => {
  try {
    const { symbol, orderId, fillPrice, quantity, existingStopLimitId } = req.body;
    if (!symbol || !orderId || !fillPrice || !quantity) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: symbol, orderId, fillPrice, quantity' 
      });
    }
    
    const normalizedSymbol = (symbol || '').toUpperCase();
    
    console.log(`🧪 [TEST] Testing rebuy scenario for ${normalizedSymbol}...`);
    
    // Check initial state
    const initialState = {
      inTracking: stopLimitOrderIdsBySymbol.get(normalizedSymbol) || null,
      inPending: pendingStopLimitOrderIds.get(normalizedSymbol) || null,
      inProgress: stopLimitCreationBySymbol.has(normalizedSymbol),
      positionExists: positionsCache.has(normalizedSymbol),
      positionQuantity: positionsCache.get(normalizedSymbol)?.Quantity || 0,
      existingStopLimit: findExistingStopLimitSellForSymbol(normalizedSymbol)
    };
    
    console.log(`🧪 [TEST] Initial state:`, JSON.stringify(initialState, null, 2));
    
    // Create mock order and pending
    const mockOrder = {
      OrderID: orderId,
      Status: 'FLL',
      OrderType: 'Limit',
      FilledPrice: fillPrice,
      LimitPrice: fillPrice,
      Legs: [{
        Symbol: normalizedSymbol,
        BuyOrSell: 'BUY',
        QuantityOrdered: quantity,
        ExecQuantity: quantity
      }]
    };
    
    const mockPending = {
      symbol: normalizedSymbol,
      quantity: quantity,
      limitPrice: fillPrice
    };
    
    // Simulate the call
    await handleManualBuyFilled(orderId, mockOrder, mockPending);
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check state after
    const afterState = {
      inTracking: stopLimitOrderIdsBySymbol.get(normalizedSymbol) || null,
      inPending: pendingStopLimitOrderIds.get(normalizedSymbol) || null,
      inProgress: stopLimitCreationBySymbol.has(normalizedSymbol),
      positionExists: positionsCache.has(normalizedSymbol),
      positionQuantity: positionsCache.get(normalizedSymbol)?.Quantity || 0,
      existingStopLimit: findExistingStopLimitSellForSymbol(normalizedSymbol)
    };
    
    console.log(`🧪 [TEST] State after:`, JSON.stringify(afterState, null, 2));
    
    // Verify results
    const wasUpdated = initialState.existingStopLimit && 
                       afterState.existingStopLimit && 
                       initialState.existingStopLimit.orderId === afterState.existingStopLimit.orderId;
    const wasCreated = !initialState.existingStopLimit && afterState.existingStopLimit;
    const hasDuplicate = initialState.existingStopLimit && 
                        afterState.existingStopLimit && 
                        initialState.existingStopLimit.orderId !== afterState.existingStopLimit.orderId;
    
    res.json({
      success: true,
      data: {
        symbol: normalizedSymbol,
        initial: initialState,
        after: afterState,
        test: {
          wasUpdated,
          wasCreated,
          hasDuplicate,
          message: hasDuplicate 
            ? '❌ DUPLICATE DETECTED - Multiple StopLimit orders exist!'
            : wasUpdated 
              ? '✅ StopLimit was updated correctly'
              : wasCreated
                ? '✅ New StopLimit was created correctly'
                : '⚠️ No StopLimit found - may need investigation'
        }
      }
    });
  } catch (e) {
    console.error('Error in rebuy test:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Test endpoint: Simulate buy → sell → buy scenario
app.post('/api/debug/stoplimit/test-buy-sell-buy', requireAuth, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing symbol' 
      });
    }
    
    const normalizedSymbol = (symbol || '').toUpperCase();
    
    console.log(`🧪 [TEST] Testing buy → sell → buy scenario for ${normalizedSymbol}...`);
    
    // Step 1: Check initial state
    const initialState = {
      inTracking: stopLimitOrderIdsBySymbol.get(normalizedSymbol) || null,
      inPending: pendingStopLimitOrderIds.get(normalizedSymbol) || null,
      inProgress: stopLimitCreationBySymbol.has(normalizedSymbol),
      positionExists: positionsCache.has(normalizedSymbol),
      positionQuantity: positionsCache.get(normalizedSymbol)?.Quantity || 0,
      existingStopLimit: findExistingStopLimitSellForSymbol(normalizedSymbol)
    };
    
    console.log(`🧪 [TEST] Initial state:`, JSON.stringify(initialState, null, 2));
    
    // Step 2: Simulate manual sell cleanup
    console.log(`🧪 [TEST] Simulating manual sell cleanup...`);
    stopLimitOrderIdsBySymbol.delete(normalizedSymbol);
    pendingStopLimitOrderIds.delete(normalizedSymbol);
    stopLimitCreationBySymbol.delete(normalizedSymbol);
    
    // Step 3: Check state after cleanup
    const afterCleanupState = {
      inTracking: stopLimitOrderIdsBySymbol.get(normalizedSymbol) || null,
      inPending: pendingStopLimitOrderIds.get(normalizedSymbol) || null,
      inProgress: stopLimitCreationBySymbol.has(normalizedSymbol),
      existingStopLimit: findExistingStopLimitSellForSymbol(normalizedSymbol)
    };
    
    console.log(`🧪 [TEST] State after cleanup:`, JSON.stringify(afterCleanupState, null, 2));
    
    // Step 4: Verify cleanup was successful
    const cleanupSuccessful = 
      !afterCleanupState.inTracking && 
      !afterCleanupState.inPending && 
      !afterCleanupState.inProgress &&
      !afterCleanupState.existingStopLimit;
    
    res.json({
      success: true,
      data: {
        symbol: normalizedSymbol,
        initial: initialState,
        afterCleanup: afterCleanupState,
        cleanupSuccessful,
        message: cleanupSuccessful 
          ? '✅ Cleanup successful - no stale StopLimit references remain'
          : '⚠️ Cleanup incomplete - stale references may still exist'
      }
    });
  } catch (e) {
    console.error('Error in buy-sell-buy test:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Test endpoint: Simulate buy fill to test StopLimit logic
app.post('/api/debug/stoplimit/test', requireAuth, async (req, res) => {
  try {
    const { symbol, orderId, fillPrice, quantity } = req.body;
    if (!symbol || !orderId || !fillPrice || !quantity) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: symbol, orderId, fillPrice, quantity' 
      });
    }
    
    const normalizedSymbol = (symbol || '').toUpperCase();
    const mockOrder = {
      OrderID: orderId,
      Status: 'FLL',
      OrderType: 'Limit',
      FilledPrice: fillPrice,
      LimitPrice: fillPrice,
      Legs: [{
        Symbol: normalizedSymbol,
        BuyOrSell: 'BUY',
        QuantityOrdered: quantity,
        ExecQuantity: quantity
      }]
    };
    
    const mockPending = {
      symbol: normalizedSymbol,
      quantity: quantity,
      limitPrice: fillPrice
    };
    
    console.log(`🧪 [TEST] Simulating buy fill for ${normalizedSymbol}...`);
    console.log(`🧪 [TEST] Mock order:`, JSON.stringify(mockOrder, null, 2));
    console.log(`🧪 [TEST] Mock pending:`, JSON.stringify(mockPending, null, 2));
    
    // Check current state
    const beforeState = {
      inTracking: stopLimitOrderIdsBySymbol.get(normalizedSymbol) || null,
      inPending: pendingStopLimitOrderIds.get(normalizedSymbol) || null,
      inProgress: stopLimitCreationBySymbol.has(normalizedSymbol),
      existingInCache: findExistingStopLimitSellForSymbol(normalizedSymbol)
    };
    
    console.log(`🧪 [TEST] State before:`, JSON.stringify(beforeState, null, 2));
    
    // Simulate the call
    await handleManualBuyFilled(orderId, mockOrder, mockPending);
    
    // Check state after
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for async operations
    
    const afterState = {
      inTracking: stopLimitOrderIdsBySymbol.get(normalizedSymbol) || null,
      inPending: pendingStopLimitOrderIds.get(normalizedSymbol) || null,
      inProgress: stopLimitCreationBySymbol.has(normalizedSymbol),
      existingInCache: findExistingStopLimitSellForSymbol(normalizedSymbol)
    };
    
    console.log(`🧪 [TEST] State after:`, JSON.stringify(afterState, null, 2));
    
    res.json({
      success: true,
      data: {
        before: beforeState,
        after: afterState,
        test: {
          symbol: normalizedSymbol,
          orderId,
          fillPrice,
          quantity
        }
      }
    });
  } catch (e) {
    console.error('Error in StopLimit test:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Debug endpoint: View StopLimit tracking state (using repository pattern)
app.get('/api/debug/stoplimit', requireAuth, (req, res) => {
  try {
    // Repository entries (single source of truth)
    const repositoryMap = Array.from(stopLimitOrderRepository.entries()).map(([symbol, repoEntry]) => {
      const order = ordersCache.get(repoEntry.orderId);
      return {
        symbol,
        orderId: repoEntry.orderId,
        status: order?.Status || repoEntry.status || 'NOT_IN_CACHE',
        orderType: order?.OrderType || 'UNKNOWN',
        quantity: order?.Legs?.[0]?.QuantityRemaining || order?.Legs?.[0]?.QuantityOrdered || 0,
        isActive: order ? isActiveOrderStatus(order.Status) : false,
        openedDateTime: repoEntry.openedDateTime
      };
    });
    
    const inProgressSymbols = Array.from(stopLimitCreationBySymbol);
    const inProgressOrders = Array.from(stopLimitCreationInProgress);
    
    // Find all StopLimit orders in cache
    const allStopLimits = [];
    for (const [orderId, order] of ordersCache.entries()) {
      const orderType = (order?.OrderType || '').toUpperCase();
      if (orderType === 'STOPLIMIT' || orderType === 'STOP_LIMIT') {
        const leg = order.Legs?.[0];
        const side = (leg?.BuyOrSell || '').toUpperCase();
        if (side === 'SELL') {
          const symbol = (leg?.Symbol || '').toUpperCase();
          const repoEntry = stopLimitOrderRepository.get(symbol);
          allStopLimits.push({
            orderId,
            symbol: leg?.Symbol || 'UNKNOWN',
            status: order.Status || 'UNKNOWN',
            quantity: leg?.QuantityRemaining || leg?.QuantityOrdered || 0,
            isActive: isActiveOrderStatus(order.Status),
            inRepository: repoEntry && repoEntry.orderId === orderId
          });
        }
      }
    }
    
    res.json({
      success: true,
      data: {
        repositoryMap,
        inProgressSymbols,
        inProgressOrders,
        recentlySoldMap: Array.from(recentlySoldSymbols.entries()).map(([symbol, timestamp]) => ({
          symbol,
          timestamp,
          age: Date.now() - timestamp,
          ageSeconds: Math.floor((Date.now() - timestamp) / 1000)
        })),
        allStopLimitsInCache: allStopLimits,
        stats: {
          repositoryCount: repositoryMap.length,
          inProgressSymbolsCount: inProgressSymbols.length,
          inProgressOrdersCount: inProgressOrders.length,
          recentlySoldCount: recentlySoldSymbols.size,
          totalStopLimitsInCache: allStopLimits.length
        }
      }
    });
  } catch (e) {
    console.error('Error getting StopLimit debug info:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Debug endpoint: View pending manual buy orders and recent order activity
app.get('/api/debug/manual-buys', requireAuth, (req, res) => {
  try {
    const pending = Array.from(pendingManualBuyOrders.entries()).map(([orderId, data]) => ({
      orderId,
      symbol: data.symbol,
      quantity: data.quantity,
      limitPrice: data.limitPrice
    }));

    // Get recent orders from cache that might be related to manual buys
    const recentOrders = Array.from(ordersCache.entries())
      .filter(([oid, order]) => {
        const symbol = order.Legs?.[0]?.Symbol;
        return symbol && (pendingManualBuyOrders.has(oid) || 
               pending.some(p => p.symbol === symbol && order.Legs?.[0]?.BuyOrSell?.toUpperCase() === 'BUY'));
      })
      .slice(0, 50)
      .map(([orderId, order]) => {
        const leg = order.Legs?.[0];
        return {
          orderId,
          symbol: leg?.Symbol || 'UNKNOWN',
          side: leg?.BuyOrSell || 'UNKNOWN',
          status: order.Status || 'UNKNOWN',
          orderType: order.OrderType || 'UNKNOWN',
          quantity: leg?.QuantityOrdered || leg?.QuantityRemaining || 0,
          filledPrice: order.FilledPrice || null,
          limitPrice: order.LimitPrice || null,
          isTracked: pendingManualBuyOrders.has(orderId),
          lastUpdated: order.lastUpdated || null
        };
      });

    // Get StopLimit SELL orders
    const stopLimitSells = Array.from(ordersCache.entries())
      .filter(([oid, order]) => {
        const ot = (order.OrderType || '').toUpperCase();
        return (ot === 'STOPLIMIT' || ot === 'STOP_LIMIT') && 
               order.Legs?.[0]?.BuyOrSell?.toUpperCase() === 'SELL' &&
               isActiveOrderStatus(order.Status);
      })
      .map(([orderId, order]) => {
        const leg = order.Legs?.[0];
        return {
          orderId,
          symbol: leg?.Symbol || 'UNKNOWN',
          status: order.Status,
          quantity: parseInt(leg?.QuantityRemaining || leg?.QuantityOrdered || '0', 10) || 0,
          stopPrice: order.StopPrice || null,
          limitPrice: order.LimitPrice || null
        };
      });

    res.json({
      success: true,
      data: {
        pendingManualBuys: pending,
        pendingCount: pending.length,
        recentOrders: recentOrders,
        stopLimitSells: stopLimitSells,
        ordersCacheSize: ordersCache.size,
        lastOrderUpdateTime: lastOrderUpdateTime ? new Date(lastOrderUpdateTime).toISOString() : null
      }
    });
  } catch (e) {
    console.error('Error in debug endpoint:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Delete order endpoint - cancels an order by order_id
// According to Sections Bot API: DELETE /order/{order_id}
app.delete('/api/orders/:orderId', requireDbReady, requireAuth, async (req, res) => {
  try {
    const orderId = req.params.orderId?.trim();
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Missing order ID' });
    }
    
    console.log(`🗑️ Deleting order: ${orderId}`);
    
    const result = await deleteOrder(orderId);
    
    if (result.success) {
      return res.status(200).json({ 
        success: true, 
        message: `Order ${orderId} deleted successfully`,
        data: { orderId, status: result.status }
      });
    } else {
      return res.status(400).json({ 
        success: false, 
        error: result.error || `Failed to delete order ${orderId}`,
        data: { orderId, status: result.status }
      });
    }
  } catch (e) {
    console.error(`❌ Error deleting order ${req.params.orderId}:`, e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Individual sell endpoint - sells a single position
// According to Sections Bot API: POST /order with symbol, side, order_type, and quantity only (no price)
app.post('/api/sell', requireDbReady, requireAuth, async (req, res) => {
  try {
    const symbol = (req.body?.symbol || '').toString().trim().toUpperCase();
    const quantity = parseInt(req.body?.quantity || '0', 10);
    // Validate and normalize order_type: permitted values are Limit, Market, StopLimit
    const rawOrderType = (req.body?.order_type || 'Limit').toString().trim();
    // Normalize common variations to valid values
    const normalizedInput = rawOrderType.toLowerCase();
    let orderType = 'Limit'; // default
    if (normalizedInput === 'limit') {
      orderType = 'Limit';
    } else if (normalizedInput === 'market') {
      orderType = 'Market';
    } else if (normalizedInput === 'stoplimit' || normalizedInput === 'stop_limit' || normalizedInput === 'stop-limit') {
      // CRITICAL: StopLimit logic is DISABLED - reject stop-limit orders
      if (!STOPLIMIT_ENABLED) {
        console.log(`⏸️ [STOPLIMIT] StopLimit creation is DISABLED - rejecting stop-limit order request for ${symbol}`);
        return res.status(400).json({ 
          success: false, 
          error: 'StopLimit order creation is currently disabled' 
        });
      }
      orderType = 'StopLimit';
    }
    const longShort = (req.body?.long_short || req.body?.longShort || '').toString().trim();
    
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Missing symbol' });
    }
    
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ success: false, error: 'Missing or invalid quantity' });
    }
    
    // Determine side: for Long positions, SELL to close; for Short positions, BUY to close
    const isLong = longShort.toLowerCase() === 'long';
    const side = isLong ? 'SELL' : 'BUY';
    const action = isLong ? 'sell' : 'close (buy back)';
    
    console.log(`💸 Manual ${action} signal for ${quantity} ${symbol} (${orderType}, ${side})`);
    
    // CRITICAL: Ensure only one active sell order exists for this position
    // Cancel any existing sell orders (StopLimit or Limit) before placing the new one
    // Only one SELL order can be active per stock at a time
    if (side === 'SELL') {
      console.log(`🧹 Manual Sell from P&L: Checking for existing sell orders for ${symbol}...`);
      
      // CRITICAL: Cancel StopLimit order if it exists for this symbol (using repository pattern)
      const normalizedSymbol = symbol.toUpperCase();
      const stopLimit = getActiveStopLimitOrder(normalizedSymbol);
      
      if (stopLimit && stopLimit.orderId) {
        const stopLimitOrderId = stopLimit.orderId;
        console.log(`🛑 Cancelling StopLimit order ${stopLimitOrderId} for ${normalizedSymbol} before manual sell...`);
        try {
          const cancelResp = await fetch(`https://sections-bot.inbitme.com/order/${encodeURIComponent(stopLimitOrderId)}`, {
            method: 'DELETE',
            headers: { 'Accept': '*/*' }
          });
          if (cancelResp.ok || cancelResp.status === 200 || cancelResp.status === 204 || cancelResp.status === 404) {
            console.log(`✅ StopLimit order ${stopLimitOrderId} cancelled successfully for ${normalizedSymbol}`);
            // Remove from repository IMMEDIATELY
            stopLimitOrderRepository.delete(normalizedSymbol);
            stopLimitCreationBySymbol.delete(normalizedSymbol);
        console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (after creation)`); // Also remove from in-progress
            // Remove from cache
            ordersCache.delete(stopLimitOrderId);
            if (cachePersistenceService) {
              cachePersistenceService.scheduleOrderSave(stopLimitOrderId);
            }
            console.log(`🗑️ [STOPLIMIT_REPO] Removed StopLimit order for ${normalizedSymbol} from repository`);
          } else {
            console.warn(`⚠️ Failed to cancel StopLimit order ${stopLimitOrderId} for ${normalizedSymbol} (HTTP ${cancelResp.status})`);
            // Even if cancellation failed, remove from repository to prevent loops
            stopLimitOrderRepository.delete(normalizedSymbol);
            stopLimitCreationBySymbol.delete(normalizedSymbol);
        console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (after creation)`);
          }
        } catch (cancelErr) {
          console.error(`❌ Error cancelling StopLimit order ${stopLimitOrderId} for ${normalizedSymbol}:`, cancelErr.message);
          // Even on error, remove from repository to prevent loops
          stopLimitOrderRepository.delete(normalizedSymbol);
          stopLimitCreationBySymbol.delete(normalizedSymbol);
        console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (after creation)`);
        }
      } else {
        console.log(`ℹ️ No active StopLimit order found in repository for ${normalizedSymbol}`);
        // Clean up repository and in-progress flags
        stopLimitOrderRepository.delete(normalizedSymbol);
        stopLimitCreationBySymbol.delete(normalizedSymbol);
        console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (after creation)`);
      }
      
      // Helper function to find active sell orders in the global orders cache
      const findActiveSellOrdersInCache = (symbol) => {
        const normalized = symbol.toUpperCase();
        const activeOrders = [];
        
        // Active order statuses that can be cancelled
        const activeStatuses = new Set(['ACK', 'DON', 'REC', 'QUE', 'QUEUED', 'OPEN', 'NEW', 'PENDING', 'PARTIALLY_FILLED', 'PND']);
        // Terminal statuses that cannot be cancelled
        const terminalStatuses = new Set(['FIL', 'FLL', 'CAN', 'EXP', 'REJ', 'OUT', 'CANCELLED', 'FILLED', 'REJECTED', 'EXPIRED']);
        
        for (const [orderId, order] of ordersCache.entries()) {
          if (!order || !order.Legs) continue;
          const status = (order.Status || '').toUpperCase();
          
          // Skip terminal statuses
          if (terminalStatuses.has(status)) continue;
          
          // Include if it's an active status OR if status is unknown (better to try cancelling than miss it)
          const isActive = activeStatuses.has(status) || !status || status === '';
          
          if (!isActive) continue;
          
          // Check if it's a SELL order for this symbol
          for (const leg of order.Legs) {
            const legSymbol = (leg.Symbol || '').toUpperCase();
            const legSide = (leg.BuyOrSell || '').toUpperCase();
            if (legSymbol === normalized && legSide === 'SELL') {
              activeOrders.push({ orderId, status, order });
              break;
            }
          }
        }
        
        return activeOrders;
      };
      
      // Helper function to cancel an order directly via API
      const cancelOrderDirectly = async (orderId) => {
        try {
          console.log(`🗑️ Attempting to cancel order ${orderId}...`);
          const resp = await fetch(`https://sections-bot.inbitme.com/order/${encodeURIComponent(orderId)}`, {
            method: 'DELETE',
            headers: {
              'Accept': '*/*'
            }
          });
          
          const statusCode = resp.status;
          const isSuccess = resp.ok || statusCode === 200 || statusCode === 204;
          
          if (isSuccess) {
            console.log(`✅ Successfully cancelled order ${orderId} (HTTP ${statusCode})`);
            // Remove from cache if it exists
            if (ordersCache.has(orderId)) {
              ordersCache.delete(orderId);
              // Schedule save to database (to delete from DB)
              if (cachePersistenceService) {
                cachePersistenceService.scheduleOrderSave(orderId);
              }
              console.log(`🗑️ Removed order ${orderId} from cache`);
            }
            return true;
          } else {
            const text = await resp.text().catch(() => '');
            // Some APIs return 404 if order doesn't exist - that's also success for our purposes
            if (statusCode === 404) {
              console.log(`✅ Order ${orderId} not found (likely already cancelled) - treating as success`);
              if (ordersCache.has(orderId)) {
                ordersCache.delete(orderId);
                // Schedule save to database (to delete from DB)
                if (cachePersistenceService) {
                  cachePersistenceService.scheduleOrderSave(orderId);
                }
              }
              return true;
            }
            console.warn(`⚠️ Failed to cancel order ${orderId}: HTTP ${statusCode} - ${text}`);
            return false;
          }
        } catch (err) {
          console.error(`❌ Error cancelling order ${orderId}:`, err.message);
          return false;
        }
      };
      
      // CRITICAL: Cancel all active sell orders BEFORE attempting to create a new one
      // This is essential to prevent API rejections due to conflicting orders
      let cancellationSuccessful = true;
      let cancellationError = null;
      
      try {
        // CRITICAL: Re-check for StopLimit orders one more time before general cancellation
        // This catches any StopLimit orders that might not have been found in the initial check
        // (e.g., if they were just added to cache via WebSocket)
        const additionalStopLimitCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
        if (additionalStopLimitCheck && additionalStopLimitCheck.orderId) {
          const stopLimitId = additionalStopLimitCheck.orderId;
          const stopLimitStatus = (additionalStopLimitCheck.order?.Status || '').toUpperCase();
          const isActive = isActiveOrderStatus(stopLimitStatus);
          const isPending = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(stopLimitStatus);
          
          if (isActive || isPending) {
            console.log(`🛑 [STOPLIMIT_REPO] Found additional StopLimit order ${stopLimitId} (status: ${stopLimitStatus}) - cancelling before general cleanup...`);
            try {
              const cancelResp = await fetch(`https://sections-bot.inbitme.com/order/${encodeURIComponent(stopLimitId)}`, {
                method: 'DELETE',
                headers: { 'Accept': '*/*' }
              });
              if (cancelResp.ok || cancelResp.status === 200 || cancelResp.status === 204 || cancelResp.status === 404) {
                console.log(`✅ Additional StopLimit order ${stopLimitId} cancelled successfully`);
                // Remove from repository (single source of truth)
                stopLimitOrderRepository.delete(normalizedSymbol);
                stopLimitCreationBySymbol.delete(normalizedSymbol);
        console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (after creation)`);
                ordersCache.delete(stopLimitId);
                if (cachePersistenceService) {
                  cachePersistenceService.scheduleOrderSave(stopLimitId);
                }
              }
            } catch (err) {
              console.error(`❌ Error cancelling additional StopLimit order ${stopLimitId}:`, err.message);
            }
            // Wait a bit for cancellation to propagate
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        // First, find all active sell orders in the global cache
        let activeSellOrders = findActiveSellOrdersInCache(symbol);
        console.log(`🔍 Found ${activeSellOrders.length} active sell order(s) for ${symbol} in orders cache`);
        
        // Log StopLimit orders specifically for debugging
        const stopLimitOrders = activeSellOrders.filter(o => {
          const ot = (o.order?.OrderType || '').toUpperCase();
          return ot === 'STOPLIMIT' || ot === 'STOP_LIMIT';
        });
        if (stopLimitOrders.length > 0) {
          console.log(`🛑 [DEBUG] Found ${stopLimitOrders.length} StopLimit order(s) in active sell orders:`, stopLimitOrders.map(o => `${o.orderId} (${o.status})`).join(', '));
        }
        
        // Cancel all active sell orders directly
        if (activeSellOrders.length > 0) {
          console.log(`🗑️ Cancelling ${activeSellOrders.length} active sell order(s) for ${symbol}...`);
          // Log each order being cancelled for debugging
          for (const order of activeSellOrders) {
            const orderType = (order.order?.OrderType || '').toUpperCase();
            const isStopLimit = orderType === 'STOPLIMIT' || orderType === 'STOP_LIMIT';
            console.log(`   - Order ${order.orderId} (Type: ${orderType}, Status: ${order.status})${isStopLimit ? ' [STOPLIMIT]' : ''}`);
          }
          
          const cancelResults = await Promise.allSettled(
            activeSellOrders.map(order => cancelOrderDirectly(order.orderId))
          );
          
          const successCount = cancelResults.filter(r => r.status === 'fulfilled' && r.value === true).length;
          const failedCount = cancelResults.length - successCount;
          console.log(`✅ Successfully cancelled ${successCount}/${activeSellOrders.length} orders${failedCount > 0 ? `, ${failedCount} failed` : ''}`);
          
          // Wait for cancellation to propagate - optimized wait times
          const hasAckOrders = activeSellOrders.some(o => (o.status || '').toUpperCase() === 'ACK');
          const waitTime = hasAckOrders ? 1500 : 800; // Reduced wait times for better responsiveness
          console.log(`⏳ Waiting ${waitTime}ms for cancellation to propagate${hasAckOrders ? ' (ACK orders detected)' : ''}...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        // Final check - verify no active orders remain (check all caches)
        // CRITICAL: Re-check the cache after waiting, as orders might have been re-added via WebSocket
        let finalCheck = findActiveSellOrdersInCache(symbol);
        
        if (finalCheck.length > 0) {
          console.warn(`⚠️ P&L Sell: ${finalCheck.length} active sell order(s) still exist after cancellation attempts. Retrying...`);
          // Log each remaining order for debugging
          for (const order of finalCheck) {
            console.log(`   - Order ${order.orderId} (Status: ${order.status})`);
          }
          
          // Retry cancellation for remaining orders with individual delays
          for (const order of finalCheck) {
            console.log(`🔄 Retrying cancellation for order ${order.orderId} (Status: ${order.status})...`);
            const cancelled = await cancelOrderDirectly(order.orderId);
            if (!cancelled) {
              console.warn(`⚠️ Failed to cancel order ${order.orderId} during retry`);
            } else {
              console.log(`✅ Successfully cancelled order ${order.orderId} during retry`);
            }
            await new Promise(resolve => setTimeout(resolve, 500)); // Longer delay between cancellations
          }
          
          // Wait after retry, especially for ACK orders - optimized
          const hasAckInRetry = finalCheck.some(o => (o.status || '').toUpperCase() === 'ACK');
          const retryWaitTime = hasAckInRetry ? 1500 : 1000; // Reduced wait times
          console.log(`⏳ Waiting ${retryWaitTime}ms after retry cancellation${hasAckInRetry ? ' (ACK orders detected)' : ''}...`);
          await new Promise(resolve => setTimeout(resolve, retryWaitTime));
          
          // Final verification - check all caches one more time
          let finalRemaining = findActiveSellOrdersInCache(symbol);
          
          if (finalRemaining.length > 0) {
            const errorMsg = `Cannot create new sell order: ${finalRemaining.length} active SELL order(s) still exist for ${symbol} after deletion attempts. Order IDs: ${finalRemaining.map(o => o.orderId).join(', ')}`;
            console.error(`❌ ${errorMsg}`);
            cancellationSuccessful = false;
            cancellationError = errorMsg;
            return res.status(400).json({
              success: false,
              error: errorMsg,
              data: {
                symbol,
                remainingOrders: finalRemaining.map(o => ({ orderId: o.orderId, status: o.status }))
              }
            });
          } else {
            console.log(`✅ All active SELL orders successfully cancelled for ${symbol} after retry`);
          }
        } else {
          console.log(`✅ Verified: No remaining active SELL orders for ${symbol}`);
        }
      } catch (cleanupErr) {
        console.error(`❌ P&L Sell: Critical error cleaning up existing orders for ${symbol}:`, cleanupErr);
        cancellationSuccessful = false;
        cancellationError = `Failed to cancel existing orders: ${cleanupErr.message}`;
        // Continue anyway - cancellation errors shouldn't block the sell attempt
        // The API will handle conflicts if orders still exist
      }
      
      // Log cancellation status
      if (!cancellationSuccessful && cancellationError) {
        console.warn(`⚠️ P&L Sell: Cancellation had issues for ${symbol}, but proceeding with sell attempt: ${cancellationError}`);
      }
      
      // CRITICAL: One final check right before placing the order to catch any orders that were re-added
      // This is especially important for ACK orders that might be re-added via WebSocket
      // Also specifically check for StopLimit orders one more time using repository
      const finalStopLimitCheck = getActiveStopLimitOrder(normalizedSymbol) || findExistingStopLimitSellForSymbol(normalizedSymbol);
      if (finalStopLimitCheck && finalStopLimitCheck.orderId) {
        const finalStopLimitId = finalStopLimitCheck.orderId;
        const finalStopLimitStatus = (finalStopLimitCheck.order?.Status || '').toUpperCase();
        const isActive = isActiveOrderStatus(finalStopLimitStatus);
        const isPending = ['ACK', 'DON', 'REC', 'QUE', 'QUEUED'].includes(finalStopLimitStatus);
        
        if (isActive || isPending) {
          console.warn(`🛑 [DEBUG] CRITICAL: Found StopLimit order ${finalStopLimitId} (status: ${finalStopLimitStatus}) right before placing sell order! Cancelling immediately...`);
          try {
            const cancelResp = await fetch(`https://sections-bot.inbitme.com/order/${encodeURIComponent(finalStopLimitId)}`, {
              method: 'DELETE',
              headers: { 'Accept': '*/*' }
            });
            if (cancelResp.ok || cancelResp.status === 200 || cancelResp.status === 204 || cancelResp.status === 404) {
              console.log(`✅ Final StopLimit order ${finalStopLimitId} cancelled successfully`);
              // Remove from repository (single source of truth)
              stopLimitOrderRepository.delete(normalizedSymbol);
              stopLimitCreationBySymbol.delete(normalizedSymbol);
        console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (after creation)`);
              ordersCache.delete(finalStopLimitId);
              if (cachePersistenceService) {
                cachePersistenceService.scheduleOrderSave(finalStopLimitId);
              }
            } else {
              console.error(`❌ Failed to cancel final StopLimit order ${finalStopLimitId} (HTTP ${cancelResp.status})`);
            }
          } catch (err) {
            console.error(`❌ Error cancelling final StopLimit order ${finalStopLimitId}:`, err.message);
          }
          // Wait for cancellation to propagate
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      let preOrderCheck = findActiveSellOrdersInCache(symbol);
      
      if (preOrderCheck.length > 0) {
        console.warn(`⚠️ P&L Sell: Found ${preOrderCheck.length} active sell order(s) right before placing new order. Cancelling immediately...`);
        // Check for StopLimit orders specifically
        const stopLimitInPreCheck = preOrderCheck.filter(o => {
          const ot = (o.order?.OrderType || '').toUpperCase();
          return ot === 'STOPLIMIT' || ot === 'STOP_LIMIT';
        });
        if (stopLimitInPreCheck.length > 0) {
          console.warn(`🛑 [DEBUG] CRITICAL: Found ${stopLimitInPreCheck.length} StopLimit order(s) in pre-order check!`, stopLimitInPreCheck.map(o => `${o.orderId} (${o.status})`).join(', '));
        }
        // Cancel all in parallel for speed
        await Promise.allSettled(
          preOrderCheck.map(order => {
            const orderType = (order.order?.OrderType || '').toUpperCase();
            const isStopLimit = orderType === 'STOPLIMIT' || orderType === 'STOP_LIMIT';
            console.log(`   - Order ${order.orderId} (Type: ${orderType}, Status: ${order.status})${isStopLimit ? ' [STOPLIMIT - CRITICAL]' : ''}`);
            return cancelOrderDirectly(order.orderId);
          })
        );
        // Reduced final wait
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // FINAL CLEANUP: Ensure StopLimit repository is completely cleared after manual sell
      // This prevents loops when rebuying the same stock
      const finalRepoCheck = stopLimitOrderRepository.get(normalizedSymbol);
      if (finalRepoCheck) {
        console.log(`🧹 [STOPLIMIT_REPO] Final cleanup: Removing StopLimit from repository for ${normalizedSymbol} after manual sell (order ${finalRepoCheck.orderId})`);
        stopLimitOrderRepository.delete(normalizedSymbol);
        stopLimitCreationBySymbol.delete(normalizedSymbol);
        console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (after creation)`);
        
        // CRITICAL: Mark symbol as recently sold to prevent StopLimit creation loops
        recentlySoldSymbols.set(normalizedSymbol, Date.now());
        console.log(`🏷️ [DEBUG] Marked ${normalizedSymbol} as recently sold after manual sell (timestamp: ${Date.now()})`);
      } else {
        // Even if no StopLimit was found, mark as recently sold to be safe
        recentlySoldSymbols.set(normalizedSymbol, Date.now());
        console.log(`🏷️ [DEBUG] Marked ${normalizedSymbol} as recently sold (no StopLimit found)`);
        // Also clean up in-progress flag
        stopLimitCreationBySymbol.delete(normalizedSymbol);
        console.log(`🔓 [DEBUG] Removed ${normalizedSymbol} from stopLimitCreationBySymbol guard (after creation)`);
      }
      
      // CRITICAL: Clean up any cancelled/filled StopLimit orders in cache for this symbol
      // This prevents finding stale orders when rebuying
      for (const [orderId, cachedOrder] of ordersCache.entries()) {
        if (!cachedOrder?.Legs?.length) continue;
        const orderType = (cachedOrder.OrderType || '').toUpperCase();
        if (orderType !== 'STOPLIMIT' && orderType !== 'STOP_LIMIT') continue;
        
        const leg = cachedOrder.Legs[0];
        const legSymbol = (leg.Symbol || '').toUpperCase();
        const legSide = (leg.BuyOrSell || '').toUpperCase();
        if (legSymbol === normalizedSymbol && legSide === 'SELL') {
          const cachedStatus = (cachedOrder.Status || '').toUpperCase();
          // Remove cancelled, filled, or rejected StopLimit orders
          if (['CAN', 'FIL', 'FLL', 'EXP', 'REJ'].includes(cachedStatus)) {
            console.log(`🗑️ [DEBUG] Removing stale StopLimit order ${orderId} from cache for ${normalizedSymbol} after manual sell (status: ${cachedStatus})`);
            ordersCache.delete(orderId);
            if (cachePersistenceService) {
              cachePersistenceService.scheduleOrderSave(orderId);
            }
          }
        }
      }
    }
    
    // CRITICAL: Block StopLimit orders if disabled
    if (orderType === 'StopLimit' && !STOPLIMIT_ENABLED) {
      console.log(`⏸️ [STOPLIMIT] StopLimit creation is DISABLED - rejecting stop-limit order request for ${symbol}`);
      return res.status(400).json({ 
        success: false, 
        error: 'StopLimit order creation is currently disabled' 
      });
    }
    
    // Build request body according to Sections Bot API documentation
    // https://inbitme.gitbook.io/sections-bot/xKy06Pb8j01LsqEnmSik/rest-api/ordenes
    const orderBody = {
      symbol: symbol,
      side: side,
      order_type: orderType,
      quantity: quantity
    };
    
    // CRITICAL: For StopLimit orders, calculate stop_price and limit_price from database config
    // Use the same logic as createStopLimitSellOrder() to ensure consistency
    if (orderType === 'StopLimit' && side === 'SELL') {
      // Get buy price from position (AveragePrice) or current price
      const position = positionsCache.get(symbol.toUpperCase());
      const buyPrice = position ? parseFloat(position.AveragePrice || position.Bid || position.Last || '0') : 0;
      const currentPrice = position ? parseFloat(position.Bid || position.Last || position.AveragePrice || '0') : buyPrice;
      const price = currentPrice > 0 ? currentPrice : buyPrice;
      
      if (buyPrice <= 0) {
        console.error(`❌ [STOPLIMIT] Cannot create StopLimit order for ${symbol}: No buy price found in position`);
        return res.status(400).json({ 
          success: false, 
          error: `Cannot create StopLimit order: No position found for ${symbol} or missing buy price` 
        });
      }
      
      // Check StopLimit tracker config from database FIRST (same logic as createStopLimitSellOrder)
      let useTrackerInitialStop = false;
      let trackerInitialStopPrice = 0;
      let matchedGroupId = null;
      
      for (const [groupId, group] of stopLimitTrackerConfig.entries()) {
        if (!group.enabled) continue;
        
        const buyPriceInRange = buyPrice >= group.minPrice && buyPrice <= group.maxPrice;
        const hasInitialStopPrice = group.initialStopPrice != null && group.initialStopPrice !== 0;
        
        if (buyPriceInRange && hasInitialStopPrice) {
          // initialStopPrice is an OFFSET from buy price
          trackerInitialStopPrice = buyPrice + group.initialStopPrice;
          useTrackerInitialStop = true;
          matchedGroupId = groupId;
          console.log(`✅ [STOPLIMIT] Using tracker config group ${groupId} for ${symbol}: stop_price offset ${group.initialStopPrice} (buy: $${buyPrice.toFixed(2)})`);
          break;
        }
      }
      
      // Calculate stop_price and limit_price
      let stopPrice, limitPrice;
      
      if (useTrackerInitialStop) {
        // Use tracker config values
        stopPrice = Math.max(0, trackerInitialStopPrice);
        limitPrice = Math.max(0, stopPrice / 1.002);
      } else {
        // Use default sections-buy-bot-main logic
        const adjustment = getPriceAdjustment(price);
        limitPrice = Math.max(0, price - adjustment);
        stopPrice = Math.max(0, limitPrice * 1.002);
        console.log(`⚠️ [STOPLIMIT] No matching tracker config for ${symbol} (buy: $${buyPrice.toFixed(2)}). Using default logic.`);
      }
      
      // Round to 2 decimal places
      stopPrice = Math.round(stopPrice * 100) / 100;
      limitPrice = Math.round(limitPrice * 100) / 100;
      
      // Add stop_price and limit_price to order body
      orderBody.stop_price = stopPrice;
      orderBody.limit_price = limitPrice;
      
      console.log(`📊 [STOPLIMIT] Calculated prices for ${symbol}: stop_price=$${stopPrice.toFixed(2)}, limit_price=$${limitPrice.toFixed(2)} (buy: $${buyPrice.toFixed(2)}, method: ${useTrackerInitialStop ? 'tracker_config' : 'default'})`);
    }
    
    // Send sell order to external service using POST /order
    let notifyStatus = '';
    let responseData = null;
    let errorMessage = null;
    
    try {
      console.log(`📤 Sending sell order to external API:`, JSON.stringify(orderBody, null, 2));
      
      const resp = await fetch('https://sections-bot.inbitme.com/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(orderBody)
      });
      
      notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
      
      // Try to get response body (both success and error cases)
      let responseText = '';
      try {
        responseText = await resp.text();
        if (responseText) {
          try {
            responseData = JSON.parse(responseText);
          } catch {
            // Not JSON, keep as text
            responseData = responseText;
          }
        }
      } catch (textErr) {
        console.error(`⚠️ Could not read response body:`, textErr.message);
      }
      
      if (resp.ok) {
        console.log(`✅ Sell order sent for ${symbol}: ${notifyStatus}`, responseData ? `Response: ${JSON.stringify(responseData)}` : '');
      } else {
        errorMessage = extractErrorMessage(responseData, responseText, resp.status, resp.statusText);
        console.error(`❌ Error selling ${symbol}:`, {
          status: notifyStatus,
          response: responseData,
          body: responseText,
          extractedError: errorMessage
        });
      }
    } catch (err) {
      notifyStatus = `ERROR: ${err.message}`;
      errorMessage = err.message;
      console.error(`❌ Network/Parse error selling ${symbol}:`, {
        message: err.message,
        stack: err.stack
      });
    }
    
    const isSuccess = notifyStatus.startsWith('200') || notifyStatus.startsWith('201');
    
    // Always return 200 with success flag, so frontend can handle API errors gracefully
    // Only return 500 if there was a network/parsing error (notifyStatus starts with "ERROR:")
    if (notifyStatus.startsWith('ERROR:')) {
      // This is a backend/network error, return 500
      return res.status(500).json({ 
        success: false, 
        error: errorMessage || `Failed to sell ${symbol}: Network or parsing error`,
        data: { symbol, quantity, orderType, notifyStatus, response: responseData } 
      });
    }

    // External API responded (even if error), return 200 with success flag
    return res.status(200).json({ 
      success: isSuccess, 
      error: !isSuccess ? (errorMessage || `Failed to sell ${symbol}`) : undefined,
      data: { symbol, quantity, orderType, notifyStatus, response: responseData } 
    });
  } catch (e) {
    console.error(`❌ Error in manual sell for ${req.body?.symbol}:`, e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Sell All endpoint - panic sell: cancels pending orders and sells everything
// According to Sections Bot API: https://inbitme.gitbook.io/sections-bot/xKy06Pb8j01LsqEnmSik/rest-api/ordenes
// POST /sell_all - No body required, returns 200 with no content on success
app.post('/api/sell_all', requireDbReady, requireAuth, async (req, res) => {
  try {
    console.log(`💸 Sell All: Executing panic sell (cancels orders & sells all positions)`);
    
    // Delete all existing SELL orders for all symbols before executing sell_all
    // Analyze orders websocket to find all symbols with active SELL orders (ACK, DON, REC, QUE, etc.)
    // This is the same logic as manual sell - analyze the orders websocket stream
    const symbolsWithSellOrders = new Set();
    
    // Check if orders websocket is connected and has data
    const isWebSocketConnected = ordersWs && ordersWs.readyState === WebSocket.OPEN;
    
    if (isWebSocketConnected && lastOrderUpdateTime !== null) {
      // Wait a brief moment to allow any pending websocket messages to be processed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Analyze orders from websocket cache to find all symbols with active SELL orders
      console.log(`📡 Analyzing orders websocket stream for all active SELL orders... (${ordersCache.size} orders in cache)`);
      
      for (const [orderId, order] of ordersCache.entries()) {
        // Check if order has legs with SELL orders
        if (order.Legs && Array.isArray(order.Legs)) {
          for (const leg of order.Legs) {
            const legSymbol = (leg.Symbol || '').toUpperCase();
            const buyOrSell = leg.BuyOrSell || '';
            
            // Check if this is a SELL order with an active status (ACK, DON, REC, QUE, etc.)
            if (legSymbol && buyOrSell.toUpperCase() === 'SELL') {
              if (isActiveOrderStatus(order.Status)) {
                symbolsWithSellOrders.add(legSymbol);
                console.log(`🔍 Found active SELL order for ${legSymbol}: ${orderId} (Status: ${order.Status})`);
              }
            }
          }
        }
      }
      
      console.log(`📊 Found ${symbolsWithSellOrders.size} symbol(s) with active SELL orders:`, Array.from(symbolsWithSellOrders));
    } else {
      console.warn(`⚠️ Orders websocket not connected or no data - will only check buyList for stop-loss orders`);
      
      // Fallback: collect symbols from buy list that have stop-loss orders
      for (const buyEntry of buyList) {
        if (buyEntry.stopLoss?.orderId) {
          symbolsWithSellOrders.add(buyEntry.ticker);
        }
      }
    }
    
    // Delete all SELL orders for each symbol found
    if (symbolsWithSellOrders.size > 0) {
      console.log(`🗑️ Deleting existing SELL orders for ${symbolsWithSellOrders.size} symbol(s) before sell_all...`);
      
      // Delete orders sequentially to avoid overwhelming the API
      const deleteResults = [];
      for (const symbol of symbolsWithSellOrders) {
        const result = await deleteAllSellOrdersForSymbol(symbol);
        deleteResults.push(result);
        
        // Small delay between symbols to avoid rate limiting
        if (symbolsWithSellOrders.size > 1) {
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }
      
      const totalDeleted = deleteResults.reduce((sum, r) => sum + r.deleted, 0);
      const totalFailed = deleteResults.reduce((sum, r) => sum + r.failed, 0);
      
      if (totalDeleted > 0) {
        console.log(`✅ Deleted ${totalDeleted} existing SELL order(s) before sell_all${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`);
        // Small delay after deletion to ensure orders are fully cancelled
        await new Promise(resolve => setTimeout(resolve, 300));
      } else {
        console.log(`ℹ️ No SELL orders found to delete (or already deleted)`);
      }
    } else {
      console.log(`ℹ️ No symbols with active SELL orders found - proceeding with sell_all`);
    }
    
    // According to API documentation: POST /sell_all with no body
    // Returns 200 with no content on success
    let notifyStatus = '';
    let responseData = null;
    let errorMessage = null;
    
    try {
      const resp = await fetch('https://sections-bot.inbitme.com/sell_all', {
        method: 'POST',
        headers: {
          'Accept': '*/*'
        }
      });
      
      notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
      
      // Try to get response body (only if there is content)
      const contentLength = resp.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > 0) {
        try {
          const responseText = await resp.text();
          if (responseText) {
            try {
              responseData = JSON.parse(responseText);
            } catch {
              responseData = responseText;
            }
          }
        } catch (textErr) {
          console.error(`⚠️ Could not read response body:`, textErr.message);
        }
      }
      
      if (resp.ok) {
        // Success - API returns 200 with no content according to documentation
        console.log(`✅ Sell All executed successfully: ${notifyStatus}`);
      } else {
        errorMessage = extractErrorMessage(responseData, responseText || '', resp.status, resp.statusText);
        console.error(`❌ Error in Sell All:`, {
          status: notifyStatus,
          response: responseData,
          extractedError: errorMessage
        });
      }
    } catch (err) {
      notifyStatus = `ERROR: ${err.message}`;
      errorMessage = err.message;
      console.error(`❌ Network/Parse error executing Sell All:`, {
        message: err.message,
        stack: err.stack
      });
    }
    
    const isSuccess = notifyStatus.startsWith('200') || notifyStatus.startsWith('201');
    
    // CRITICAL: Remove ALL positions from StopLimit tracking when Sell All is executed
    // This ensures all positions are removed from V2 as soon as Sell All is clicked
    if (isSuccess) {
      console.log(`🧹 Sell All: Removing all positions from StopLimit tracking...`);
      
      // Get all tracked positions from positions cache
      const allTrackedSymbols = new Set();
      if (positionsCache && typeof positionsCache.keys === 'function') {
        for (const symbol of positionsCache.keys()) {
          const position = positionsCache.get(symbol);
          if (position) {
            const quantity = parseFloat(position.Quantity || '0');
            if (quantity > 0) {
              allTrackedSymbols.add(symbol);
            }
          }
        }
      }
    }
    
    // Handle network errors with 500, otherwise return 200 with success flag
    if (notifyStatus.startsWith('ERROR:')) {
      return res.status(500).json({
        success: false,
        error: errorMessage || 'Network or parsing error executing Sell All',
        data: { notifyStatus, response: responseData }
      });
    }
    
    // Return 200 with success flag (even if external API returned error)
    return res.status(200).json({
      success: isSuccess,
      error: !isSuccess ? (errorMessage || 'Sell All failed') : undefined,
      data: {
        notifyStatus,
        response: responseData,
        message: isSuccess 
          ? 'Sell All executed successfully - all pending orders cancelled and positions sold' 
          : `Sell All failed: ${notifyStatus}`
      }
    });
    
  } catch (e) {
    console.error('❌ Error in sell_all:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Alerts control endpoints
app.get('/api/alerts/status', (req, res) => {
  const status = chartsWatcherService.getConnectionStatus();
  res.json({ success: true, data: { enabled: alertsEnabled, chartsWatcher: status } });
});

app.post('/api/alerts/enable', async (req, res) => {
  try {
    if (!alertsEnabled) {
      await chartsWatcherService.connect();
      alertsEnabled = true;
    }
    res.json({ success: true, data: { enabled: alertsEnabled } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/alerts/disable', (req, res) => {
  try {
    if (alertsEnabled) {
      chartsWatcherService.disconnect();
      alertsEnabled = false;
    }
    res.json({ success: true, data: { enabled: alertsEnabled } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Toplist connection status endpoint
app.get('/api/toplist/status', (req, res) => {
  const status = toplistService.getConnectionStatus();
  
  res.json({
    success: true,
    data: status
  });
});

// Condition statistics endpoint
app.get('/api/statistics/conditions', (req, res) => {
  try {
    const stats = conditionsService.getStatistics();
    const topFailing = conditionsService.getTopFailingConditions(5);
    
    res.json({
      success: true,
      data: {
        overall: {
          totalEvaluations: stats.totalEvaluations,
          totalPassed: stats.totalPassed,
          totalFailed: stats.totalFailed,
          passRate: stats.passRate
        },
        conditions: stats.conditions,
        topFailing: topFailing
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Cached raw tech checks for hydration
app.get('/api/raw-tech-checks', (req, res) => {
  try {
    const payload = lastRawTechChecksResult || { meetsTech: [], meetsMomentum: [] };
    res.json({ success: true, data: payload });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to read cached tech checks' });
  }
});

// Reset statistics endpoint
app.post('/api/statistics/reset', (req, res) => {
  try {
    conditionsService.resetStatistics();
    res.json({
      success: true,
      message: 'Statistics reset successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual symbol analysis endpoint
app.get('/api/analyze/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    
    // Fetch current price for manual analysis
    let currentPrice = null;
    try {
      currentPrice = await polygonService.getCurrentPrice(symbol);
    } catch (priceError) {
    }
    
    // Process the symbol using the same logic as alerts with NASDAQ validation
    const result = await processAlert({
      ticker: symbol,
      symbol: symbol,
      timestamp: new Date().toISOString(),
      price: currentPrice, // Use current price if available, otherwise fall back to last candle close
      volume: 0,
      alert_type: 'manual_analysis'
    }, true); // Enable NASDAQ validation for manual analysis
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: `No data available for symbol ${symbol}`
      });
    }
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get detailed stock information for modal
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    
    // Get company information
    let companyInfo = null;
    try {
      companyInfo = await polygonService.getCompanyInfo(symbol);
    } catch (error) {
    }
    
    // Get current price from Polygon API (same as stock list analysis)
    let currentPrice = null;
    try {
      currentPrice = await polygonService.getCurrentPrice(symbol);
      console.log(`📊 Using Polygon API price for ${symbol}: ${currentPrice}`);
    } catch (error) {
      console.log(`Error getting Polygon API price for ${symbol}:`, error.message);
    }
    
    // Process the symbol to get all indicators
    // Pass close field to match ChartsWatcher data priority
    console.log(`[Stock API] Processing ${symbol}...`);
    const result = await processAlert({
      ticker: symbol,
      symbol: symbol,
      timestamp: new Date().toISOString(),
      close: currentPrice, // Use close field to match ChartsWatcher data
      price: currentPrice,
      volume: 0,
      alert_type: 'stock_info'
    }, false); // Don't validate NASDAQ for stock info
    
    if (!result) {
      console.error(`[Stock API] No result returned for ${symbol}`);
      return res.status(404).json({
        success: false,
        error: `No data available for symbol ${symbol}`
      });
    }
    console.log(`[Stock API] Successfully processed ${symbol}`);
    
    // Combine all information
    const stockInfo = {
      ...result,
      companyInfo: companyInfo || {
        symbol: symbol,
        name: symbol,
        market: 'Unknown',
        primaryExchange: 'Unknown',
        currency: 'USD',
        description: ''
      },
      currentPrice: currentPrice
    };
    
    res.json({
      success: true,
      data: stockInfo
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get historical 1-minute candles for a symbol
// Get current price snapshot
app.get('/api/price/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const price = await polygonService.getCurrentPrice(symbol);
    
    res.json({
      success: true,
      data: {
        symbol,
        price,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/history/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const limit = parseInt(req.query.limit) || 60; // Default to last 60 candles (1 hour)
    
    // Calculate date range (last 24 hours to ensure we get enough data)
    const to = new Date();
    const from = new Date(to.getTime() - (24 * 60 * 60 * 1000));
    
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];
    
    try {
      // Use extended hours to show pre/post market if available
      // Using fetchExtendedHoursCandles which handles the logic nicely
      const result = await polygonService.fetchExtendedHoursCandles(symbol, 1, true, 2); // 2 days back to be safe
      
      let candles = result.candles || [];
      
      // If we have more than limit, take the last 'limit' candles
      if (candles.length > limit) {
        candles = candles.slice(-limit);
      }
      
      res.json({
        success: true,
        data: candles
      });
    } catch (error) {
      console.error(`[History API] Error fetching history for ${symbol}:`, error.message);
      // Fallback to basic fetch if extended fails
      try {
        const candles = await polygonService.fetch1MinuteCandles(symbol, fromStr, toStr);
        const limitedCandles = candles.slice(-limit);
        res.json({
          success: true,
          data: limitedCandles
        });
      } catch (fallbackError) {
        throw new Error(`Failed to fetch history: ${fallbackError.message}`);
      }
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/indicators/macd/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const limit = parseInt(req.query.limit) || 200; // Default to 200 for sufficient calculation
    
    // Fetch enough history for MACD (at least 200 candles + buffer)
    // We need more history to stabilize EMA
    // Calculate limit needed for MACD: requested limit + 26 (slow) + 9 (signal) + buffer
    const fetchLimit = Math.max(limit + 50, 300);
    
    // Use extended hours for continuous data
    // Use days back to ensure enough data points
    const daysBack = Math.ceil(fetchLimit / (60 * 6.5)) + 2; // Approximate days needed
    
    const result = await polygonService.fetchExtendedHoursCandles(symbol, 1, true, daysBack);
    let candles = result.candles || [];
    
    if (candles.length < 35) { // Minimum for MACD calculation
        return res.json({ success: false, error: 'Insufficient data for MACD' });
    }
    
    // Calculate MACD using technicalindicators
    const closes = candles.map(c => c.close);
    const macdInput = {
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    };
    
    const macdOutput = MACD.calculate(macdInput);
    
    // Align timestamps
    // macdOutput length is less than candles length. The result corresponds to the end of the data.
    const resultStartIndex = candles.length - macdOutput.length;
    
    const macdSeries = [];
    const signalSeries = [];
    const histogramSeries = [];
    
    for (let i = 0; i < macdOutput.length; i++) {
        const candleIndex = resultStartIndex + i;
        const timestamp = new Date(candles[candleIndex].timestamp).getTime();
        const point = macdOutput[i];
        
        macdSeries.push({ timestamp, value: point.MACD });
        signalSeries.push({ timestamp, value: point.signal });
        histogramSeries.push({ timestamp, value: point.histogram });
    }
    
    // If user requested specific limit, slice from end
    const limitedMacd = macdSeries.slice(-limit);
    const limitedSignal = signalSeries.slice(-limit);
    const limitedHistogram = histogramSeries.slice(-limit);
    
    res.json({
      success: true,
      data: {
        macd: limitedMacd,
        signal: limitedSignal,
        histogram: limitedHistogram
      }
    });
    
  } catch (error) {
    console.error(`[MACD API] Error calculating MACD for ${req.params.symbol}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// MACD/EMA Verification System
// ============================================

// Default symbols to monitor for verification
const VERIFICATION_SYMBOLS = verificationService.getDefaultSymbols();
let verificationInterval = null;

/**
 * Collect and log verification data for all tracking symbols
 */
async function collectVerificationData() {
  const timestamp = new Date().toISOString();
  console.log(`[Verification] Collecting data at ${timestamp}`);

  let successCount = 0;
  let errorCount = 0;

  // Set tracking symbols if not already set
  if (verificationService.trackingSymbols.length === 0) {
    verificationService.trackingSymbols = VERIFICATION_SYMBOLS;
    console.log(`[Verification] Set tracking symbols: ${VERIFICATION_SYMBOLS.join(', ')}`);
  }

  for (const symbol of VERIFICATION_SYMBOLS) {
    try {
      console.log(`[Verification] Fetching data for ${symbol}...`);
      
      // Use extended hours endpoint to get the most recent data including current candle
      const extendedData1m = await polygonService.fetchExtendedHoursCandles(symbol, 1, true, 7);
      const extendedData5m = await polygonService.fetchExtendedHoursCandles(symbol, 5, true, 7);
      
      const candles1m = extendedData1m?.candles || [];
      const candles5m = extendedData5m?.candles || [];

      if (!candles1m || !candles5m || candles1m.length === 0 || candles5m.length === 0) {
        console.log(`[Verification] ⚠️ Skipping ${symbol} - insufficient data (1m: ${candles1m?.length || 0}, 5m: ${candles5m?.length || 0})`);
        errorCount++;
        continue;
      }

      // Get latest candle timestamp to verify fresh data
      const latest1mTime = candles1m.length > 0 ? candles1m[candles1m.length - 1].timestamp : null;
      const latest5mTime = candles5m.length > 0 ? candles5m[candles5m.length - 1].timestamp : null;
      
      console.log(`[Verification] ✓ Data fetched for ${symbol} (1m: ${candles1m.length} candles, latest: ${latest1mTime?.toISOString()}, 5m: ${candles5m.length} candles, latest: ${latest5mTime?.toISOString()})`);

      // Calculate indicators
      const isExtendedHours = new Date().getHours() >= 4 && new Date().getHours() < 20;
      const indicatorData = await indicatorsService.calculateAllIndicators(symbol, candles1m, candles5m, isExtendedHours);

      if (indicatorData && indicatorData.indicators) {
        console.log(`[Verification] 📊 Indicators calculated for ${symbol}:`);
        console.log(`[Verification]   MACD 1m: ${indicatorData.indicators.macd1m?.macd?.toFixed(4)}, Signal: ${indicatorData.indicators.macd1m?.signal?.toFixed(4)}, Histogram: ${indicatorData.indicators.macd1m?.histogram?.toFixed(4)}`);
        console.log(`[Verification]   MACD 5m: ${indicatorData.indicators.macd5m?.macd?.toFixed(4)}, Signal: ${indicatorData.indicators.macd5m?.signal?.toFixed(4)}, Histogram: ${indicatorData.indicators.macd5m?.histogram?.toFixed(4)}`);
        console.log(`[Verification]   EMA 18 1m: ${indicatorData.indicators.ema1m18?.toFixed(6)}, EMA 200 1m: ${indicatorData.indicators.ema1m200?.toFixed(6)}`);
        console.log(`[Verification]   Close: ${indicatorData.lastCandle?.close?.toFixed(2)}`);
        
        // Log the data
        verificationService.logVerificationData(symbol, indicatorData);
        
        console.log(`[Verification] ✅ Successfully logged data for ${symbol}`);
        successCount++;
      } else {
        console.log(`[Verification] ⚠️ Skipping ${symbol} - no indicator data calculated`);
        errorCount++;
      }
    } catch (error) {
      console.error(`[Verification] ✗ Error collecting data for ${symbol}:`, error.message);
      errorCount++;
    }
  }

  console.log(`[Verification] Collection completed: ${successCount} success, ${errorCount} errors`);
}

/**
 * Start verification monitoring
 */
function startVerificationMonitoring() {
  if (verificationInterval) {
    console.log('[Verification] Monitoring already active');
    return;
  }

  console.log(`[Verification] Starting monitoring for symbols: ${VERIFICATION_SYMBOLS.join(', ')}`);
  
  // Mark as monitoring immediately
  verificationService.isMonitoring = true;
  
  // Collect data immediately for all symbols
  console.log('[Verification] Collecting initial data...');
  collectVerificationData().then(() => {
    console.log('[Verification] Initial data collection completed');
  }).catch(error => {
    console.error('[Verification] Error in initial data collection:', error);
  });

  // Start the monitoring interval (every minute)
  verificationInterval = setInterval(() => {
    console.log('[Verification] Collecting periodic data...');
    collectVerificationData();
  }, 60 * 1000);

  console.log('[Verification] Monitoring started - collecting data every 60 seconds');
}

/**
 * Stop verification monitoring
 */
function stopVerificationMonitoring() {
  if (verificationInterval) {
    clearInterval(verificationInterval);
    verificationInterval = null;
  }
  verificationService.isMonitoring = false;
  console.log('[Verification] Monitoring stopped');
}

// ============================================
// Verification API Endpoints
// ============================================

app.get('/api/verification/status', (req, res) => {
  const stats = verificationService.getStatistics();
  const today = new Date().toISOString().split('T')[0];

  res.json({
    monitoring: verificationService.isMonitoring || false,
    symbols: VERIFICATION_SYMBOLS,
    statistics: stats,
    logFile: `logs/macd_ema_verification/verification_${today}.json`
  });
});

app.get('/api/verification/start', (req, res) => {
  if (verificationService.isMonitoring) {
    res.json({ message: 'Monitoring already active', active: true });
    return;
  }

  startVerificationMonitoring();

  res.json({
    message: 'Verification monitoring started',
    symbols: VERIFICATION_SYMBOLS,
    interval: '60 seconds'
  });
});

app.get('/api/verification/stop', (req, res) => {
  stopVerificationMonitoring();

  res.json({
    message: 'Verification monitoring stopped',
    active: false
  });
});

app.get('/api/verification/export/:date?', (req, res) => {
  try {
    const date = req.params.date || null;
    const csvFile = verificationService.exportAsCSV(date);
    res.download(csvFile);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.get('/api/verification/data', (req, res) => {
  try {
    const { symbol, date } = req.query;
    let data = verificationService.getAllData(date);
    
    // Sort by timestamp descending (newest first)
    data = data.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA;
    });
    
    if (symbol) {
      const filteredData = data.filter(entry => entry.symbol === symbol.toUpperCase());
      res.json({ success: true, data: filteredData });
    } else {
      res.json({ success: true, data: data });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/verification/collect-now', async (req, res) => {
  try {
    console.log('[Verification] Manual collection triggered');
    await collectVerificationData();
    res.json({ 
      success: true, 
      message: 'Data collection completed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// ============================================
// Manual List Logic
// ============================================
let MANUAL_WEIGHTS = {
  distVwap: 0.20,
  change2m: 0.15,
  change5m: 0.15,
  trades1m: 0.08,
  trades2m: 0.08,
  vol1m: 0.08,
  vol2m: 0.08,
  changeOpen: 0.08,
  cons1m: 0.05,
  dailyVol: 0.05
};

// Default buy quantities per price group
let MANUAL_BUY_QUANTITIES = {
  '0-5': 2002,
  '5-10': 1001,
  '10-12': 757,
  '12-20': 500,
  '20-30': 333
};

// Helper function to get price group from price
function getPriceGroup(price) {
  if (price > 0 && price <= 5) return '0-5';
  if (price > 5 && price <= 10) return '5-10';
  if (price > 10 && price <= 12) return '10-12';
  if (price > 12 && price <= 20) return '12-20';
  if (price > 20 && price <= 30) return '20-30';
  return null;
}

let manualListRows = [];
const manualListIndicators = new Map(); // symbol -> indicators
let manualUpdateTimeout = null;

const isDbConnected = () => mongoose.connection && mongoose.connection.readyState === 1;

// Load StopLimit Tracker Config from MongoDB
async function loadStopLimitTrackerConfigFromDb() {
  if (!isDbConnected()) {
    console.warn('⚠️ MongoDB not connected; StopLimit tracker config kept in memory only');
    return;
  }
  
  try {
    const { StopLimitTrackerConfig, STOPLIMIT_TRACKER_CONFIG_ID } = require('./models/stopLimitTrackerConfig.model');
    const doc = await StopLimitTrackerConfig.findById(STOPLIMIT_TRACKER_CONFIG_ID);
    
    if (doc && doc.groups && Array.isArray(doc.groups)) {
      stopLimitTrackerConfig.clear();
      doc.groups.forEach(group => {
        if (group.groupId) {
          const minPrice = parseFloat(group.minPrice || '0');
          const maxPrice = parseFloat(group.maxPrice || '999999');
          const initialStopPrice = parseFloat(group.initialStopPrice || '0');
          const enabled = group.enabled !== false;
          
          stopLimitTrackerConfig.set(group.groupId, {
            minPrice,
            maxPrice,
            initialStopPrice,
            enabled,
            steps: Array.isArray(group.steps) ? group.steps.map(step => ({
              pnl: parseFloat(step.pnl || '0'),
              stop: parseFloat(step.stop || '0')
            })) : []
          });
          
          console.log(`📊 [STOPLIMIT_TRACKER] Loaded group ${group.groupId}: enabled=${enabled}, minPrice=${minPrice}, maxPrice=${maxPrice}, initialStopPrice=${initialStopPrice}, steps=${group.steps?.length || 0}`);
        }
      });
      console.log(`✅ Loaded StopLimit tracker config from DB: ${doc.groups.length} group(s)`);
    } else {
      console.log('📋 No StopLimit tracker config found in DB, using empty config');
    }
  } catch (err) {
    console.error('❌ Error loading StopLimit tracker config from DB:', err.message);
    console.error('❌ Stack:', err.stack);
  }
}

// Save StopLimit Tracker Config to MongoDB
async function saveStopLimitTrackerConfigToDb() {
  if (!isDbConnected()) {
    console.warn('⚠️ MongoDB not connected; StopLimit tracker config kept in memory only');
    return;
  }
  
  try {
    const { StopLimitTrackerConfig, STOPLIMIT_TRACKER_CONFIG_ID } = require('./models/stopLimitTrackerConfig.model');
    
    const groups = Array.from(stopLimitTrackerConfig.entries()).map(([groupId, group]) => ({
      groupId,
      minPrice: group.minPrice,
      maxPrice: group.maxPrice,
      initialStopPrice: group.initialStopPrice,
      enabled: group.enabled,
      steps: group.steps || []
    }));
    
    await StopLimitTrackerConfig.findByIdAndUpdate(
      STOPLIMIT_TRACKER_CONFIG_ID,
      { groups },
      { upsert: true, new: true }
    );
    
    console.log(`✅ Saved StopLimit tracker config to DB: ${groups.length} group(s)`);
  } catch (err) {
    console.error('❌ Error saving StopLimit tracker config to DB:', err.message);
  }
}

async function loadManualWeightsFromDb() {
  if (!isDbConnected()) {
    console.warn('⚠️ MongoDB not connected; using in-memory MANUAL_WEIGHTS');
    return false;
  }

  try {
    const doc = await ManualConfig.findById(MANUAL_CONFIG_ID).lean();
    const rawWeights = doc?.weights instanceof Map ? Object.fromEntries(doc.weights) : doc?.weights || {};
    const normalized = {};

    for (const [key, val] of Object.entries(rawWeights)) {
      const num = Number(val);
      if (!Number.isNaN(num)) normalized[key] = num;
    }

    if (Object.keys(normalized).length > 0) {
      MANUAL_WEIGHTS = { ...MANUAL_WEIGHTS, ...normalized };
      console.log('✅ Loaded MANUAL weights from database');
      broadcastManualUpdate();
    }
    
    // Load buy quantities
    const rawBuyQuantities = doc?.buyQuantities instanceof Map ? Object.fromEntries(doc.buyQuantities) : doc?.buyQuantities || {};
    const normalizedBuyQuantities = {};
    for (const [key, val] of Object.entries(rawBuyQuantities)) {
      const num = Number(val);
      if (!Number.isNaN(num) && num > 0) normalizedBuyQuantities[key] = num;
    }
    
    if (Object.keys(normalizedBuyQuantities).length > 0) {
      MANUAL_BUY_QUANTITIES = { ...MANUAL_BUY_QUANTITIES, ...normalizedBuyQuantities };
      console.log('✅ Loaded MANUAL buy quantities from database');
    }
    
    if (!doc) {
      // Seed document so next writes succeed without race
      await ManualConfig.findByIdAndUpdate(
        MANUAL_CONFIG_ID,
        { weights: MANUAL_WEIGHTS, buyQuantities: MANUAL_BUY_QUANTITIES },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }

    return true;
  } catch (err) {
    console.warn('⚠️ Failed to load MANUAL weights from database:', err.message);
    return false;
  }
}

async function persistManualWeights(weights) {
  if (!isDbConnected()) {
    console.warn('⚠️ MongoDB not connected; MANUAL weights kept in memory only');
    return false;
  }

  try {
    await ManualConfig.findByIdAndUpdate(
      MANUAL_CONFIG_ID,
      { weights, updatedAt: new Date() },
      { upsert: true, setDefaultsOnInsert: true }
    );
    return true;
  } catch (err) {
    console.warn('⚠️ Failed to persist MANUAL weights:', err.message);
    return false;
  }
}

async function persistManualBuyQuantities(buyQuantities) {
  if (!isDbConnected()) {
    console.warn('⚠️ MongoDB not connected; MANUAL buy quantities kept in memory only');
    return false;
  }

  try {
    await ManualConfig.findByIdAndUpdate(
      MANUAL_CONFIG_ID,
      { buyQuantities, updatedAt: new Date() },
      { upsert: true, setDefaultsOnInsert: true }
    );
    return true;
  } catch (err) {
    console.warn('⚠️ Failed to persist MANUAL buy quantities:', err.message);
    return false;
  }
}

function getManualColVal(row, keys) {
  if (!row.columns) return 0;
  const col = row.columns.find((c) => keys.includes(c.key));
  if (!col) return 0;
  
  const valStr = String(col.value).trim();
  if (/[KMB]$/i.test(valStr)) {
    const num = parseFloat(valStr.replace(/[^0-9.-]/g, ''));
    if (isNaN(num)) return 0;
    if (/B$/i.test(valStr)) return num * 1_000_000_000;
    if (/M$/i.test(valStr)) return num * 1_000_000;
    if (/K$/i.test(valStr)) return num * 1_000;
    return num;
  }
  
  const val = parseFloat(valStr.replace(/[^0-9.-]/g, ''));
  return isNaN(val) ? 0 : val;
}

function computeManualList() {
  const qualified = [];
  const nonQualified = [];
  const analyzing = [];

  manualListRows.forEach(row => {
    const symbol = row.symbol || row.columns?.find((c) => c.key === 'SymbolColumn')?.value;
    if (!symbol) return;

    // Extract factors
    const factors = {
      change2m: getManualColVal(row, ['PrzChangeFilterMIN2', 'ChangeMIN2', 'Change2MIN']),
      change5m: getManualColVal(row, ['PrzChangeFilterMIN5', 'ChangeMIN5', 'Change5MIN']),
      trades1m: getManualColVal(row, ['TradeCountFilterMIN1', 'TradeCountMIN1', 'TradesMIN1']),
      trades2m: getManualColVal(row, ['TradeCountFilterMIN2', 'TradeCountMIN2', 'TradesMIN2']),
      vol1m: getManualColVal(row, ['AbsVolumeFilterMIN1', 'VolumeMIN1']),
      vol2m: getManualColVal(row, ['AbsVolumeFilterMIN2', 'VolumeMIN2']),
      changeOpen: getManualColVal(row, ['ChangeFromOpenPRZ', 'ChangeFromOpen']),
      distVwap: getManualColVal(row, ['DistanceFromVWAPPRZ', 'DistanceFromVWAP']),
      cons1m: getManualColVal(row, ['ConsecutiveCandleFilterFM1', 'ConsecutiveCandle']),
      dailyVol: getManualColVal(row, ['AbsVolumeFilterDAY1', 'Volume', 'VolumeColumn']),
    };
    const price = getManualColVal(row, ['PriceNOOPTION', 'Price']);

    const indicators = manualListIndicators.get(symbol);

    if (!indicators) {
      analyzing.push({ symbol, price, factors, rawRow: row });
      return;
    }

    const reasons = [];
    if ((indicators.macd5m?.histogram ?? -1) <= 0) reasons.push("Hist 5m <= 0");
    if ((indicators.macd5m?.macd ?? -1) <= 0) reasons.push("MACD 5m <= 0");
    // EMA18 5m > EMA200 5m is now a visual indicator only, not a filter condition

    if (reasons.length > 0) {
      nonQualified.push({ symbol, price, reasons, factors, rawRow: row });
      return;
    }

    const meetsExtra = {
      macd1mPos: (indicators.macd1m?.macd ?? -1) > 0,
      closeOverEma1m: price > (indicators.ema1m18 ?? 999999),
      ema18Above200_5m: (indicators.ema5m18 ?? 0) > (indicators.ema5m200 ?? 999999)
    };

    qualified.push({
      symbol,
      price,
      score: 0,
      factors,
      indicators,
      meetsExtra,
      rawRow: row
    });
  });

  // Score qualified
  if (qualified.length > 0) {
    const factorsKey = Object.keys(MANUAL_WEIGHTS);
    const stats = {};
    factorsKey.forEach(key => {
      const values = qualified.map(c => c.factors[key]);
      stats[key] = { min: Math.min(...values), max: Math.max(...values) };
    });

    qualified.forEach(c => {
      let totalScore = 0;
      factorsKey.forEach(key => {
        const { min, max } = stats[key];
        const val = c.factors[key];
        let score = 0;
        if (max === min) {
          score = 50;
        } else {
          if (key === 'distVwap') {
            score = 100 * (max - val) / (max - min);
          } else {
            score = 100 * (val - min) / (max - min);
          }
        }
        totalScore += score * (MANUAL_WEIGHTS[key] || 0);
      });
      c.score = totalScore;
    });
  }

  // Sort
  qualified.sort((a, b) => b.score - a.score);
  nonQualified.sort((a, b) => a.symbol.localeCompare(b.symbol));
  analyzing.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    qualified: qualified.slice(0, 10), // Top 10
    nonQualified,
    analyzing
  };
}

function broadcastManualUpdate() {
  const data = computeManualList();
  broadcastToClients({
    type: 'MANUAL_LIST_UPDATE',
    data: {
        qualified: data.qualified,
        nonQualified: data.nonQualified,
        analyzing: data.analyzing,
        timestamp: new Date().toISOString()
    }
  });
}

async function updateManualList(rows) {
  manualListRows = rows;
  const symbols = rows.map(r => r.symbol || (r.columns.find(c => c.key === 'SymbolColumn')?.value)).filter(Boolean);
  
  // Initial broadcast with new rows (analyzing state)
  broadcastManualUpdate();

  // Analyze symbols in batches
  const BATCH_SIZE = 3;
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (sym) => {
      try {
        const analysis = await analyzeSymbol(sym);
        if (analysis && analysis.indicators) {
          manualListIndicators.set(sym, analysis.indicators);
        }
      } catch (e) {
        console.error(`Error analyzing manual symbol ${sym}:`, e.message);
      }
    }));
    broadcastManualUpdate();
    // Small delay to be nice to API/CPU
    await new Promise(r => setTimeout(r, 100));
  }
}

function scheduleManualUpdate(rows) {
    if (manualUpdateTimeout) clearTimeout(manualUpdateTimeout);
    manualUpdateTimeout = setTimeout(() => {
        updateManualList(rows).catch(console.error);
    }, 500); // 500ms debounce
}

// ============================================
// Start server
// ============================================

server.listen(PORT, () => {
  console.log(`🚀 Trading Alerts API server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📈 Alerts endpoint: http://localhost:${PORT}/api/alerts`);
  console.log(`✅ Valid alerts: http://localhost:${PORT}/api/alerts/valid`);
  console.log(`❌ Filtered alerts: http://localhost:${PORT}/api/alerts/filtered`);
  console.log(`🔌 ChartsWatcher status: http://localhost:${PORT}/api/chartswatcher/status`);
  console.log(`📋 Toplist endpoint: http://localhost:${PORT}/api/toplist`);
  console.log(`📊 Toplist status: http://localhost:${PORT}/api/toplist/status`);
  console.log(`🔍 Manual analysis: http://localhost:${PORT}/api/analyze/{SYMBOL}`);
  console.log(`📊 Condition stats: http://localhost:${PORT}/api/statistics/conditions`);
  console.log(`🌐 WebSocket server: ws://localhost:${PORT}`);
  console.log(`\n🔬 MACD/EMA Verification:`);
  console.log(`   Status: http://localhost:${PORT}/api/verification/status`);
  console.log(`   Start: http://localhost:${PORT}/api/verification/start`);
  console.log(`   Stop: http://localhost:${PORT}/api/verification/stop`);
  console.log(`   Export: http://localhost:${PORT}/api/verification/export`);

  // Auto-start verification monitoring (can be controlled via API)
  if (process.env.ENABLE_VERIFICATION === 'true') {
    startVerificationMonitoring();
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT. Graceful shutdown...');
  stopVerificationMonitoring();
  chartsWatcherService.disconnect();
  toplistService.disconnect();
  if (wsHeartbeatInterval) { clearInterval(wsHeartbeatInterval); wsHeartbeatInterval = null; }
  wss.close();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM. Graceful shutdown...');
  stopVerificationMonitoring();
  chartsWatcherService.disconnect();
  toplistService.disconnect();
  if (wsHeartbeatInterval) { clearInterval(wsHeartbeatInterval); wsHeartbeatInterval = null; }
  wss.close();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

module.exports = app;

