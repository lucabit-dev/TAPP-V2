/**
 * Polygon.io Exact MACD and EMA Calculation Logic
 * 
 * This module implements the exact mathematical formulas used by Polygon.io
 * in their /v1/indicators/macd endpoint. All calculations use high-precision
 * arithmetic to match Polygon's outputs.
 * 
 * Key formulas:
 * - EMA: Initialize with SMA of first period closes, then use multiplier = 2/(period+1)
 * - MACD: macd_line = EMA(short) - EMA(long), signal = EMA(macd_line), histogram = macd_line - signal
 */

/**
 * Calculate EMA using Polygon's exact formula
 * 
 * Formula:
 * multiplier = 2 / (period + 1)
 * ema_today = (price_today - ema_yesterday) * multiplier + ema_yesterday
 * 
 * Initialization: ema_yesterday = simple average of first 'period' closes
 * 
 * @param {number[]} values - Array of closing prices
 * @param {number} period - EMA period (e.g., 12, 26, 9)
 * @returns {number|null} - Current EMA value or null if insufficient data
 */
function calculateEMA(values, period) {
  if (!values || values.length === 0) {
    return null;
  }

  if (values.length < period) {
    return null;
  }

  // Initialize EMA with simple average of first 'period' values (SMA initialization)
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let ema_yesterday = sum / period;

  // Polygon's EMA formula
  const multiplier = 2 / (period + 1);

  // Calculate EMA for remaining values
  for (let i = period; i < values.length; i++) {
    const price_today = values[i];
    ema_yesterday = (price_today - ema_yesterday) * multiplier + ema_yesterday;
  }

  return ema_yesterday;
}

/**
 * Calculate MACD using Polygon's exact formula
 * 
 * Formula:
 * macd_line = EMA(short_period, closes) - EMA(long_period, closes)
 * signal_line = EMA(signal_period, macd_line)
 * histogram = macd_line - signal_line
 * 
 * Default parameters:
 * - short_period = 12
 * - long_period = 26
 * - signal_period = 9
 * 
 * @param {number[]} closes - Array of closing prices
 * @param {number} shortPeriod - Fast EMA period (default: 12)
 * @param {number} longPeriod - Slow EMA period (default: 26)
 * @param {number} signalPeriod - Signal line EMA period (default: 9)
 * @returns {Array} - Array of MACD objects with {timestamp, value, signal, histogram}
 */
function calculateMACD(closes, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
  if (!closes || closes.length === 0) {
    return [];
  }

  // Need enough data: max(long_period) + signal_period
  const minRequired = longPeriod + signalPeriod;
  if (closes.length < minRequired) {
    return [];
  }

  // Calculate fast and slow EMAs for MACD line
  const macdLine = [];
  
  for (let i = 0; i < closes.length; i++) {
    if (i < longPeriod) {
      // Not enough data yet
      macdLine.push(null);
      continue;
    }

    // Calculate fast EMA up to current point
    const fastSlice = closes.slice(0, i + 1);
    const fastEMA = calculateEMA(fastSlice, shortPeriod);
    
    // Calculate slow EMA up to current point
    const slowSlice = closes.slice(0, i + 1);
    const slowEMA = calculateEMA(slowSlice, longPeriod);
    
    if (fastEMA !== null && slowEMA !== null) {
      const macdValue = fastEMA - slowEMA;
      macdLine.push(macdValue);
    } else {
      macdLine.push(null);
    }
  }

  // Filter out null values
  const validMACDLine = macdLine.filter(v => v !== null);
  
  if (validMACDLine.length === 0) {
    return [];
  }

  // Calculate signal line by applying EMA to MACD line
  const signalLine = [];
  
  // Need at least signalPeriod MACD values to calculate signal
  const requiredMACDValues = longPeriod + signalPeriod;
  
  for (let i = requiredMACDValues - longPeriod; i < macdLine.length; i++) {
    if (macdLine[i] === null) {
      signalLine.push(null);
      continue;
    }

    // Extract valid MACD values up to this point
    const macdValuesUpToHere = macdLine.slice(longPeriod, i + 1);
    const validMACD = macdValuesUpToHere.filter(v => v !== null);
    
    if (validMACD.length < signalPeriod) {
      signalLine.push(null);
      continue;
    }

    const signalEMA = calculateEMA(validMACD, signalPeriod);
    signalLine.push(signalEMA);
  }

  // Build result array
  const results = [];
  const signalStartIdx = requiredMACDValues - longPeriod;
  
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null) continue;
    
    const signalIdx = i - signalStartIdx;
    const signal = signalIdx >= 0 && signalIdx < signalLine.length ? signalLine[signalIdx] : null;
    
    if (signal !== null) {
      results.push({
        value: macdLine[i],
        signal: signal,
        histogram: macdLine[i] - signal
      });
    }
  }

  return results;
}

/**
 * Calculate single MACD result (latest values only)
 * Returns just the current MACD, signal, and histogram values
 * 
 * Efficient incremental implementation matching Polygon's exact logic
 * 
 * @param {number[]} closes - Array of closing prices
 * @param {number} shortPeriod - Fast EMA period (default: 12)
 * @param {number} longPeriod - Slow EMA period (default: 26)
 * @param {number} signalPeriod - Signal line EMA period (default: 9)
 * @returns {Object|null} - {macd, signal, histogram} or null
 */
function calculateMACDSingle(closes, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
  if (!closes || closes.length === 0) {
    return null;
  }

  const minRequired = longPeriod + signalPeriod;
  if (closes.length < minRequired) {
    return null;
  }

  try {
    // Initialize fast EMA with SMA
    let fastSum = 0;
    for (let i = 0; i < shortPeriod; i++) {
      fastSum += closes[i];
    }
    let emaFast = fastSum / shortPeriod;
    
    // Initialize slow EMA with SMA
    let slowSum = 0;
    for (let i = 0; i < longPeriod; i++) {
      slowSum += closes[i];
    }
    let emaSlow = slowSum / longPeriod;
    
    const fastMultiplier = 2 / (shortPeriod + 1);
    const slowMultiplier = 2 / (longPeriod + 1);
    
    // Build MACD line incrementally
    const macdLine = [];
    
    // Calculate EMAs incrementally starting from longPeriod
    for (let i = longPeriod; i < closes.length; i++) {
      const price = closes[i];
      
      // Update EMAs incrementally
      emaFast = (price - emaFast) * fastMultiplier + emaFast;
      emaSlow = (price - emaSlow) * slowMultiplier + emaSlow;
      
      // MACD line = fast EMA - slow EMA
      macdLine.push(emaFast - emaSlow);
    }
    
    if (macdLine.length < signalPeriod) {
      return null;
    }
    
    // Initialize signal line with SMA
    let signalSum = 0;
    for (let i = 0; i < signalPeriod; i++) {
      signalSum += macdLine[i];
    }
    let emaSignal = signalSum / signalPeriod;
    
    const signalMultiplier = 2 / (signalPeriod + 1);
    
    // Update signal line for remaining MACD values
    for (let i = signalPeriod; i < macdLine.length; i++) {
      emaSignal = (macdLine[i] - emaSignal) * signalMultiplier + emaSignal;
    }
    
    // Return latest values
    const latestMACD = macdLine[macdLine.length - 1];
    
    return {
      macd: latestMACD,
      signal: emaSignal,
      histogram: latestMACD - emaSignal
    };
  } catch (error) {
    console.error('Error in calculateMACDSingle:', error);
    return null;
  }
}

/**
 * Optimized incremental EMA update for real-time trading
 * 
 * Use this when you have the previous EMA value and a new price comes in.
 * This avoids recalculating the entire EMA from scratch.
 * 
 * @param {number} price_today - New closing price
 * @param {number} ema_yesterday - Previous EMA value
 * @param {number} period - EMA period
 * @returns {number} - Updated EMA value
 */
function updateEMAIncremental(price_today, ema_yesterday, period) {
  const multiplier = 2 / (period + 1);
  return (price_today - ema_yesterday) * multiplier + ema_yesterday;
}

/**
 * Calculate EMA for multiple periods in one pass
 * Returns a map of period -> EMA value
 * 
 * @param {number[]} values - Array of closing prices
 * @param {number[]} periods - Array of EMA periods to calculate
 * @returns {Object} - Map of period -> EMA value
 */
function calculateMultipleEMAs(values, periods) {
  const result = {};
  
  for (const period of periods) {
    result[period] = calculateEMA(values, period);
  }
  
  return result;
}

module.exports = {
  calculateEMA,
  calculateMACD,
  calculateMACDSingle,
  updateEMAIncremental,
  calculateMultipleEMAs
};

