# Environment Variables Setup Guide

This guide helps you set up environment variables for **localhost development** and **production deployment** (Railway + Vercel).

## Quick Setup for Localhost

### 1. Backend Environment Variables

Create a `.env` file in the **root directory** (`/Users/lucalongoni/Desktop/TAPP/TAPP V5/.env`):

```bash
# Copy this template and fill in your values
cp .env.example .env  # If you have an example file
# OR create manually:
```

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

# Database Configuration - Local MongoDB
MONGODB_URI=mongodb://localhost:27017/tapp

# Auth / Security (IMPORTANT: Change this!)
JWT_SECRET=your_super_secret_jwt_key_min_32_chars_long

# P&L API Configuration
PNL_API_KEY=ruXNebYJhJ09H6D8lyQCKSfr9gcDvxQo
PNL_WS_BASE_URL=wss://sections-bot.inbitme.com

# Optional
WS_HEARTBEAT_MS=30000
ENABLE_VERIFICATION=false
```

### 2. Frontend Environment Variables

Create a `.env` file in the **client directory** (`/Users/lucalongoni/Desktop/TAPP/TAPP V5/client/.env`):

```env
# Localhost Development Settings
VITE_API_BASE_URL=http://localhost:3001/api
VITE_WS_BASE_URL=ws://localhost:3001
```

**Note:** Frontend variables MUST start with `VITE_` prefix for Vite to load them.

### 3. Start MongoDB (if using local MongoDB)

```bash
# Using Homebrew (macOS)
brew services start mongodb-community

# OR using Docker
docker run -d --name tapp-mongo -p 27017:27017 mongo:7

# OR skip this if using MongoDB Atlas (cloud)
```

## Production Setup (Railway + Vercel)

### Railway (Backend) - Environment Variables

Go to **Railway Dashboard → Your Service → Variables** and add:

```env
POLYGON_API_KEY=your_polygon_api_key
CHARTSWATCHER_USER_ID=your_user_id
CHARTSWATCHER_API_KEY=your_api_key
CHARTSWATCHER_CONFIG_ID=your_config_id
NODE_ENV=production
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/tapp?retryWrites=true&w=majority
JWT_SECRET=your_super_secret_jwt_key_min_32_chars_long
PNL_API_KEY=ruXNebYJhJ09H6D8lyQCKSfr9gcDvxQo
PNL_WS_BASE_URL=wss://sections-bot.inbitme.com
PORT=3001  # Railway sets this automatically, but you can specify
```

### Vercel (Frontend) - Environment Variables

Go to **Vercel Dashboard → Your Project → Settings → Environment Variables** and add:

```env
VITE_API_BASE_URL=https://your-railway-app.up.railway.app/api
VITE_WS_BASE_URL=wss://your-railway-app.up.railway.app
```

**Important:** Replace `your-railway-app.up.railway.app` with your actual Railway domain.

## How It Works

### Development (Localhost)

1. **Backend** reads from root `.env` file (via `dotenv`)
2. **Frontend** reads from `client/.env` file (via Vite)
3. Both use `localhost` URLs by default
4. MongoDB runs locally or uses Atlas

### Production (Railway + Vercel)

1. **Railway** (Backend):
   - Reads variables from Railway's environment
   - Variables set in Railway Dashboard
   - No `.env` file needed

2. **Vercel** (Frontend):
   - Variables embedded at **build time**
   - Must be set in Vercel Dashboard
   - Frontend bundle includes these values

## Variable Fallbacks in Code

The code includes fallbacks so it works even without `.env` files:

### Backend (`server.js`)
- `PORT` defaults to `3001`
- Database connection gracefully fails if not configured

### Frontend Components

**App.tsx:**
```typescript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';
```

**PnLSection.tsx & OrdersSection.tsx:**
```typescript
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';
const token = localStorage.getItem('auth_token'); // From login
```

## Verification

### Check if Backend Variables are Loaded

```bash
# Start the server and check logs
npm run dev

# Look for:
# ✅ Connected to MongoDB
# 🚀 Trading Alerts API server running on port 3001
```

### Check if Frontend Variables are Loaded

1. Open browser DevTools (F12)
2. Go to Console tab
3. Type: `console.log(import.meta.env)`
4. You should see your `VITE_*` variables

## Troubleshooting

### "API key is required" Error

- **Backend**: Check `PNL_API_KEY` is set in Railway variables
- **Frontend**: Not needed anymore (handled by backend proxy)

### "Database not connected" Error

- **Localhost**: Start MongoDB locally or use Atlas
- **Railway**: Check `MONGODB_URI` is correct in Railway variables

### WebSocket Connection Fails

- **Localhost**: Ensure backend is running on port 3001
- **Production**: Check `VITE_WS_BASE_URL` points to Railway (wss:// not ws://)

### Frontend Can't Connect to Backend

- **Localhost**: Use `http://localhost:3001/api` (not `https://`)
- **Production**: Use `https://your-railway-url.railway.app/api`

## Security Notes

1. **Never commit `.env` files** to Git (they're in `.gitignore`)
2. **JWT_SECRET** should be at least 32 characters, random string
3. **PNL_API_KEY** stays on backend only (Railway), never in frontend
4. **MONGODB_URI** contains credentials - keep it secret

## Quick Reference

| Variable | Backend | Frontend | Localhost Default | Required |
|----------|---------|----------|-------------------|----------|
| `MONGODB_URI` | ✅ | ❌ | `mongodb://localhost:27017/tapp` | ✅ |
| `JWT_SECRET` | ✅ | ❌ | None | ✅ |
| `PNL_API_KEY` | ✅ | ❌ | None | ✅ |
| `VITE_API_BASE_URL` | ❌ | ✅ | `http://localhost:3001/api` | ✅ |
| `VITE_WS_BASE_URL` | ❌ | ✅ | `ws://localhost:3001` | ✅ |
| `PORT` | ✅ | ❌ | `3001` | ❌ |

---

**Last Updated**: 2025-01-28
**Status**: ✅ Ready for Localhost & Production

