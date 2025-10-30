# Environment Variables Configuration Guide

This guide explains which environment variables need to be set in Railway (backend) and Vercel (frontend).

## 🔵 Railway (Backend Server)

Set these variables in your Railway project settings:

| Variable Name | Required | Description |
|--------------|----------|-------------|
| `POLYGON_API_KEY` | ✅ Yes | Polygon.io API key |
| `CHARTSWATCHER_USER_ID` | ✅ Yes | ChartsWatcher User ID |
| `CHARTSWATCHER_API_KEY` | ✅ Yes | ChartsWatcher API Key |
| `CHARTSWATCHER_CONFIG_ID` | ✅ Yes | ChartsWatcher Config ID |
| `PNL_API_KEY` | ✅ Yes | PnL API key for Orders/Positions WebSocket proxy |
| `PNL_WS_BASE_URL` | ❌ No | PnL WebSocket base URL (defaults to `wss://sections-bot.inbitme.com`) |
| `PORT` | ❌ No | Port number (Railway can auto-assign) |
| `NODE_ENV` | ❌ No | Set to `production` (recommended) |

## 🟢 Vercel (Frontend Client)

Set these variables in your Vercel project settings:

### Backend Connection Variables

| Variable Name | Required | Description |
|--------------|----------|-------------|
| `VITE_API_BASE_URL` | ✅ Yes | Your Railway backend API URL (e.g., `https://your-project.railway.app/api`) |
| `VITE_WS_BASE_URL` | ✅ Yes | Your Railway backend WebSocket URL (e.g., `wss://your-project.railway.app`) |

**Note**: `VITE_PNL_API_KEY` is **NOT** needed in Vercel anymore. The API key is now securely stored server-side in Railway and handled by the backend proxy.

## 📝 Setup Checklist

### Railway Setup
- [ ] Add `POLYGON_API_KEY`
- [ ] Add `CHARTSWATCHER_USER_ID`
- [ ] Add `CHARTSWATCHER_API_KEY`
- [ ] Add `CHARTSWATCHER_CONFIG_ID`
- [ ] Add `PNL_API_KEY` (for Orders/Positions WebSocket proxy)
- [ ] Add `PNL_WS_BASE_URL` (optional, defaults to `wss://sections-bot.inbitme.com`)
- [ ] Deploy and note your Railway domain

### Vercel Setup
- [ ] Add `VITE_API_BASE_URL` (point to your Railway backend)
- [ ] Add `VITE_WS_BASE_URL` (point to your Railway backend)
- [ ] **Remove** `VITE_PNL_API_KEY` if it exists (no longer needed - handled server-side)
- [ ] Redeploy to apply changes

## 🔍 How to Verify

1. **Check Railway variables**: Go to Railway → Your Project → Variables tab
2. **Check Vercel variables**: Go to Vercel → Your Project → Settings → Environment Variables
3. **Verify in browser**: Open browser console and check:
   - `PnLSection.tsx` logs should show: `🔌 Connecting to positions WebSocket: wss://...`
   - `OrdersSection.tsx` logs should show: `🔌 Connecting to orders WebSocket: wss://...`

## ❗ Common Issues

### "Invalid frame header" Error
- Make sure `VITE_WS_BASE_URL` is set correctly in Vercel (should point to Railway)
- Ensure you're using `wss://` (secure WebSocket) not `ws://`
- Check that `PNL_API_KEY` is set in Railway (server-side)

### WebSocket Connection Fails
- Verify the URL in browser console logs
- Check that environment variables are set for the correct environment (Production/Preview/Development)
- Ensure you redeployed after adding environment variables

### API Key Not Found
- Verify `PNL_API_KEY` is set in Railway (not Vercel)
- The API key is now handled server-side for security
- Check Railway logs for WebSocket proxy connection errors

## 🔄 After Adding Variables

**Always redeploy** after adding or changing environment variables:
- **Railway**: Usually auto-deploys, or manually trigger redeploy
- **Vercel**: Go to Deployments → Latest → Three dots → Redeploy

## 🔒 Security Improvement

The PnL API key has been moved from Vercel (frontend) to Railway (backend) for better security:
- ✅ API key is no longer exposed in frontend JavaScript bundle
- ✅ Frontend connects to Railway proxy, which handles authentication
- ✅ WebSocket connections are relayed securely through your backend

