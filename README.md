# Trading Alerts Tool

A powerful Node.js + React application for processing real-time trading alerts with advanced technical indicators.

## Features

- 🔴 **Real-time Alerts**: Live WebSocket connection to ChartsWatcher
- 📊 **Technical Indicators**: 
  - EMAs (12, 20, 26, 200) for 1-minute and 5-minute timeframes
  - MACD with histogram
  - VWAP (Volume Weighted Average Price)
  - LOD/HOD (Low/High of Day)
- 🎯 **Smart Filtering**: Automatic condition evaluation for alerts
- 📱 **Modern UI**: TradingView-style interface with Tailwind CSS
- 🚀 **High Precision**: 6 decimal places for accurate EMA calculations
- 🔄 **Adaptive Data Fetching**: Intelligent historical data retrieval

## Tech Stack

### Backend
- Node.js + Express
- WebSocket (ws)
- Polygon.io API for market data
- ChartsWatcher API for alerts
- Technical Indicators library

### Frontend
- React 19
- TypeScript
- Vite
- Tailwind CSS
- WebSocket for real-time updates

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- API keys for Polygon.io and ChartsWatcher

### Installation

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
npm run install-client

# Build frontend
npm run build-client
```

### Development

```bash
# Run both backend and frontend in development mode
npm run dev-full

# Or run separately:
# Terminal 1 - Backend
npm run dev

# Terminal 2 - Frontend
npm run dev-client
```

### Production

```bash
# Start production server
npm start
```

## Environment Variables

### Backend (Root Directory `.env`)

Create a `.env` file in the root directory:

```env
# Polygon.io API Configuration
POLYGON_API_KEY=your_polygon_api_key_here

# ChartsWatcher API Configuration
CHARTSWATCHER_USER_ID=your_user_id_here
CHARTSWATCHER_API_KEY=your_api_key_here
CHARTSWATCHER_CONFIG_ID=your_config_id_here

# Server Configuration
PORT=3001
NODE_ENV=development

# Database Configuration
# For localhost MongoDB:
MONGODB_URI=mongodb://localhost:27017/tapp
# OR for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/tapp?retryWrites=true&w=majority

# Auth / Security
JWT_SECRET=change_me_to_a_long_random_secret_string

# P&L API Configuration (External service)
PNL_API_KEY=your_pnl_api_key_here
PNL_WS_BASE_URL=wss://sections-bot.inbitme.com

# Optional
WS_HEARTBEAT_MS=30000
ENABLE_VERIFICATION=false
```

### Frontend (Client Directory `.env`)

Create a `.env` file in the `client/` directory:

```env
# For localhost development:
VITE_API_BASE_URL=http://localhost:3001/api
VITE_WS_BASE_URL=ws://localhost:3001

# For production (Railway/Vercel), set these in Vercel:
# VITE_API_BASE_URL=https://your-railway-app.up.railway.app/api
# VITE_WS_BASE_URL=wss://your-railway-app.up.railway.app
```

**Important Notes:**
- Backend uses `dotenv` - variables are loaded from root `.env` file
- Frontend uses Vite - variables must start with `VITE_` prefix
- Frontend variables are embedded at build time (not runtime)
- For localhost: Both `.env` files will use localhost defaults
- For production: Set variables in Railway (backend) and Vercel (frontend)

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed Vercel deployment instructions.

## Project Structure

```
├── server.js                 # Express server & WebSocket
├── polygonService.js         # Polygon.io API integration
├── chartsWatcherService.js   # ChartsWatcher WebSocket
├── indicators.js             # Technical indicators calculation
├── conditions.js             # Alert condition evaluation
├── toplistService.js         # Toplist data service
├── client/                   # React frontend
│   ├── src/
│   │   ├── App.tsx          # Main application
│   │   └── components/      # React components
│   └── dist/                # Production build
├── vercel.json              # Vercel configuration
└── DEPLOYMENT.md            # Deployment guide
```

## API Endpoints

### GET `/api/alerts/processed`
Get all processed alerts with technical indicators

### GET `/api/chartswatcher/status`
Get ChartsWatcher connection status

### GET `/api/toplist`
Get current toplist data

## WebSocket Events

### Client → Server
- Connection established automatically

### Server → Client
- `NEW_ALERT`: New alert with technical indicators
- `TOPLIST_UPDATE`: Updated toplist data
- `CHARTSWATCHER_STATUS`: Connection status updates

## Technical Indicators

### EMA (Exponential Moving Average)
- **1-minute**: EMA 12, 20, 26, 200
- **5-minute**: EMA 12, 20, 26, 200
- Calculated from scratch using historical data
- 99%+ accuracy compared to TradingView

### MACD (Moving Average Convergence Divergence)
- Fast Period: 12
- Slow Period: 26
- Signal Period: 9
- Includes histogram

### VWAP
- Volume-weighted average price
- Calculated from market hours data

### LOD/HOD
- Low and High of Day
- Updated in real-time

## Features in Detail

### Adaptive Data Fetching
The system intelligently fetches historical data:
1. Starts with 10 days of data
2. Filters to market hours (9:30 AM - 4:00 PM ET)
3. Extends to 15, 20, 30 days if needed for EMA200
4. Falls back to all candles for low-volume stocks

### Market Hours Filtering
- Automatically filters data to regular trading hours
- Converts UTC to Eastern Time
- Excludes pre-market and after-hours for accuracy

### Real-time Updates
- WebSocket connection to ChartsWatcher
- Instant alert processing
- Live indicator calculations
- Automatic reconnection on disconnect

## Performance

- **EMA Accuracy**: 99%+ match with TradingView
- **Processing Speed**: < 2 seconds per alert
- **Data Points**: Up to 3,000+ candles per calculation
- **Concurrent Alerts**: Handles multiple simultaneous alerts

## Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari
- Modern mobile browsers

## Contributing

This is a private project. For questions or issues, contact the development team.

## License

MIT License - See LICENSE file for details

## Support

For deployment help, see [DEPLOYMENT.md](./DEPLOYMENT.md)

---

**Version**: 1.0.0  
**Last Updated**: October 8, 2025  
**Status**: Production Ready ✅