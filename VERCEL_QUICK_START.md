# Vercel Quick Start Guide 🚀

## Quick Deployment Steps

### 1. Initialize Git & Push to GitHub

```bash
cd /Users/lucalongoni/Desktop/TAPP/Programa

# Initialize git
git init
git add .
git commit -m "Initial commit - Ready for Vercel"

# Create a new PRIVATE repository on GitHub
# Then push:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

### 2. Deploy to Vercel

1. Go to https://vercel.com/dashboard
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Vercel will auto-detect settings from `vercel.json`
5. Click "Deploy"

### 3. Add Environment Variables

After first deployment, go to Project Settings → Environment Variables and add:

```
POLYGON_API_KEY = oLNQ0GD8RpIcP8X2iApVnlzg28P6Ttcc
CHARTSWATCHER_USER_ID = 68a9bba1b2c529407770fddb
CHARTSWATCHER_API_KEY = 68ac935db2c5294077b0cd51
CHARTSWATCHER_CONFIG_ID = 68d2f1d1e0373f708e67d801
```

**Important**: Add these to all environments (Production, Preview, Development)

### 4. Update Frontend URLs

Once you have your Vercel URL (e.g., `your-app.vercel.app`), add:

```
VITE_API_BASE_URL = https://your-app.vercel.app/api
VITE_WS_BASE_URL = wss://your-app.vercel.app
```

### 5. Redeploy

1. Go to Deployments tab
2. Click "..." on latest deployment
3. Click "Redeploy"

## ⚠️ Important: WebSocket Limitations

Vercel has WebSocket timeout limits (5 minutes on Hobby plan). For production use:

### Option A: Upgrade to Vercel Pro
- Longer WebSocket timeouts
- Better for production

### Option B: Split Deployment (Recommended)
- **Frontend**: Vercel (React app)
- **Backend**: Railway.app (Node.js server with full WebSocket support)

#### Railway Deployment:
1. Go to https://railway.app
2. "New Project" → "Deploy from GitHub"
3. Select your repository
4. Add same environment variables
5. Railway URL will be like: `your-app.railway.app`
6. Update Vercel env vars:
   ```
   VITE_API_BASE_URL = https://your-app.railway.app/api
   VITE_WS_BASE_URL = wss://your-app.railway.app
   ```

## What Was Changed

✅ **Environment Variables**: API keys now use `process.env`
✅ **Vercel Config**: `vercel.json` created
✅ **Build Script**: Added `vercel-build` command
✅ **Frontend URLs**: Dynamic API and WebSocket URLs
✅ **Git Ignore**: Proper `.gitignore` for sensitive files

## Files Created/Modified

### New Files:
- `vercel.json` - Vercel configuration
- `.gitignore` - Git ignore rules
- `env.example` - Environment variable template
- `DEPLOYMENT.md` - Detailed deployment guide
- `README.md` - Updated project documentation

### Modified Files:
- `polygonService.js` - Uses `process.env.POLYGON_API_KEY`
- `chartsWatcherService.js` - Uses environment variables
- `client/src/App.tsx` - Dynamic API/WS URLs
- `client/src/components/ToplistWidget.tsx` - Dynamic WS URL
- `package.json` - Added `vercel-build` script

## Testing Your Deployment

1. Visit your Vercel URL
2. Check browser console (F12)
3. Verify WebSocket connection
4. Test alert processing
5. Open stock info modal

## Need Help?

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions and troubleshooting.

---

**Status**: ✅ Ready for Deployment
**Estimated Time**: 10-15 minutes
