const fetch = require('node-fetch');

class PolygonService {
  constructor() {
    this.baseUrl = 'https://api.polygon.io';
    this.apiKey = process.env.POLYGON_API_KEY || 'oLNQ0GD8RpIcP8X2iApVnlzg28P6Ttcc';
    
    // Log API key status (without exposing full key)
    if (process.env.POLYGON_API_KEY) {
      console.log(`[Polygon] Using API key from environment variable`);
    } else {
      console.log(`[Polygon] Using fallback API key (consider setting POLYGON_API_KEY environment variable)`);
    }
  }

  async fetchOHLCV(ticker, timeframe, from, to) {
    try {
      const url = `${this.baseUrl}/v2/aggs/ticker/${ticker}/range/${timeframe}/minute/${from}/${to}?apikey=${this.apiKey}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Polygon] HTTP error ${response.status} for ${ticker}: ${errorText}`);
        throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.status !== 'OK') {
        console.error(`[Polygon] API returned error status for ${ticker}:`, data);
        throw new Error(`Polygon API returned error: ${data.status}`);
      }
      
      const results = data.results || [];
      
      if (results.length === 0) {
        console.warn(`[Polygon] No data returned for ${ticker} (${from} to ${to})`);
        throw new Error(`No data returned from Polygon API for ${ticker}`);
      }
      
      console.log(`[Polygon] Successfully fetched ${results.length} candles for ${ticker}`);
      
      // Transform data to our expected format
      return results.map(candle => ({
        timestamp: new Date(candle.t),
        open: candle.o,
        high: candle.h,
        low: candle.l,
        close: candle.c,
        volume: candle.v,
        transactions: candle.n !== undefined ? candle.n : null
      })).sort((a, b) => a.timestamp - b.timestamp);
      
    } catch (error) {
      console.error(`[Polygon] Error fetching OHLCV for ${ticker}:`, error.message);
      throw error;
    }
  }

  // Get company information for a ticker
  async getCompanyInfo(ticker) {
    try {
      const url = `${this.baseUrl}/v3/reference/tickers/${ticker}?apikey=${this.apiKey}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Symbol ${ticker} not found`);
        }
        throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.status !== 'OK') {
        throw new Error(`Polygon API returned error: ${data.status}`);
      }
      
      const tickerData = data.results;
      
      if (!tickerData) {
        throw new Error(`No ticker data found for ${ticker}`);
      }
      
      return {
        symbol: tickerData.ticker,
        name: tickerData.name || tickerData.ticker,
        market: tickerData.market,
        primaryExchange: tickerData.primary_exchange,
        currency: tickerData.currency_name,
        description: tickerData.description || ''
      };
      
    } catch (error) {
      throw error;
    }
  }

  // Validate that a ticker is listed on NASDAQ
  async validateNASDAQ(ticker) {
    try {
      const companyInfo = await this.getCompanyInfo(ticker);
      
      
      // NASDAQ stocks have primary exchange as XNAS
      if (companyInfo.primaryExchange !== 'XNAS') {
        throw new Error(`Symbol ${ticker} is not listed on NASDAQ. Found on: ${companyInfo.primaryExchange}`);
      }
      
      return true;
      
    } catch (error) {
      throw error;
    }
  }


  async fetch1MinuteCandles(ticker, from, to) {
    return this.fetchOHLCV(ticker, 1, from, to);
  }

  async fetch5MinuteCandles(ticker, from, to) {
    return this.fetchOHLCV(ticker, 5, from, to);
  }

  // Fetch candles with extended trading hours support and precise intervals
  async fetchExtendedHoursCandles(ticker, timeframe, useExtendedHours = true, daysBack = 7) {
    try {
      let dateRange;
      
      if (useExtendedHours) {
        // Use extended trading hours range with specified days
        const hoursBack = daysBack * 24;
        dateRange = this.getExtendedTradingHoursRange();
        
        // Override the date range if requesting more days
        if (daysBack > 7) {
          const to = new Date();
          const from = new Date(to.getTime() - (hoursBack * 60 * 60 * 1000));
          dateRange.from = this.formatDateForAPI(from);
          dateRange.to = this.formatDateForAPI(to);
        }
        
        console.log(`[Extended Hours] Fetching ${timeframe}-minute candles for ${ticker} using extended hours range: ${dateRange.from} to ${dateRange.to} (Session: ${dateRange.session}, ${daysBack} days)`);
      } else {
        const hoursBack = daysBack * 24;
        dateRange = this.getDateRange(hoursBack);
      }
      
      const candles = await this.fetchOHLCV(ticker, timeframe, dateRange.from, dateRange.to);
      
      // Don't filter candles for extended hours - we need all historical data for EMA calculations
      // The validation was filtering out 99% of historical data, leaving only recent candles
      console.log(`[Extended Hours] Retrieved ${candles.length} ${timeframe}-minute candles for ${ticker}`);
      
      return {
        candles: candles,
        session: dateRange.session,
        isExtendedHours: dateRange.isExtendedHours,
        dataRange: {
          from: dateRange.from,
          to: dateRange.to
        }
      };
      
    } catch (error) {
      console.error(`[Extended Hours] Error fetching ${timeframe}-minute candles for ${ticker}:`, error);
      throw error;
    }
  }

  // Validate and filter candle data for real-time accuracy
  validateCandleData(candles, timeframe) {
    if (!candles || candles.length === 0) {
      return [];
    }

    const now = new Date();
    const timeframeMinutes = parseInt(timeframe);
    const maxAgeMinutes = timeframeMinutes * 3; // Allow up to 3 intervals old
    
    return candles.filter(candle => {
      const candleTime = new Date(candle.timestamp);
      const ageMinutes = (now - candleTime) / (1000 * 60);
      
      // Validate data freshness
      const isFresh = ageMinutes <= maxAgeMinutes;
      
      // Validate OHLC data integrity
      const hasValidOHLC = candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0;
      const hasValidVolume = candle.volume >= 0;
      
      return isFresh && hasValidOHLC && hasValidVolume;
    }).sort((a, b) => a.timestamp - b.timestamp);
  }

  // Helper method to format date for Polygon API
  formatDateForAPI(date) {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  }

  // Get current price for a ticker
  async getCurrentPrice(ticker) {
    try {
      const url = `${this.baseUrl}/v2/last/trade/${ticker}?apikey=${this.apiKey}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.status !== 'OK') {
        throw new Error(`Polygon API returned error: ${data.status}`);
      }
      
      const result = data.results;
      
      if (!result || !result.p) {
        throw new Error(`No price data available for ${ticker}`);
      }
      
      const price = result.p;
      
      return price;
      
    } catch (error) {
      throw error;
    }
  }

  // Helper method to get date range - prioritize recent data with extended hours support
  getDateRange(hoursBack = 168) { // Default to 7 days for recent data
    const to = new Date();
    const from = new Date(to.getTime() - (hoursBack * 60 * 60 * 1000));
    
    return {
      from: this.formatDateForAPI(from),
      to: this.formatDateForAPI(to)
    };
  }

  // Get Eastern Time from UTC
  getEasternTime() {
    const now = new Date();
    // Convert to Eastern Time (handles both EST and EDT)
    const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return easternTime;
  }

  // Get extended trading hours date range with adaptive logic
  getExtendedTradingHoursRange() {
    const now = new Date();
    const easternTime = this.getEasternTime();
    const currentHour = easternTime.getHours();
    const currentMinute = easternTime.getMinutes();
    
    // Always fetch at least 7 days of data to ensure we have enough candles for EMA calculations
    // This ensures we have sufficient historical data regardless of trading session
    const to = new Date(now);
    const from = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)); // 7 days back
    
    // Log the current session for informational purposes
    if (currentHour >= 4 && currentHour < 9) {
      console.log(`[Extended Hours] Premarket session detected: ${currentHour}:${currentMinute.toString().padStart(2, '0')} ET`);
    } else if (currentHour >= 9 && currentHour < 16) {
      console.log(`[Extended Hours] Regular trading session detected: ${currentHour}:${currentMinute.toString().padStart(2, '0')} ET`);
    } else if (currentHour >= 16 && currentHour < 20) {
      console.log(`[Extended Hours] After-hours session detected: ${currentHour}:${currentMinute.toString().padStart(2, '0')} ET`);
    } else {
      console.log(`[Extended Hours] Outside trading hours: ${currentHour}:${currentMinute.toString().padStart(2, '0')} ET`);
    }
    
    return {
      from: this.formatDateForAPI(from),
      to: this.formatDateForAPI(to),
      session: this.getCurrentTradingSession(),
      isExtendedHours: this.isExtendedHours()
    };
  }

  // Determine current trading session
  getCurrentTradingSession() {
    const easternTime = this.getEasternTime();
    const currentHour = easternTime.getHours();
    
    if (currentHour >= 4 && currentHour < 9) {
      return 'premarket';
    } else if (currentHour >= 9 && currentHour < 16) {
      return 'regular';
    } else if (currentHour >= 16 && currentHour < 20) {
      return 'afterhours';
    } else {
      return 'closed';
    }
  }

  // Check if currently in extended hours
  isExtendedHours() {
    const session = this.getCurrentTradingSession();
    return session === 'premarket' || session === 'afterhours';
  }

  // Get extended date range for EMA200 calculation (when needed)
  getExtendedDateRange(hoursBack = 720) { // 30 days for EMA200
    const to = new Date();
    const from = new Date(to.getTime() - (hoursBack * 60 * 60 * 1000));
    
    return {
      from: this.formatDateForAPI(from),
      to: this.formatDateForAPI(to)
    };
  }

  // Calculate EMA using TradingView compatible method
  calculateEMA(values, span, adjust = false) {
    if (!values || values.length === 0) {
      return null;
    }

    if (values.length < span) {
      return null;
    }

    try {
      // Calculate multiplier (smoothing factor)
      const multiplier = 2 / (span + 1);
      
      // Seed with SMA of first period values (TradingView method)
      let sum = 0;
      for (let i = 0; i < span; i++) {
        sum += values[i];
      }
      let ema = sum / span;
      
      // Calculate EMA for remaining values using TradingView formula
      for (let i = span; i < values.length; i++) {
        ema = (values[i] - ema) * multiplier + ema;
      }
      
      return ema;
    } catch (error) {
      return null;
    }
  }

  // Fetch MACD indicator from Polygon.io
  async fetchMACD(ticker, timespan = 'minute', shortWindow = 12, longWindow = 26, signalWindow = 9) {
    try {
      // Validate timespan parameter according to Polygon.io documentation
      const supportedTimespans = ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];
      
      if (!supportedTimespans.includes(timespan)) {
        throw new Error(`Unsupported timespan '${timespan}'. Supported values: ${supportedTimespans.join(', ')}`);
      }
      
      const url = `${this.baseUrl}/v1/indicators/macd/${ticker}?timespan=${timespan}&adjusted=true&short_window=${shortWindow}&long_window=${longWindow}&signal_window=${signalWindow}&series_type=close&expand_underlying=false&order=desc&limit=200&apikey=${this.apiKey}`;
      
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.status !== 'OK') {
        throw new Error(`Polygon API returned error: ${data.status}`);
      }
      
      const results = data.results;
      
      if (!results || !results.values || results.values.length === 0) {
        throw new Error(`No MACD data returned from Polygon API for ${ticker}`);
      }
      
      // Get the most recent MACD values (first in the array since it's ordered desc)
      const latestMACD = results.values[0];
      
      
      return {
        macd: latestMACD.value,
        signal: latestMACD.signal,
        histogram: latestMACD.histogram,
        timestamp: new Date(latestMACD.timestamp)
      };
      
    } catch (error) {
      throw error;
    }
  }

  // Fetch EMA values using Polygon aggregates and calculate locally with extended hours support
  async fetchEMAValues(ticker, timeframe, period, hoursBack = 168, useExtendedHours = true) {
    try {
      let candleData;
      
      if (useExtendedHours && hoursBack === 168) {
        // Use extended trading hours data for more accurate real-time calculations (default 7 days)
        const extendedData = await this.fetchExtendedHoursCandles(ticker, timeframe, true);
        candleData = extendedData.candles;
        console.log(`[Extended Hours] EMA ${period} calculation using ${extendedData.session} session data`);
      } else {
        // Use specified hoursBack for adaptive fetching
        const dateRange = this.getDateRange(hoursBack);
        candleData = await this.fetchOHLCV(ticker, timeframe, dateRange.from, dateRange.to);
        console.log(`[EMA] Fetching ${hoursBack} hours of data for EMA ${period} calculation`);
      }
      
      if (!candleData || candleData.length === 0) {
        throw new Error(`No candle data available for EMA calculation`);
      }
      
      // Extract close prices
      const closes = candleData.map(candle => candle.close);
      
      // Calculate EMA with enhanced precision
      const emaValue = this.calculateEMA(closes, period);
      
      if (emaValue === null) {
        throw new Error(`Cannot calculate EMA ${period} from ${closes.length} candles (need at least ${period})`);
      }
      
      console.log(`[EMA] EMA ${period} calculated: ${emaValue.toFixed(4)} from ${closes.length} candles`);
      
      return {
        value: emaValue,
        timestamp: candleData[candleData.length - 1].timestamp,
        candleCount: candleData.length,
        dataRange: {
          first: closes[0],
          last: closes[closes.length - 1]
        },
        isExtendedHours: useExtendedHours && hoursBack === 168
      };
      
    } catch (error) {
      console.error(`[EMA] Error calculating EMA ${period} for ${ticker}: ${error.message}`);
      throw error;
    }
  }

  // Fetch all EMA values needed for trading conditions with adaptive data fetching
  async fetchAllEMAValues(ticker) {
    try {
      
      // Fetch 1-minute EMAs (recent data - 7 days)
      const ema1m18 = await this.fetchEMAValues(ticker, 1, 18, 168); // 7 days
      const ema1m200 = await this.fetchEMAValues(ticker, 1, 200, 168); // 7 days
      
      // Fetch 5-minute EMAs with adaptive range - start with 7 days and increase if needed
      let ema5m18, ema5m200;
      
      // Adaptive fetching for EMA200 5min - try progressively longer periods
      const timeRanges = [
        { hours: 168, label: '7 days' },
        { hours: 360, label: '15 days' },
        { hours: 720, label: '30 days' },
        { hours: 1440, label: '60 days' }
      ];
      
      // Try EMA18 first
      let ema5m18Success = false;
      for (const timeRange of timeRanges) {
        try {
          // Disable extended hours for longer periods to get more historical data
          const useExtendedHours = timeRange.hours === 168;
          ema5m18 = await this.fetchEMAValues(ticker, 5, 18, timeRange.hours, useExtendedHours);
          console.log(`[Adaptive] EMA5m18 successful with ${timeRange.label} (${ema5m18.candleCount} candles)`);
          ema5m18Success = true;
          break;
        } catch (error) {
          console.log(`[Adaptive] EMA5m18 failed with ${timeRange.label}, trying more data...`);
        }
      }
      
      if (!ema5m18Success) {
        throw new Error(`Failed to calculate EMA5m18 after trying all time ranges`);
      }
      
      // Try EMA200 with adaptive range
      let ema5m200Success = false;
      for (const timeRange of timeRanges) {
        try {
          // Disable extended hours for longer periods to get more historical data
          const useExtendedHours = timeRange.hours === 168;
          ema5m200 = await this.fetchEMAValues(ticker, 5, 200, timeRange.hours, useExtendedHours);
          console.log(`[Adaptive] EMA5m200 successful with ${timeRange.label} (${ema5m200.candleCount} candles)`);
          ema5m200Success = true;
          break;
        } catch (error) {
          console.log(`[Adaptive] EMA5m200 failed with ${timeRange.label}, trying more data...`);
        }
      }
      
      if (!ema5m200Success) {
        console.warn(`[Adaptive] EMA5m200 calculation failed for ${ticker} - will return null`);
        ema5m200 = { value: null, candleCount: 0, error: 'Insufficient candles' };
      }
      
      const results = {
        ema1m18: ema1m18.value,
        ema1m200: ema1m200.value,
        ema5m18: ema5m18.value,
        ema5m200: ema5m200.value,
        metadata: {
          ema1m18: ema1m18,
          ema1m200: ema1m200,
          ema5m18: ema5m18,
          ema5m200: ema5m200
        }
      };
      
      
      return results;
      
    } catch (error) {
      throw error;
    }
  }

  // Calculate MACD locally using technicalindicators library
  calculateMACDLocal(candles, timeframe = '1m', fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!candles || candles.length === 0) {
      return null;
    }

    const closes = candles.map(candle => candle.close);
    
    // MACD needs at least slowPeriod + signalPeriod candles
    const minCandles = slowPeriod + signalPeriod;
    if (closes.length < minCandles) {
      return null;
    }
    
    try {
      
      const { MACD } = require('technicalindicators');
      
      const macd = MACD.calculate({
        values: closes,
        fastPeriod: fastPeriod,
        slowPeriod: slowPeriod,
        signalPeriod: signalPeriod,
        SimpleMAOscillator: false,
        SimpleMASignal: false
      });
      
      if (macd.length > 0) {
        const lastMACD = macd[macd.length - 1];
        
        return {
          macd: lastMACD.MACD,
          signal: lastMACD.signal,
          histogram: lastMACD.histogram,
          timestamp: new Date(),
          lastClose: closes[closes.length-1],
          candleCount: closes.length
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  // Calculate MACD using TradingView-compatible method
  calculateMACDWithEMA(candles, timeframe = '1m', fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!candles || candles.length === 0) {
      return null;
    }

    const closes = candles.map(candle => candle.close);
    
    // Need enough data for the slowest EMA + signal period
    const minCandles = slowPeriod + signalPeriod;
    if (closes.length < minCandles) {
      return null;
    }
    
    try {
      // Calculate EMAs using TradingView method
      const fastMultiplier = 2 / (fastPeriod + 1);
      const slowMultiplier = 2 / (slowPeriod + 1);
      
      // Initialize EMAs with SMA
      let fastSum = 0;
      for (let i = 0; i < fastPeriod; i++) {
        fastSum += closes[i];
      }
      let emaFast = fastSum / fastPeriod;
      
      let slowSum = 0;
      for (let i = 0; i < slowPeriod; i++) {
        slowSum += closes[i];
      }
      let emaSlow = slowSum / slowPeriod;
      
      // Calculate MACD line values
      const macdLine = [];
      
      // Start from slowPeriod (when both EMAs are valid)
      for (let i = slowPeriod; i < closes.length; i++) {
        // Update fast EMA
        if (i >= fastPeriod) {
          emaFast = (closes[i] - emaFast) * fastMultiplier + emaFast;
        }
        
        // Update slow EMA
        emaSlow = (closes[i] - emaSlow) * slowMultiplier + emaSlow;
        
        // Calculate MACD line
        macdLine.push(emaFast - emaSlow);
      }
      
      if (macdLine.length === 0) {
        return null;
      }
      
      // Calculate signal line (EMA of MACD line)
      const signalMultiplier = 2 / (signalPeriod + 1);
      
      // Initialize signal EMA with SMA of first signalPeriod MACD values
      let signalSum = 0;
      for (let i = 0; i < signalPeriod; i++) {
        signalSum += macdLine[i];
      }
      let emaSignal = signalSum / signalPeriod;
      
      // Calculate signal line for remaining values
      for (let i = signalPeriod; i < macdLine.length; i++) {
        emaSignal = (macdLine[i] - emaSignal) * signalMultiplier + emaSignal;
      }
      
      // Get latest values
      const latestMACD = macdLine[macdLine.length - 1];
      const latestSignal = emaSignal;
      const histogram = latestMACD - latestSignal;
      
      
      return {
        macd: latestMACD,
        signal: latestSignal,
        histogram: histogram,
        timestamp: new Date(),
        lastClose: closes[closes.length-1],
        candleCount: closes.length,
        fastEMA: emaFast,
        slowEMA: emaSlow,
        macdLine: macdLine,
        signalLine: latestSignal
      };
    } catch (error) {
      return null;
    }
  }

  // Fetch all MACD values needed for trading conditions with extended hours support
  async fetchAllMACDValues(ticker, useExtendedHours = true) {
    try {
      console.log(`[TradingView MACD] Fetching MACD values for ${ticker} with extended hours: ${useExtendedHours}`);
      
      // Use only local TradingView-compatible calculation for both 1m and 5m
      let macd1m, macd5m;
      
      // Get 1-minute candles using extended hours data
      if (useExtendedHours) {
        const extendedData1m = await this.fetchExtendedHoursCandles(ticker, 1, true);
        macd1m = this.calculateMACDWithEMA(extendedData1m.candles, '1m', 12, 26, 9);
        console.log(`[TradingView MACD] 1-minute MACD calculated using ${extendedData1m.session} session`);
      } else {
        const dateRange = this.getDateRange(168); // 7 days
        const candles1m = await this.fetch1MinuteCandles(ticker, dateRange.from, dateRange.to);
        macd1m = this.calculateMACDWithEMA(candles1m, '1m', 12, 26, 9);
      }
      
      if (!macd1m) {
        throw new Error('1-minute MACD calculation failed');
      }
      
      // Get 5-minute candles using extended hours data
      if (useExtendedHours) {
        const extendedData5m = await this.fetchExtendedHoursCandles(ticker, 5, true);
        macd5m = this.calculateMACDWithEMA(extendedData5m.candles, '5m', 12, 26, 9);
        console.log(`[TradingView MACD] 5-minute MACD calculated using ${extendedData5m.session} session`);
      } else {
        const dateRange = this.getDateRange(168); // 7 days
        const candles5m = await this.fetch5MinuteCandles(ticker, dateRange.from, dateRange.to);
        macd5m = this.calculateMACDWithEMA(candles5m, '5m', 12, 26, 9);
      }
      
      if (!macd5m) {
        throw new Error('5-minute MACD calculation failed');
      }

      const results = {
        macd1m: {
          macd: macd1m.macd,
          signal: macd1m.signal,
          histogram: macd1m.histogram
        },
        macd5m: {
          macd: macd5m.macd,
          signal: macd5m.signal,
          histogram: macd5m.histogram
        },
        metadata: {
          macd1m: macd1m,
          macd5m: macd5m,
          useExtendedHours: useExtendedHours
        }
      };
      
      console.log(`[TradingView MACD] MACD values calculated for ${ticker} - 1m: ${macd1m.macd?.toFixed(4)}, 5m: ${macd5m.macd?.toFixed(4)}`);
      
      return results;
      
    } catch (error) {
      throw error;
    }
  }
}

module.exports = PolygonService;
