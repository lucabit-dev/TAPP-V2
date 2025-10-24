const fs = require('fs');
const path = require('path');

class ConditionsService {
  constructor() {
    this.conditionNames = {
      macd5mHistogramPositive: 'MACD Histogram (5m) > 0',
      macd5mPositive: 'MACD 5m > 0',
      macd1mPositive: 'MACD 1m > 0',
      closeAboveEma18_1m: 'Close > EMA 18 (1m)',
      ema18Above200_5m: 'EMA 18 (5m) > EMA 200 (5m)'
    };
    // Debug logging flag (disabled by default)
    this.debugLogsEnabled = process.env.DEBUG_CONDITIONS_LOGS === 'true';
    
    // Statistics tracking
    this.statistics = {
      totalEvaluations: 0,
      totalPassed: 0,
      conditionCounts: {
        macd5mHistogramPositive: { passed: 0, failed: 0 },
        macd5mPositive: { passed: 0, failed: 0 },
        macd1mPositive: { passed: 0, failed: 0 },
        closeAboveEma18_1m: { passed: 0, failed: 0 },
        ema18Above200_5m: { passed: 0, failed: 0 }
      }
    };
    
    // Floating point comparison epsilon
    this.EPSILON = 1e-10;
  }

  // Internal debug logger

  // Helper method for floating point comparison with tolerance
  isGreaterThan(a, b, tolerance = this.EPSILON) {
    if (a === null || a === undefined || b === null || b === undefined) {
      return false;
    }
    return (a - b) > tolerance;
  }

  // Helper method for EMA/VWAP comparisons with percentage tolerance
  isGreaterThanWithTolerance(a, b, percentageTolerance = 0.0001) {
    if (a === null || a === undefined || b === null || b === undefined) {
      return false;
    }
    const tolerance = Math.abs(b) * percentageTolerance;
    return (a - b) > tolerance;
  }

  // Helper method to extract MACD histogram value
  getMACDHistogram(macdData) {
    if (!macdData || typeof macdData !== 'object') {
      return null;
    }
    return macdData.histogram || null;
  }

  evaluateConditions(indicatorData) {
    const { indicators, lastCandle, currentPrice } = indicatorData;
    const conditions = {};
    const failedConditions = [];
    
    // Use currentPrice if available, otherwise fall back to lastCandle.close
    const closePrice = currentPrice || lastCandle?.close;

    // Condition 1: MACD 5m Histogram > 0
    const macd5mHistogram = this.getMACDHistogram(indicators.macd5m);
    conditions.macd5mHistogramPositive = this.isGreaterThan(macd5mHistogram, 0);
    if (!conditions.macd5mHistogramPositive) {
      failedConditions.push({
        name: this.conditionNames.macd5mHistogramPositive,
        expected: '> 0',
        actual: macd5mHistogram || 'N/A',
        condition: 'macd5mHistogramPositive'
      });
    }

    // Condition 2: MACD 5m > 0
    const macd5mValue = indicators.macd5m?.macd;
    conditions.macd5mPositive = this.isGreaterThan(macd5mValue, 0);
    if (!conditions.macd5mPositive) {
      failedConditions.push({
        name: this.conditionNames.macd5mPositive,
        expected: '> 0',
        actual: macd5mValue || 'N/A',
        condition: 'macd5mPositive'
      });
    }

    // Condition 3: MACD 1m > 0
    const macd1mValue = indicators.macd1m?.macd;
    conditions.macd1mPositive = this.isGreaterThan(macd1mValue, 0);
    if (!conditions.macd1mPositive) {
      failedConditions.push({
        name: this.conditionNames.macd1mPositive,
        expected: '> 0',
        actual: macd1mValue || 'N/A',
        condition: 'macd1mPositive'
      });
    }

    // Condition 4: Close > EMA18 1m
    const ema1m18Value = indicators.ema1m18;
    conditions.closeAboveEma18_1m = this.isGreaterThanWithTolerance(closePrice, ema1m18Value);
    if (!conditions.closeAboveEma18_1m) {
      failedConditions.push({
        name: this.conditionNames.closeAboveEma18_1m,
        expected: `Close (${closePrice}) > EMA 18 1m (${ema1m18Value})`,
        actual: `${closePrice || 'N/A'} vs ${ema1m18Value || 'N/A'}`,
        condition: 'closeAboveEma18_1m'
      });
    }

    // Condition 5: EMA18 5m > EMA200 5m
    const ema5m18Value = indicators.ema5m18;
    const ema5m200Value = indicators.ema5m200;
    conditions.ema18Above200_5m = this.isGreaterThanWithTolerance(ema5m18Value, ema5m200Value);
    if (!conditions.ema18Above200_5m) {
      failedConditions.push({
        name: this.conditionNames.ema18Above200_5m,
        expected: `EMA 18 5m (${ema5m18Value}) > EMA 200 5m (${ema5m200Value})`,
        actual: `${ema5m18Value || 'N/A'} vs ${ema5m200Value || 'N/A'}`,
        condition: 'ema18Above200_5m'
      });
    }

    // Count passed conditions - CRITICAL: Verify boolean logic
    const passedConditions = Object.values(conditions).filter(Boolean).length;
    const totalConditions = Object.keys(conditions).length;
    const allConditionsMet = passedConditions === totalConditions;
    
    // Enhanced debugging output
    Object.entries(conditions).forEach(([key, value], index) => {
    });
    
    if (failedConditions.length > 0) {
    }
    

    // Update statistics
    this.updateStatistics(conditions, allConditionsMet);

    return {
      conditions,
      passedConditions,
      totalConditions,
      allConditionsMet,
      failedConditions,
      score: `${passedConditions}/${totalConditions}`,
      debugInfo: {
        macd5mHistogram,
        closePrice,
        allIndicatorValues: {
          ema1m18: indicators.ema1m18,
          ema1m200: indicators.ema1m200,
          ema5m18: indicators.ema5m18,
          ema5m200: indicators.ema5m200,
          vwap1m: indicators.vwap1m,
          macd1m: indicators.macd1m,
          macd5m: indicators.macd5m
        }
      }
    };
  }

  // Update statistics tracking
  updateStatistics(conditions, allConditionsMet) {
    this.statistics.totalEvaluations++;
    if (allConditionsMet) {
      this.statistics.totalPassed++;
    }

    // Update individual condition counts
    Object.keys(conditions).forEach(conditionKey => {
      if (conditions[conditionKey]) {
        this.statistics.conditionCounts[conditionKey].passed++;
      } else {
        this.statistics.conditionCounts[conditionKey].failed++;
      }
    });
  }

  // Get statistics with failure rates
  getStatistics() {
    const stats = {
      totalEvaluations: this.statistics.totalEvaluations,
      totalPassed: this.statistics.totalPassed,
      totalFailed: this.statistics.totalEvaluations - this.statistics.totalPassed,
      passRate: this.statistics.totalEvaluations > 0 ? 
        (this.statistics.totalPassed / this.statistics.totalEvaluations * 100).toFixed(1) : 0,
      conditions: {}
    };

    // Calculate failure rates for each condition
    Object.keys(this.statistics.conditionCounts).forEach(conditionKey => {
      const counts = this.statistics.conditionCounts[conditionKey];
      const total = counts.passed + counts.failed;
      
      stats.conditions[conditionKey] = {
        name: this.conditionNames[conditionKey],
        passed: counts.passed,
        failed: counts.failed,
        total: total,
        passRate: total > 0 ? (counts.passed / total * 100).toFixed(1) : 0,
        failureRate: total > 0 ? (counts.failed / total * 100).toFixed(1) : 0
      };
    });

    return stats;
  }

  // Get top failing conditions
  getTopFailingConditions(limit = 5) {
    const stats = this.getStatistics();
    return Object.values(stats.conditions)
      .sort((a, b) => b.failed - a.failed)
      .slice(0, limit);
  }

  // Reset statistics
  resetStatistics() {
    this.statistics = {
      totalEvaluations: 0,
      totalPassed: 0,
      conditionCounts: {
        macd5mHistogramPositive: { passed: 0, failed: 0 },
        macd5mPositive: { passed: 0, failed: 0 },
        macd1mPositive: { passed: 0, failed: 0 },
        closeAboveEma18_1m: { passed: 0, failed: 0 },
        ema18Above200_5m: { passed: 0, failed: 0 }
      }
    };
  }

  // Save debug log to file
  saveDebugLog(ticker, debugData) {
    // Disabled debug-logs persistence to avoid disk writes in production
    return;
  }

  // Helper method to get condition summary
  getConditionSummary(evaluation) {
    return {
      score: evaluation.score,
      allMet: evaluation.allConditionsMet,
      failedCount: evaluation.failedConditions.length,
      failedConditions: evaluation.failedConditions
    };
  }
}

module.exports = ConditionsService;
