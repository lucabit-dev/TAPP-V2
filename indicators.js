class IndicatorsService {
  constructor() {
    // All calculations are done manually, no need for instance variables
  }

  // Manual EMA calculation function - TradingView compatible
  calculateManualEMA(values, period) {
    if (!values || values.length === 0) {
      return null;
    }

    if (values.length < period) {
      return null;
    }

    // TradingView EMA method: Seed with SMA of first period values
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += values[i];
    }
    let ema = sum / period;

    // Calculate EMA for remaining values using TradingView formula
    const multiplier = 2 / (period + 1);
    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  calculateEMA(candles, period, timeframe = '1m') {
    if (!candles || candles.length === 0) {
      return null;
    }

    const closes = candles.map(candle => candle.close);
    
    // Check if we have enough data for the period
    if (closes.length < period) {
      return null;
    }
    
    try {
      
      // Use manual EMA calculation for consistency
      const result = this.calculateManualEMA(closes, period);
      
      if (result === null) {
        return null;
      }
      
      
      return result;
    } catch (error) {
      return null;
    }
  }

  // Manual MACD calculation function with proper signal line - TradingView compatible
  calculateManualMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!closes || closes.length === 0) {
      return null;
    }

    // MACD needs at least slowPeriod + signalPeriod candles
    const minCandles = slowPeriod + signalPeriod;
    if (closes.length < minCandles) {
      return null;
    }

    // Calculate EMA_fast and EMA_slow efficiently
    const emaFastMultiplier = 2 / (fastPeriod + 1);
    const emaSlowMultiplier = 2 / (slowPeriod + 1);
    
    // Calculate fast EMA - seed with SMA
    let fastSum = 0;
    for (let i = 0; i < fastPeriod; i++) {
      fastSum += closes[i];
    }
    let emaFast = fastSum / fastPeriod;
    
    // Calculate slow EMA - seed with SMA
    let slowSum = 0;
    for (let i = 0; i < slowPeriod; i++) {
      slowSum += closes[i];
    }
    let emaSlow = slowSum / slowPeriod;
    
    // Calculate MACD line values efficiently
    const macdLineValues = [];
    
    // Start from slowPeriod (when we have both EMAs)
    for (let i = slowPeriod; i < closes.length; i++) {
      // Update fast EMA
      if (i >= fastPeriod) {
        emaFast = (closes[i] - emaFast) * emaFastMultiplier + emaFast;
      }
      
      // Update slow EMA
      emaSlow = (closes[i] - emaSlow) * emaSlowMultiplier + emaSlow;
      
      // Calculate MACD line
      macdLineValues.push(emaFast - emaSlow);
    }

    // Get the latest MACD line value
    const latestMacdLine = macdLineValues[macdLineValues.length - 1];
    if (latestMacdLine === null || macdLineValues.length === 0) {
      return null;
    }

    // Calculate signal line (EMA of MACD line values)
    if (macdLineValues.length < signalPeriod) {
      return null;
    }

    const signalLine = this.calculateManualEMA(macdLineValues, signalPeriod);
    if (signalLine === null) {
      return null;
    }

    // Histogram = MACD line - Signal line
    const histogram = latestMacdLine - signalLine;

    return {
      macd: latestMacdLine,
      signal: signalLine,
      histogram: histogram
    };
  }

  calculateMACD(candles, timeframe = '1m', fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
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
      
      // Use manual MACD calculation
      const result = this.calculateManualMACD(closes, fastPeriod, slowPeriod, signalPeriod);
      
      if (result === null) {
        return null;
      }
      
      
      return result;
    } catch (error) {
      return null;
    }
  }

  calculateVWAP(candles, timeframe = '1m') {
    if (!candles || candles.length === 0) {
      return null;
    }

    try {
      
      let totalVolume = 0;
      let totalVWAP = 0;
      let validCandles = 0;

      for (const candle of candles) {
        const typicalPrice = (candle.high + candle.low + candle.close) / 3;
        const volume = candle.volume || 0;
        
        if (volume > 0) {
          totalVWAP += typicalPrice * volume;
          totalVolume += volume;
          validCandles++;
        }
      }

      const result = totalVolume > 0 ? totalVWAP / totalVolume : null;
      
      return result;
    } catch (error) {
      return null;
    }
  }

  // Calculate Low of Day (LOD) and High of Day (HOD)
  calculateLODHOD(candles) {
    if (!candles || candles.length === 0) {
      return { lod: null, hod: null };
    }

    try {
      
      let lod = candles[0].low;
      let hod = candles[0].high;

      for (const candle of candles) {
        if (candle.low < lod) {
          lod = candle.low;
        }
        if (candle.high > hod) {
          hod = candle.high;
        }
      }

      
      return { lod, hod };
    } catch (error) {      return { lod: null, hod: null };
    }
  }

  async calculateAllIndicators(ticker, candles1m, candles5m, isExtendedHours = false) {
    
    // Validate data freshness with extended hours support
    this.validateDataFreshness(ticker, candles1m, candles5m, isExtendedHours);
    
    // Verify time alignment between 1m and 5m candles
    this.verifyTimeAlignment(candles1m, candles5m);
    
    try {
      console.log(`[Extended Hours] Calculating indicators for ${ticker} (Extended Hours: ${isExtendedHours})`);
      
      // Calculate all indicators manually using our custom functions with enhanced precision
      
      // Calculate 1-minute indicators
      const ema1m12 = this.calculateEMA(candles1m, 12, '1m');
      const ema1m18 = this.calculateEMA(candles1m, 18, '1m');
      const ema1m20 = this.calculateEMA(candles1m, 20, '1m');
      const ema1m26 = this.calculateEMA(candles1m, 26, '1m');
      const ema1m200 = this.calculateEMA(candles1m, 200, '1m');
      const macd1m = this.calculateMACD(candles1m, '1m');
      const vwap1m = this.calculateVWAP(candles1m, '1m');
      
      // Calculate 5-minute indicators
      const ema5m12 = this.calculateEMA(candles5m, 12, '5m');
      const ema5m18 = this.calculateEMA(candles5m, 18, '5m');
      const ema5m20 = this.calculateEMA(candles5m, 20, '5m');
      const ema5m26 = this.calculateEMA(candles5m, 26, '5m');
      const ema5m200 = this.calculateEMA(candles5m, 200, '5m');
      const macd5m = this.calculateMACD(candles5m, '5m');
      
      // Calculate LOD and HOD (Low/High of Day)
      const { lod, hod } = this.calculateLODHOD(candles1m);
      
      // Log key indicator values for verification
      console.log(`[Extended Hours] Key indicators for ${ticker}:`);
      console.log(`  EMA 1m18: ${ema1m18?.toFixed(4)}, EMA 5m18: ${ema5m18?.toFixed(4)}`);
      console.log(`  EMA 5m200: ${ema5m200?.toFixed(4)}`);
      console.log(`  MACD 1m: ${macd1m?.macd?.toFixed(4)}, MACD 5m: ${macd5m?.macd?.toFixed(4)}`);
      console.log(`  MACD 5m Histogram: ${macd5m?.histogram?.toFixed(4)}`);
      
      const results = {
        ticker,
        timestamp: new Date().toISOString(),
        indicators: {
          ema1m12,
          ema1m18,
          ema1m20,
          ema1m26,
          ema1m200,
          ema5m12,
          ema5m18,
          ema5m20,
          ema5m26,
          ema5m200,
          macd1m,
          macd5m,
          vwap1m,
          lod,
          hod
        },
        lastCandle: candles1m.length > 0 ? candles1m[candles1m.length - 1] : null,
        candleCounts: {
          candles1m: candles1m.length,
          candles5m: candles5m.length
        },
        manualCalculation: true,
        isExtendedHours: isExtendedHours,
        dataQuality: {
          isFresh: this.isDataFresh(candles1m, candles5m, isExtendedHours),
          session: this.getCurrentSession(),
          lastUpdate: new Date()
        }
      };

      console.log(`[Extended Hours] Indicators calculation completed for ${ticker}`);
      return results;
      
    } catch (error) {
      console.error(`[Extended Hours] Error calculating indicators for ${ticker}:`, error);
      throw error;
    }
  }

  // Check if data is fresh enough for real-time analysis
  isDataFresh(candles1m, candles5m, isExtendedHours) {
    if (!candles1m || !candles5m || candles1m.length === 0 || candles5m.length === 0) {
      return false;
    }

    const now = new Date();
    const last1mTime = new Date(candles1m[candles1m.length - 1].timestamp);
    const last5mTime = new Date(candles5m[candles5m.length - 1].timestamp);
    
    const minutesSinceLast1m = Math.round((now - last1mTime) / (1000 * 60));
    const minutesSinceLast5m = Math.round((now - last5mTime) / (1000 * 60));
    
    const maxStaleMinutes1m = isExtendedHours ? 15 : 30;
    const maxStaleMinutes5m = isExtendedHours ? 30 : 60;
    
    return minutesSinceLast1m <= maxStaleMinutes1m && minutesSinceLast5m <= maxStaleMinutes5m;
  }

  // Get current trading session
  getCurrentSession() {
    const now = new Date();
    const currentHour = now.getHours();
    
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

  // Normalize timestamp to timeframe (floor to timeframe)
  normalizeToTimeframe(timestamp, timeframeMinutes) {
    const date = new Date(timestamp);
    const minutes = date.getMinutes();
    const flooredMinutes = Math.floor(minutes / timeframeMinutes) * timeframeMinutes;
    date.setMinutes(flooredMinutes, 0, 0); // Set seconds and milliseconds to 0
    return date;
  }

  // Validate that candle data is recent and not stale with extended hours support
  validateDataFreshness(ticker, candles1m, candles5m, isExtendedHours = false) {
    if (!candles1m || !candles5m || candles1m.length === 0 || candles5m.length === 0) {
      return;
    }

    const last1mTime = new Date(candles1m[candles1m.length - 1].timestamp);
    const last5mTime = new Date(candles5m[candles5m.length - 1].timestamp);
    const now = new Date();
    
    // Calculate minutes since last candle for more precise validation
    const minutesSinceLast1m = Math.round((now - last1mTime) / (1000 * 60));
    const minutesSinceLast5m = Math.round((now - last5mTime) / (1000 * 60));
    
    // Adjust validation thresholds based on extended hours
    const maxStaleMinutes1m = isExtendedHours ? 15 : 30; // 15 min for extended hours, 30 min for regular
    const maxStaleMinutes5m = isExtendedHours ? 30 : 60; // 30 min for extended hours, 60 min for regular
    
    console.log(`[Extended Hours] Data freshness validation for ${ticker}:`);
    console.log(`  1m candles: ${minutesSinceLast1m} minutes old (max: ${maxStaleMinutes1m})`);
    console.log(`  5m candles: ${minutesSinceLast5m} minutes old (max: ${maxStaleMinutes5m})`);
    
    // Warn if data is too old for real-time trading analysis
    if (minutesSinceLast1m > maxStaleMinutes1m) {
      console.warn(`[Extended Hours] 1-minute data for ${ticker} is ${minutesSinceLast1m} minutes old (stale)`);
    }
    
    if (minutesSinceLast5m > maxStaleMinutes5m) {
      console.warn(`[Extended Hours] 5-minute data for ${ticker} is ${minutesSinceLast5m} minutes old (stale)`);
    }
    
    if (minutesSinceLast1m <= maxStaleMinutes1m && minutesSinceLast5m <= maxStaleMinutes5m) {
      console.log(`[Extended Hours] Data for ${ticker} is fresh and suitable for real-time analysis`);
    }
  }

  // Verify that 1m and 5m candles are properly aligned in time
  verifyTimeAlignment(candles1m, candles5m) {
    if (!candles1m || !candles5m || candles1m.length === 0 || candles5m.length === 0) {
      return;
    }

    const last1mTime = new Date(candles1m[candles1m.length - 1].timestamp);
    const last5mTime = new Date(candles5m[candles5m.length - 1].timestamp);
    
    // Normalize 1m time to 5m timeframe for comparison
    const normalized1mTime = this.normalizeToTimeframe(last1mTime, 5);
    const normalized5mTime = this.normalizeToTimeframe(last5mTime, 5);
    
    
    // Check if normalized times match (within 1 minute tolerance)
    const timeDiff = Math.abs(normalized1mTime.getTime() - normalized5mTime.getTime());
    const maxAllowedDiff = 60 * 1000; // 1 minute in milliseconds
  
  }
}

module.exports = IndicatorsService;
