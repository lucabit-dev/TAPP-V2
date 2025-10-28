# MACD/EMA Verification System

## Overview

The MACD/EMA Verification System automatically logs MACD and EMA indicator values for 10 selected stocks every minute. This allows you to validate that your calculations match Polygon.io's exact computation logic throughout the trading day.

## Monitored Symbols

The system monitors these 10 symbols by default:
- **AAPL** - Apple Inc.
- **TSLA** - Tesla
- **MSFT** - Microsoft
- **NVDA** - NVIDIA
- **AMZN** - Amazon
- **GOOGL** - Alphabet
- **META** - Meta
- **SPY** - S&P 500 ETF
- **QQQ** - QQQ ETF
- **AMD** - AMD

## How It Works

1. **Automatic Data Collection**: Every 60 seconds, the system:
   - Fetches 1-minute and 5-minute candle data for each symbol
   - Calculates MACD and EMA indicators using Polygon's exact logic
   - Logs all values to a JSON file

2. **Log File Location**: `logs/macd_ema_verification/verification_YYYY-MM-DD.json`

3. **Logged Values**:
   - MACD 1m (macd, signal, histogram)
   - MACD 5m (macd, signal, histogram)
   - EMA 1m (12, 18, 20, 26, 200)
   - EMA 5m (12, 18, 20, 26, 200)
   - Last close price
   - Timestamp
   - Candle counts
   - Session (premarket/regular/afterhours/closed)

## API Endpoints

### Get Status
```
GET /api/verification/status
```

**Response:**
```json
{
  "monitoring": true,
  "symbols": ["AAPL", "TSLA", "MSFT", ...],
  "statistics": {
    "entriesToday": 150,
    "entriesBySymbol": {
      "AAPL": 15,
      "TSLA": 15,
      ...
    },
    "symbolsTracked": 10,
    "latestEntry": {
      "timestamp": "2024-01-15T14:30:00Z",
      "symbol": "AAPL",
      "macd1m": { "macd": 0.1234, "signal": 0.0987, "histogram": 0.0247 },
      ...
    }
  },
  "logFile": "logs/macd_ema_verification/verification_2024-01-15.json"
}
```

### Start Monitoring
```
GET /api/verification/start
```

Starts the automatic data collection.

**Response:**
```json
{
  "message": "Verification monitoring started",
  "symbols": ["AAPL", "TSLA", ...],
  "interval": "60 seconds"
}
```

### Stop Monitoring
```
GET /api/verification/stop
```

Stops the automatic data collection.

**Response:**
```json
{
  "message": "Verification monitoring stopped",
  "active": false
}
```

### Export as CSV
```
GET /api/verification/export
GET /api/verification/export/2024-01-15
```

Exports the verification data as CSV for easy analysis in Excel or other tools.

**Response:** Downloads a CSV file with columns:
- timestamp
- symbol
- macd1m.macd, macd1m.signal, macd1m.histogram
- macd5m.macd, macd5m.signal, macd5m.histogram
- ema1m12, ema1m18, ema1m20, ema1m26, ema1m200
- ema5m12, ema5m18, ema5m20, ema5m26, ema5m200
- lastClose

## Usage Examples

### Start Verification (Manual)
```bash
curl http://localhost:3001/api/verification/start
```

### Check Status
```bash
curl http://localhost:3001/api/verification/status
```

### Export Today's Data
```bash
curl http://localhost:3001/api/verification/export -o verification_today.csv
```

### Export Specific Date
```bash
curl http://localhost:3001/api/verification/export/2024-01-15 -o verification_2024-01-15.csv
```

## Auto-Start on Server Start

To automatically start verification when the server starts, set the environment variable:

```bash
export ENABLE_VERIFICATION=true
```

Or in your `.env` file:
```
ENABLE_VERIFICATION=true
```

## Data Validation

### Comparing with Polygon API

1. **Get your logged values** from the JSON file
2. **Query Polygon's API** for the same timestamp:
   ```bash
   curl "https://api.polygon.io/v1/indicators/macd?ticker=AAPL&timestamp=2024-01-15T14:30:00-05:00&timespan=minute&adjusted=true&window=26&series_type=close&signal_period=9&order=desc&apikey=YOUR_API_KEY"
   ```
3. **Compare values** - they should match within 0.1% tolerance

### Expected Accuracy

With Polygon's exact formulas implemented:
- **EMA values**: Should match exactly (< 0.01% deviation)
- **MACD values**: Should match exactly (< 0.01% deviation)
- **Histogram**: Should match exactly (< 0.01% deviation)

## Log File Format

```json
[
  {
    "timestamp": "2024-01-15T14:30:00.000Z",
    "symbol": "AAPL",
    "macd1m": {
      "macd": 0.123456,
      "signal": 0.098765,
      "histogram": 0.024691
    },
    "macd5m": {
      "macd": 0.156789,
      "signal": 0.112233,
      "histogram": 0.044556
    },
    "ema1m12": 185.123456,
    "ema1m18": 185.234567,
    "ema1m20": 185.345678,
    "ema1m26": 185.456789,
    "ema1m200": 185.567890,
    "ema5m12": 185.123456,
    "ema5m18": 185.234567,
    "ema5m20": 185.345678,
    "ema5m26": 185.456789,
    "ema5m200": 185.567890,
    "lastClose": 185.50,
    "candleCounts": {
      "candles1m": 390,
      "candles5m": 78
    },
    "session": "regular"
  }
]
```

## Troubleshooting

### No Data Being Collected

1. Check if monitoring is active: `GET /api/verification/status`
2. Verify API connectivity to Polygon
3. Check server logs for errors
4. Ensure symbols are valid trading symbols

### Insufficient Data Warnings

- Some symbols may be paused or delisted
- Market hours restrictions (premarket/afterhours)
- API rate limits

### High Disk Usage

The log files grow over time. Consider:
- Archiving old log files
- Implementing log rotation
- Exporting to CSV and clearing JSON logs periodically

## Notes

- **Time Zone**: All timestamps are in UTC
- **Market Hours**: Data collection respects extended hours
- **Rate Limits**: Respects Polygon API rate limits
- **Storage**: Logs are saved to `logs/macd_ema_verification/`
- **Backup**: Consider backing up verification logs for historical analysis

## Integration with Polygon MACD Calculation

This verification system validates that all MACD and EMA calculations use the exact formulas from:
- **File**: `utils/technical_indicators/macd_polygon.js`
- **Formulas**: Polygon.io `/v1/indicators/macd` endpoint logic
- **Precision**: High-precision floating point arithmetic

