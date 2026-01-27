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


// Cache persistence service (initialized after DB connection)
let cachePersistenceService = null;

// Initialize cache persistence service
async function initializeCachePersistence() {
  try {
    const CachePersistenceService = require('./services/cachePersistenceService');
    cachePersistenceService = new CachePersistenceService(ordersCache, positionsCache);
    
    // Load cache from database on startup
    const loaded = await cachePersistenceService.loadFromDatabase();
    console.log(`✅ Cache persistence initialized: Loaded ${loaded.orders} orders and ${loaded.positions} positions from database`);
    
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
            
          }
        } else {
          // Position closed or quantity is 0, remove from cache
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


          // Log order updates for debugging (only for active orders)
          if (isActiveOrderStatus(order.Status)) {
            console.log(`📋 Order cache updated: ${orderId} (${symbol}, Status: ${order.Status})`);
          }

          // Remove order from cache if it's cancelled or filled (status indicates completion)
          if (status === 'CAN' || status === 'EXP' || status === 'FIL' || status === 'FLL') {
            ordersCache.delete(orderId);
            if (cachePersistenceService) {
              cachePersistenceService.scheduleOrderSave(orderId);
            }
            console.log(`📋 Order removed from cache: ${orderId} (Status: ${order.Status})`);
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
    
    const orderIdFromApi = (responseData && typeof responseData === 'object')
      ? (responseData.order_id ?? responseData.OrderID ?? responseData.orderId ?? null)
      : null;
    
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
    // Validate and normalize order_type: permitted values are Limit, Market (StopLimit not supported)
    const rawOrderType = (req.body?.order_type || 'Limit').toString().trim();
    const normalizedInput = rawOrderType.toLowerCase();
    let orderType = 'Limit'; // default
    if (normalizedInput === 'limit') {
      orderType = 'Limit';
    } else if (normalizedInput === 'market') {
      orderType = 'Market';
    } else if (normalizedInput === 'stoplimit' || normalizedInput === 'stop_limit' || normalizedInput === 'stop-limit') {
      return res.status(400).json({ success: false, error: 'StopLimit orders are not supported. Use Limit or Market.' });
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
    // Cancel any existing sell orders before placing the new one
    // Only one SELL order can be active per stock at a time
    if (side === 'SELL') {
      console.log(`🧹 Manual Sell from P&L: Checking for existing sell orders for ${symbol}...`);
      const normalizedSymbol = symbol.toUpperCase();
      
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
        // First, find all active sell orders in the global cache
        let activeSellOrders = findActiveSellOrdersInCache(symbol);
        console.log(`🔍 Found ${activeSellOrders.length} active sell order(s) for ${symbol} in orders cache`);
        
        // Cancel all active sell orders directly
        if (activeSellOrders.length > 0) {
          console.log(`🗑️ Cancelling ${activeSellOrders.length} active sell order(s) for ${symbol}...`);
          // Log each order being cancelled for debugging
          for (const order of activeSellOrders) {
            const orderType = (order.order?.OrderType || '').toUpperCase();
            console.log(`   - Order ${order.orderId} (Type: ${orderType}, Status: ${order.status})`);
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
      
      let preOrderCheck = findActiveSellOrdersInCache(symbol);
      
      if (preOrderCheck.length > 0) {
        console.warn(`⚠️ P&L Sell: Found ${preOrderCheck.length} active sell order(s) right before placing new order. Cancelling immediately...`);
        // Cancel all in parallel for speed
        await Promise.allSettled(
          preOrderCheck.map(order => {
            const orderType = (order.order?.OrderType || '').toUpperCase();
            console.log(`   - Order ${order.orderId} (Type: ${orderType}, Status: ${order.status})`);
            return cancelOrderDirectly(order.orderId);
          })
        );
        // Reduced final wait
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Build request body according to Sections Bot API documentation
    // https://inbitme.gitbook.io/sections-bot/xKy06Pb8j01LsqEnmSik/rest-api/ordenes
    const orderBody = {
      symbol: symbol,
      side: side,
      order_type: orderType,
      quantity: quantity
    };
    
    
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
    
    // CRITICAL: Remove ALL positions when Sell All is executed
    // This ensures all positions are removed from V2 as soon as Sell All is clicked
    if (isSuccess) {
      console.log(`🧹 Sell All: Removing all positions...`);
      
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

