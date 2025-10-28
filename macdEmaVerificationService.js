const fs = require('fs');
const path = require('path');

/**
 * MACD and EMA Verification Service
 * 
 * This service tracks and logs MACD and EMA values for a set of stocks every minute
 * to validate calculation accuracy against Polygon's API.
 */
class MACDEMAVerificationService {
  constructor() {
    this.trackingSymbols = [];
    this.logInterval = null;
    this.verificationLogPath = path.join(__dirname, 'logs', 'macd_ema_verification');
    this.currentLogFile = null;
    this.isMonitoring = false;
    
    // Ensure logs directory exists
    this.ensureLogsDirectory();
    
    // Log format: timestamp, symbol, macd.macd, macd.signal, macd.histogram, emas
    this.verificationData = [];
    
    console.log('[Verification] MACD/EMA Verification Service initialized');
  }

  ensureLogsDirectory() {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const verificationDir = this.verificationLogPath;
    if (!fs.existsSync(verificationDir)) {
      fs.mkdirSync(verificationDir, { recursive: true });
    }
  }

  /**
   * Start monitoring a list of symbols
   * @param {string[]} symbols - Array of stock symbols to monitor
   */
  startMonitoring(symbols) {
    if (this.logInterval) {
      this.stopMonitoring();
    }

    this.trackingSymbols = symbols;
    
    console.log(`[Verification] Starting to monitor ${symbols.length} symbols: ${symbols.join(', ')}`);
    
    // Initialize log file for today
    this.initializeDailyLog();
    
    // Run immediately, then every minute
    this.logCurrentValues();
    
    this.logInterval = setInterval(() => {
      this.logCurrentValues();
    }, 60 * 1000); // Every minute

    console.log('[Verification] Monitoring started - logging every 60 seconds');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.logInterval) {
      clearInterval(this.logInterval);
      this.logInterval = null;
      console.log('[Verification] Monitoring stopped');
    }
  }

  /**
   * Get default set of symbols to monitor
   * Popular, liquid stocks for verification
   */
  getDefaultSymbols() {
    return [
      'AAPL',   // Apple
      'TSLA',   // Tesla
      'MSFT',   // Microsoft
      'NVDA',   // NVIDIA
      'AMZN',   // Amazon
      'GOOGL',  // Alphabet
      'META',   // Meta
      'SPY',    // S&P 500 ETF
      'QQQ',    // QQQ ETF
      'AMD'     // AMD
    ];
  }

  /**
   * Initialize daily log file
   */
  initializeDailyLog() {
    const today = new Date().toISOString().split('T')[0];
    this.currentLogFile = path.join(this.verificationLogPath, `verification_${today}.json`);
    
    // Load existing data if file exists
    if (fs.existsSync(this.currentLogFile)) {
      try {
        const existingData = fs.readFileSync(this.currentLogFile, 'utf8');
        this.verificationData = JSON.parse(existingData);
        console.log(`[Verification] Loaded ${this.verificationData.length} existing entries from ${this.currentLogFile}`);
      } catch (error) {
        console.error('[Verification] Error loading existing log:', error.message);
        this.verificationData = [];
      }
    } else {
      this.verificationData = [];
    }
  }

  /**
   * Log current values for all tracking symbols
   */
  async logCurrentValues() {
    const timestamp = new Date().toISOString();
    console.log(`[Verification] Logging values at ${timestamp}`);

    // This will be called from outside with the indicators data
    // We'll create a method that external services can call to log data
  }

  /**
   * Log verification data from external source
   * @param {string} symbol - Stock symbol
   * @param {Object} indicatorData - Indicator data object
   */
  logVerificationData(symbol, indicatorData) {
    if (!this.trackingSymbols.includes(symbol)) {
      return; // Not tracking this symbol
    }

    const timestamp = new Date().toISOString();
    const collectionTime = Date.now();

    const logEntry = {
      timestamp,
      collectionTime, // Unix timestamp for sorting
      symbol,
      macd1m: indicatorData.indicators?.macd1m || null,
      macd5m: indicatorData.indicators?.macd5m || null,
      ema1m12: indicatorData.indicators?.ema1m12 || null,
      ema1m18: indicatorData.indicators?.ema1m18 || null,
      ema1m20: indicatorData.indicators?.ema1m20 || null,
      ema1m26: indicatorData.indicators?.ema1m26 || null,
      ema1m200: indicatorData.indicators?.ema1m200 || null,
      ema5m12: indicatorData.indicators?.ema5m12 || null,
      ema5m18: indicatorData.indicators?.ema5m18 || null,
      ema5m20: indicatorData.indicators?.ema5m20 || null,
      ema5m26: indicatorData.indicators?.ema5m26 || null,
      ema5m200: indicatorData.indicators?.ema5m200 || null,
      lastClose: indicatorData.lastCandle?.close || null,
      candleCounts: indicatorData.candleCounts || null,
      session: indicatorData.dataQuality?.session || null
    };

    // Always log new entry - this shows data collection is happening every minute
    // Values will be the same until new candles arrive (every 1 min for 1m candles, 5 min for 5m candles)
    this.verificationData.push(logEntry);

    // Save to file every entry (write atomically)
    this.saveVerificationLog();

    console.log(`[Verification] ✓ Logged: ${symbol} - MACD 1m: ${indicatorData.indicators?.macd1m?.macd?.toFixed(4)}, MACD 5m: ${indicatorData.indicators?.macd5m?.macd?.toFixed(4)}`);
  }

  /**
   * Save verification log to disk
   */
  saveVerificationLog() {
    if (!this.currentLogFile) {
      this.initializeDailyLog();
    }

    try {
      // Write atomically using tmp file
      const tmpFile = this.currentLogFile + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(this.verificationData, null, 2), 'utf8');
      fs.renameSync(tmpFile, this.currentLogFile);
    } catch (error) {
      console.error('[Verification] Error saving log:', error.message);
    }
  }

  /**
   * Get verification statistics
   */
  getStatistics() {
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.verificationLogPath, `verification_${today}.json`);

    if (!fs.existsSync(logFile)) {
      return {
        entriesToday: 0,
        symbolsTracked: this.trackingSymbols.length,
        symbols: this.trackingSymbols
      };
    }

    try {
      const data = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      const entriesBySymbol = {};
      
      data.forEach(entry => {
        if (!entriesBySymbol[entry.symbol]) {
          entriesBySymbol[entry.symbol] = 0;
        }
        entriesBySymbol[entry.symbol]++;
      });

      return {
        entriesToday: data.length,
        entriesBySymbol,
        symbolsTracked: this.trackingSymbols.length,
        symbols: this.trackingSymbols,
        latestEntry: data.length > 0 ? data[data.length - 1] : null
      };
    } catch (error) {
      console.error('[Verification] Error reading statistics:', error.message);
      return {
        entriesToday: 0,
        symbolsTracked: this.trackingSymbols.length,
        symbols: this.trackingSymbols
      };
    }
  }

  /**
   * Get all verification data for a specific symbol
   * @param {string} symbol - Stock symbol to get data for
   * @param {string} date - Date in YYYY-MM-DD format (optional, defaults to today)
   * @returns {Array} Array of verification entries
   */
  getSymbolData(symbol, date = null) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const logFile = path.join(this.verificationLogPath, `verification_${targetDate}.json`);
    
    if (!fs.existsSync(logFile)) {
      return [];
    }

    try {
      const data = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      return data.filter(entry => entry.symbol === symbol);
    } catch (error) {
      console.error('[Verification] Error reading symbol data:', error.message);
      return [];
    }
  }

  /**
   * Get all verification data for a specific date
   * @param {string} date - Date in YYYY-MM-DD format (optional, defaults to today)
   * @returns {Array} Array of all verification entries
   */
  getAllData(date = null) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const logFile = path.join(this.verificationLogPath, `verification_${targetDate}.json`);
    
    if (!fs.existsSync(logFile)) {
      return [];
    }

    try {
      const data = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      return data;
    } catch (error) {
      console.error('[Verification] Error reading all data:', error.message);
      return [];
    }
  }

  /**
   * Export verification data as CSV for easy analysis
   */
  exportAsCSV(date = null) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const logFile = path.join(this.verificationLogPath, `verification_${targetDate}.json`);
    
    if (!fs.existsSync(logFile)) {
      throw new Error(`No verification data found for ${targetDate}`);
    }

    try {
      const data = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      
      // CSV header
      const headers = [
        'timestamp',
        'symbol',
        'macd1m.macd',
        'macd1m.signal',
        'macd1m.histogram',
        'macd5m.macd',
        'macd5m.signal',
        'macd5m.histogram',
        'ema1m12',
        'ema1m18',
        'ema1m20',
        'ema1m26',
        'ema1m200',
        'ema5m12',
        'ema5m18',
        'ema5m20',
        'ema5m26',
        'ema5m200',
        'lastClose'
      ];

      const csvLines = [headers.join(',')];

      data.forEach(entry => {
        const row = [
          entry.timestamp,
          entry.symbol,
          entry.macd1m?.macd?.toString() || '',
          entry.macd1m?.signal?.toString() || '',
          entry.macd1m?.histogram?.toString() || '',
          entry.macd5m?.macd?.toString() || '',
          entry.macd5m?.signal?.toString() || '',
          entry.macd5m?.histogram?.toString() || '',
          entry.ema1m12?.toString() || '',
          entry.ema1m18?.toString() || '',
          entry.ema1m20?.toString() || '',
          entry.ema1m26?.toString() || '',
          entry.ema1m200?.toString() || '',
          entry.ema5m12?.toString() || '',
          entry.ema5m18?.toString() || '',
          entry.ema5m20?.toString() || '',
          entry.ema5m26?.toString() || '',
          entry.ema5m200?.toString() || '',
          entry.lastClose?.toString() || ''
        ];
        csvLines.push(row.join(','));
      });

      const csvFile = logFile.replace('.json', '.csv');
      fs.writeFileSync(csvFile, csvLines.join('\n'), 'utf8');
      
      console.log(`[Verification] Exported CSV: ${csvFile}`);
      return csvFile;
    } catch (error) {
      throw new Error(`Failed to export CSV: ${error.message}`);
    }
  }
}

module.exports = MACDEMAVerificationService;

