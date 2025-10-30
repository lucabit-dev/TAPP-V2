# Vercel Deployment Guide

This guide will help you deploy your Trading Alerts Tool to Vercel for live testing.

## Prerequisites

1. A Vercel account (sign up at https://vercel.com)
2. Git installed on your machine
3. Your API keys ready:
   - Polygon.io API Key
   - ChartsWatcher User ID, API Key, and Config ID

## Step 1: Prepare Your Repository

### Initialize Git (if not already done)

```bash
cd /Users/lucalongoni/Desktop/TAPP/Programa
git init
git add .
git commit -m "Initial commit - Trading Alerts Tool"
```

### Push to GitHub (Recommended)

1. Create a new repository on GitHub (https://github.com/new)
2. **Important**: Make it **PRIVATE** since it contains API keys in fallback values
3. Push your code:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

## Step 2: Deploy to Vercel

### Option A: Deploy via Vercel Dashboard (Recommended)

1. Go to https://vercel.com/dashboard
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Vercel will auto-detect the configuration from `vercel.json`

### Option B: Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy
vercel
```

## Step 3: Configure Environment Variables

After importing your project, you need to add environment variables:

1. Go to your project settings in Vercel
2. Navigate to "Settings" → "Environment Variables"
3. Add the following variables:

| Variable Name | Value | Environment |
|--------------|-------|-------------|
| `POLYGON_API_KEY` | Your Polygon.io API key | Production, Preview, Development |
| `CHARTSWATCHER_USER_ID` | Your ChartsWatcher User ID | Production, Preview, Development |
| `CHARTSWATCHER_API_KEY` | Your ChartsWatcher API Key | Production, Preview, Development |
| `CHARTSWATCHER_CONFIG_ID` | Your ChartsWatcher Config ID | Production, Preview, Development |
| `VITE_API_BASE_URL` | `https://YOUR_RAILWAY_DOMAIN.railway.app/api` | Production, Preview, Development |
| `VITE_WS_BASE_URL` | `wss://YOUR_RAILWAY_DOMAIN.railway.app` | Production, Preview, Development |

**Security Note**: `PNL_API_KEY` is now stored server-side in Railway, not in Vercel (see Railway variables below).

**Note**: Replace `YOUR_DOMAIN` with your actual Vercel domain (you'll get this after first deployment).

### Current API Keys (from your code):
- **Polygon API Key**: `oLNQ0GD8RpIcP8X2iApVnlzg28P6Ttcc`
- **ChartsWatcher User ID**: `68a9bba1b2c529407770fddb`
- **ChartsWatcher API Key**: `68ac935db2c5294077b0cd51`
- **ChartsWatcher Config ID**: `68d2f1d1e0373f708e67d801`

## Step 4: Redeploy with Environment Variables

After adding environment variables:

1. Go to "Deployments" tab
2. Click the three dots on the latest deployment
3. Click "Redeploy"
4. Check "Use existing Build Cache"
5. Click "Redeploy"

## Step 5: Configure PnL WebSocket Variables in Railway

**Security Update**: The PnL API key is now stored server-side in Railway for better security.

For the PnL (Orders/Positions) section, add these environment variables in **Railway** (not Vercel):

- `PNL_API_KEY` = Your PnL API key (for authenticating with `sections-bot.inbitme.com`)
- `PNL_WS_BASE_URL` = `wss://sections-bot.inbitme.com` (optional, defaults to this value)

The backend will proxy WebSocket connections, so the frontend doesn't need the API key.

## Step 6: Update Frontend URLs (if using Railway backend)

If you're using Railway for the backend, update these environment variables in Vercel to point to your Railway domain:

- `VITE_API_BASE_URL` = `https://YOUR-RAILWAY-PROJECT.railway.app/api`
- `VITE_WS_BASE_URL` = `wss://YOUR-RAILWAY-PROJECT.railway.app` (for main app WebSocket)

Then redeploy again.

## Important Notes

### WebSocket Limitations on Vercel

⚠️ **Important**: Vercel has limitations with WebSocket connections:
- WebSocket connections timeout after 5 minutes on Hobby plan
- For production, consider using Vercel Pro or deploying the backend separately

### Alternative: Split Deployment

For better WebSocket support, consider:

1. **Frontend on Vercel**: Deploy the React app
2. **Backend on Railway/Render**: Deploy the Node.js server with full WebSocket support

#### Backend on Railway (Recommended for WebSockets)

1. Go to https://railway.app
2. Create new project from GitHub
3. Add environment variables (see Railway Environment Variables section below)
4. Railway provides persistent WebSocket connections
5. Update `VITE_API_BASE_URL` and `VITE_WS_BASE_URL` in Vercel to point to Railway

#### Railway Environment Variables

For the backend server on Railway, add these variables:

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `POLYGON_API_KEY` | Your Polygon.io API key | Required |
| `CHARTSWATCHER_USER_ID` | Your ChartsWatcher User ID | Required |
| `CHARTSWATCHER_API_KEY` | Your ChartsWatcher API Key | Required |
| `CHARTSWATCHER_CONFIG_ID` | Your ChartsWatcher Config ID | Required |
| `PNL_API_KEY` | Your PnL API key (for Orders/Positions WebSocket proxy) | Required |
| `PNL_WS_BASE_URL` | `wss://sections-bot.inbitme.com` | Optional, defaults to sections-bot |
| `PORT` | `3001` (or let Railway assign) | Optional, Railway can auto-assign |
| `NODE_ENV` | `production` | Recommended |

## Troubleshooting

### Build Fails

If build fails, check:
1. All dependencies are in `package.json`
2. Environment variables are set correctly
3. Check build logs in Vercel dashboard

### WebSocket Connection Issues

If WebSocket doesn't connect:
1. Check browser console for errors
2. Verify `VITE_WS_BASE_URL` is set correctly
3. Consider using `wss://` (secure WebSocket) for production
4. Check Vercel function logs for backend errors

### API Calls Fail

If API calls fail:
1. Check `VITE_API_BASE_URL` is correct
2. Verify CORS is properly configured in `server.js`
3. Check Vercel function logs

## Testing Your Deployment

1. Visit your Vercel URL
2. Check browser console for any errors
3. Test alert processing
4. Verify WebSocket connection status
5. Test stock information modal

## Local Development

To test with production-like environment variables locally:

```bash
# Create .env file (not committed to git)
cp env.example .env

# Edit .env with your values
# Then run:
npm run dev-full
```

## Security Recommendations

1. ✅ Never commit `.env` files to git
2. ✅ Keep your repository private if it contains sensitive data
3. ✅ Rotate API keys regularly
4. ✅ Use Vercel's environment variable encryption
5. ✅ Monitor API usage to detect unauthorized access

## Support

If you encounter issues:
- Check Vercel documentation: https://vercel.com/docs
- Review Vercel function logs
- Check browser console for frontend errors

## Next Steps

After successful deployment:
1. Test all features thoroughly
2. Monitor API usage and costs
3. Set up custom domain (optional)
4. Configure analytics (optional)
5. Set up error monitoring (Sentry, etc.)

---

**Deployment Status**: Ready for Vercel deployment
**Last Updated**: October 8, 2025
