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

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// WebSocket server for real-time alerts
const wss = new WebSocket.Server({ server });
const clients = new Set();
// Heartbeat (ping/pong) to prevent idle proxies from closing connections
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WS_HEARTBEAT_MS || '30000', 10);
let wsHeartbeatInterval = null;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize services
const chartsWatcherService = new ChartsWatcherService();
const toplistService = new ToplistService();
const polygonService = new PolygonService();
const indicatorsService = new IndicatorsService();
const conditionsService = new ConditionsService();
const floatService = new FloatSegmentationService();

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
    const [ext1, ext5] = await Promise.all([
      polygonService.fetchExtendedHoursCandles(symbol, 1, true),
      polygonService.fetchExtendedHoursCandles(symbol, 5, true)
    ]);
    candles1m = ext1?.candles || [];
    candles5m = ext5?.candles || [];
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
    const indicatorData = await indicatorsService.calculateAllIndicators(symbol, candles1m, candles5m, isExtendedHours);
    if (!indicatorData || !indicatorData.indicators) {
      log('warn', `⚠️ ${symbol}: indicators calculation failed`);
      return { symbol, meetsTech: false, meetsMomentum: false };
    }
    let currentPrice = null;
    try { currentPrice = await polygonService.getCurrentPrice(symbol); } catch {}
    const closePrice = currentPrice || indicatorData.lastCandle?.close || null;
    indicatorData.currentPrice = closePrice;
    if (indicatorData.lastCandle && closePrice != null) indicatorData.lastCandle.close = closePrice;
    const evaluation = conditionsService.evaluateConditions(indicatorData);
    const meetsTech = !!evaluation?.allConditionsMet;
    // Meets Config FLOAT (server-side) treated as momentum/green gate
    // Find latest row + origin from toplist maps
    let meetsConfigFloat = false;
    try {
      const toplistMap = toplistService.toplistByConfig || {};
      outer: for (const configId of Object.keys(toplistMap)) {
        const groupInfo = floatService.getGroupInfoByConfig(configId);
        const origin = groupInfo?.key || '?';
        const rows = toplistMap[configId] || [];
        for (const row of rows) {
          const sym = row?.symbol || (Array.isArray(row?.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value) : null);
          if ((sym || '').toUpperCase() === String(symbol).toUpperCase()) {
            meetsConfigFloat = evaluateConfigFloat(row, origin);
            break outer;
          }
        }
      }
    } catch {}
    const meetsMomentum = !!meetsConfigFloat;
    setCachedStockColor(symbol, meetsTech, meetsMomentum);
    logIfDebugTicker(symbol, `Eval ${symbol}: tech=${meetsTech} failed=[${(evaluation.failedConditions||[]).map(f=>f.name).join(', ')}] cp=${closePrice}`);
    return { symbol, meetsTech, meetsMomentum, indicators: indicatorData.indicators, lastClose: closePrice, evaluation };
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

  // Filter rows by ChartsWatcher metrics mapped to FLOAT config thresholds
  const filteredSymbols = rows.filter((row) => {
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
          let notifyStatus = '';
          try {
            const resp = await fetch(`https://sections-bot.inbitme.com/buy/${encodeURIComponent(ticker)}`, { method: 'POST' });
            notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
          } catch (notifyErr) {
            notifyStatus = `ERROR: ${notifyErr.message}`;
          }
          const entry = {
            ticker,
            timestamp: nowIso,
            price: item.lastCandle?.close || item.price || null,
            configId: configId,
            group: floatService.getGroupInfoByConfig(configId)?.key || null,
            notifyStatus
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
          lastMacd1mHistogramByTicker.set(ticker, hist);
          const isPositive = hist > 0;
          const shouldTrigger = buysEnabled && (buyTriggerMode === 'cross'
            ? (typeof prev === 'number' && prev <= 0 && isPositive)
            : isPositive);
          if (shouldTrigger) {
            // Avoid duplicate buys for the same symbol on the same day
            if (hasBoughtToday && hasBoughtToday(ticker)) {
              continue;
            }
            let notifyStatus = '';
            try {
              const resp = await fetch(`https://sections-bot.inbitme.com/buy/${encodeURIComponent(ticker)}`, { method: 'POST' });
              notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
            } catch (notifyErr) {
              notifyStatus = `ERROR: ${notifyErr.message}`;
            }
            const entry = {
              ticker,
              timestamp: nowIso,
              price: item.lastCandle?.close || item.price || null,
              configId: configId,
              group: floatService.getGroupInfoByConfig(configId)?.key || null,
              notifyStatus
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
    if (!thresholds) return;
    
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
          return res ? { symbol: normalizedSymbol, meetsTech: !!res.meetsTech, meetsMomentum: !!res.meetsMomentum, indicators: res.indicators || null, lastClose: res.lastClose || null } : null;
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
            meetsMomentum: r.meetsMomentum
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
          if (typeof hist1m === 'number' && hist1m > 0) {
            if (!hasBoughtToday(r.symbol)) {
              const nowIso = new Date().toISOString();
              let notifyStatus = '';
              try {
                const resp = await fetch(`https://sections-bot.inbitme.com/buy/${encodeURIComponent(r.symbol)}`, { method: 'POST' });
                notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
                console.log(`🛒 INSTANT BUY: ${r.symbol} - MACD 1m histogram: ${hist1m.toFixed(4)}`);
              } catch (notifyErr) {
                notifyStatus = `ERROR: ${notifyErr.message}`;
              }
              
              const entry = {
                ticker: r.symbol,
                timestamp: nowIso,
                price: r.lastClose || null,
                configId: configId,
                group: origin,
                notifyStatus
              };
              buyList.unshift(entry);
              lastBuyTsByTicker.set(r.symbol, nowIso);
              broadcastToClients({ type: 'BUY_SIGNAL', data: entry, timestamp: nowIso });
            }
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
          return { symbol, meetsTech: !!res.meetsTech, meetsMomentum: !!res.meetsMomentum, indicators: res.indicators || null, lastClose: res.lastClose || null };
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
            
            // Check if MACD 1m histogram is positive
            if (typeof hist1m === 'number' && hist1m > 0) {
              // Check if already bought today
              if (hasBoughtToday && hasBoughtToday(ticker)) {
                if (ticker === 'RR' || ticker === 'ACAD') {
                  console.log(`  ⚠️ SKIPPED: Already bought today`);
                }
                continue;
              }
              
              const nowIso = new Date().toISOString();
              let notifyStatus = '';
              try {
                const resp = await fetch(`https://sections-bot.inbitme.com/buy/${encodeURIComponent(ticker)}`, { method: 'POST' });
                notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
                console.log(`🛒 BUY TRIGGERED: ${ticker} - MACD 1m histogram: ${hist1m.toFixed(4)}`);
              } catch (notifyErr) {
                notifyStatus = `ERROR: ${notifyErr.message}`;
              }
              
              const origin = symbolOriginMap.get(ticker) || '?';
              const entry = {
                ticker,
                timestamp: nowIso,
                price: r.lastClose || null,
                configId: null,
                group: origin,
                notifyStatus
              };
              buyList.unshift(entry);
              lastBuyTsByTicker.set(ticker, nowIso);
              broadcastToClients({ type: 'BUY_SIGNAL', data: entry, timestamp: nowIso });
            } else {
              if (ticker === 'RR' || ticker === 'ACAD') {
                console.log(`  ⚠️ SKIPPED: MACD 1m histogram not positive (${hist1m})`);
              }
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
      lastMacd1mHistogramByTicker.set(ticker, hist);
      const isPositive = hist > 0;
      const shouldTrigger = buysEnabled && (buyTriggerMode === 'cross'
        ? (typeof prev === 'number' && prev <= 0 && isPositive)
        : isPositive);
      if (!shouldTrigger) continue;
      if (hasBoughtToday && hasBoughtToday(ticker)) continue;
      let notifyStatus = '';
      try {
        const resp = await fetch(`https://sections-bot.inbitme.com/buy/${encodeURIComponent(ticker)}`, { method: 'POST' });
        notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
      } catch (notifyErr) {
        notifyStatus = `ERROR: ${notifyErr.message}`;
      }
      const entry = {
        ticker,
        timestamp: nowIso,
        price: item.lastCandle?.close || item.price || null,
        configId: configId,
        group: floatService.getGroupInfoByConfig(configId)?.key || null,
        notifyStatus
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
    
    console.log(`[Extended Hours] Processing ${ticker} - Current session: ${currentSession}, Extended hours: ${useExtendedHours}`);
    
    try {
      if (useExtendedHours) {
        // Use extended trading hours data for real-time accuracy
        console.log(`[Extended Hours] Fetching extended hours data for ${ticker}`);
        
        const [extendedData1m, extendedData5m] = await Promise.all([
          polygonService.fetchExtendedHoursCandles(ticker, 1, true),
          polygonService.fetchExtendedHoursCandles(ticker, 5, true)
        ]);
        
        candles1m = extendedData1m.candles;
        candles5m = extendedData5m.candles;
        isExtendedHours = true;
        
        console.log(`[Extended Hours] Retrieved ${candles1m.length} 1m candles and ${candles5m.length} 5m candles for ${ticker}`);
      } else {
        // Use regular market hours data
        console.log(`[Extended Hours] Fetching regular market hours data for ${ticker}`);
        
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
    
    // Calculate indicators with extended hours support
    const indicatorData = await indicatorsService.calculateAllIndicators(ticker, candles1m, candles5m, isExtendedHours);
    
    // Add current price to indicator data for condition evaluation
    indicatorData.currentPrice = currentPrice;
    
    // Evaluate conditions
    const evaluation = conditionsService.evaluateConditions(indicatorData);
    
    // Debug logging for ALL stocks to compare with modal
    console.log(`\n🏢 STOCK API EVALUATION for ${ticker}:`);
    console.log(`  All conditions met: ${evaluation.allConditionsMet}`);
    console.log(`  Failed conditions:`, evaluation.failedConditions.map(fc => fc.name));
    console.log(`  Close price used: ${currentPrice}`);
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
      price: currentPrice,
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

// Toplist data endpoint
app.get('/api/toplist', async (req, res) => {
  try {
    const toplistData = await toplistService.fetchToplistData();
    res.json({
      success: true,
      data: toplistData,
      count: Object.values(toplistData).reduce((acc, rows) => acc + rows.length, 0)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch toplist data from ChartsWatcher API. Please check API credentials and network connection.'
    });
  }
});

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

// Test external buy webhook endpoint (no buy list mutation)
app.post('/api/buys/test', async (req, res) => {
  try {
    const symbol = (req.body?.symbol || '').toString().trim().toUpperCase();
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Missing symbol' });
    }
    let notifyStatus = '';
    try {
      const resp = await fetch(`https://sections-bot.inbitme.com/buy/${encodeURIComponent(symbol)}`, { method: 'POST' });
      notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
    } catch (err) {
      notifyStatus = `ERROR: ${err.message}`;
    }
    return res.json({ success: true, data: { symbol, notifyStatus } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET fallback for testing (easier to try in browser): /api/buys/test?symbol=ELWS
app.get('/api/buys/test', async (req, res) => {
  try {
    const symbol = (req.query.symbol || '').toString().trim().toUpperCase();
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Missing symbol' });
    }
    let notifyStatus = '';
    try {
      const resp = await fetch(`https://sections-bot.inbitme.com/buy/${encodeURIComponent(symbol)}`, { method: 'POST' });
      notifyStatus = `${resp.status} ${resp.statusText || ''}`.trim();
    } catch (err) {
      notifyStatus = `ERROR: ${err.message}`;
    }
    return res.json({ success: true, data: { symbol, notifyStatus } });
  } catch (e) {
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

// Start server
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
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT. Graceful shutdown...');
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

