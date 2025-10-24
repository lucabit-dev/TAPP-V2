# 🚀 Complete Deployment Guide - TAPP v2

This guide provides step-by-step instructions to deploy your Trading Alerts Tool on both **Vercel** (frontend) and **Railway** (backend) for optimal performance.

## 📋 Prerequisites

1. **GitHub Repository**: Your code should be pushed to GitHub
2. **API Keys Ready**:
   - Polygon.io API Key: `oLNQ0GD8RpIcP8X2iApVnlzg28P6Ttcc`
   - ChartsWatcher User ID: `68a9bba1b2c529407770fddb`
   - ChartsWatcher API Key: `68ac935db2c5294077b0cd51`
   - ChartsWatcher Config ID: `68d2f1d1e0373f708e67d801`
3. **Accounts**: Vercel account and Railway account

---

## 🎯 Recommended Architecture

```
Frontend (React) → Vercel
Backend (Node.js + WebSocket) → Railway
```

**Why this setup?**
- ✅ Vercel: Perfect for React frontend with CDN
- ✅ Railway: Full WebSocket support, always-on server
- ✅ Better performance and reliability

---

## 🚂 Part 1: Deploy Backend to Railway

### Step 1: Create Railway Account

1. Go to [https://railway.app](https://railway.app)
2. Sign up with GitHub (recommended)
3. Connect your GitHub account

### Step 2: Deploy Backend

1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Choose your repository: `lucabit-dev/TAPP-V2`
4. Railway will auto-detect Node.js project

### Step 3: Configure Backend Settings

1. **Set Root Directory**: 
   - Go to Settings → Root Directory
   - Set to: `.` (root of repo)

2. **Set Start Command**:
   - Go to Settings → Deploy
   - Set start command to: `node server.js`

### Step 4: Add Environment Variables

Go to **Variables** tab and add:

```env
POLYGON_API_KEY=oLNQ0GD8RpIcP8X2iApVnlzg28P6Ttcc
CHARTSWATCHER_USER_ID=68a9bba1b2c529407770fddb
CHARTSWATCHER_API_KEY=68ac935db2c5294077b0cd51
CHARTSWATCHER_CONFIG_ID=68d2f1d1e0373f708e67d801
PORT=3001
NODE_ENV=production
```

### Step 5: Get Railway URL

After deployment, Railway will provide a URL like:
```
https://tapp-v2-production.up.railway.app
```

**Save this URL** - you'll need it for the frontend!

### Step 6: Test Backend

Visit these URLs to verify:
```
https://your-railway-url.up.railway.app/api/health
https://your-railway-url.up.railway.app/api/toplist
```

---

## ⚡ Part 2: Deploy Frontend to Vercel

### Step 1: Create Vercel Account

1. Go to [https://vercel.com](https://vercel.com)
2. Sign up with GitHub
3. Connect your GitHub account

### Step 2: Deploy Frontend

1. Go to [https://vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **"Add New..."** → **"Project"**
3. Import your GitHub repository: `lucabit-dev/TAPP-V2`
4. Vercel will auto-detect the configuration from `vercel.json`

### Step 3: Configure Frontend Settings

1. **Framework Preset**: Vite
2. **Root Directory**: `client`
3. **Build Command**: `npm run build` (auto-detected)
4. **Output Directory**: `dist` (auto-detected)

### Step 4: Add Environment Variables

In Vercel project settings → **Environment Variables**, add:

```env
VITE_API_BASE_URL=https://your-railway-url.up.railway.app
VITE_WS_BASE_URL=wss://your-railway-url.up.railway.app
```

**Important**: Replace `your-railway-url` with your actual Railway URL!

### Step 5: Deploy

1. Click **"Deploy"**
2. Wait for build to complete
3. Get your Vercel URL (e.g., `https://tapp-v2.vercel.app`)

---

## 🔧 Part 3: Update Configuration Files

### Update vercel.json (if needed)

Your `vercel.json` should look like this:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "client/package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "dist"
      }
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/$1"
    }
  ]
}
```

### Update client/package.json

Ensure your `client/package.json` has:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "vercel-build": "npm run build"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^7.1.7"
  }
}
```

---

## 🧪 Part 4: Testing Your Deployment

### Test Frontend (Vercel)

1. Visit your Vercel URL
2. Check browser console for errors
3. Verify the app loads correctly

### Test Backend (Railway)

1. Visit: `https://your-railway-url.up.railway.app/api/health`
2. Should return: `{"status": "ok", "timestamp": "..."}`

### Test WebSocket Connection

1. Open browser console on your Vercel app
2. Look for WebSocket connection messages
3. Should see: `WebSocket connected`

### Test Full Integration

1. Use your app normally
2. Check that alerts are processed
3. Verify stock information displays correctly
4. Test real-time updates

---

## 🔄 Part 5: Automatic Deployments

### Railway (Backend)
- ✅ Automatically redeploys when you push to GitHub
- ✅ No additional configuration needed

### Vercel (Frontend)
- ✅ Automatically redeploys when you push to GitHub
- ✅ Uses your `vercel.json` configuration

### Development Workflow

```bash
# Make changes
git add .
git commit -m "Update features"
git push origin main

# Both platforms will automatically redeploy!
```

---

## 🐛 Troubleshooting

### Backend Issues (Railway)

**Build Fails:**
- Check Railway build logs
- Verify all dependencies in `package.json`
- Ensure Node.js version compatibility

**Server Won't Start:**
- Check environment variables are set
- Verify PORT is set to 3001
- Review logs for errors

**WebSocket Not Connecting:**
- Verify URL uses `wss://` (not `ws://`)
- Check CORS settings in `server.js`

### Frontend Issues (Vercel)

**Build Fails:**
- Check Vercel build logs
- Verify all dependencies in `client/package.json`
- Ensure TypeScript compilation passes

**404 Errors:**
- Check `vercel.json` routing configuration
- Verify `distDir` is set to `dist`

**API Calls Fail:**
- Check `VITE_API_BASE_URL` environment variable
- Verify it points to your Railway URL
- Check CORS configuration in backend

### Connection Issues

**WebSocket Disconnects:**
- Railway supports persistent WebSocket connections
- Check browser console for connection errors
- Verify `VITE_WS_BASE_URL` uses `wss://`

---

## 💰 Cost Estimation

### Railway (Backend)
- **Free Tier**: $5/month credit
- **Usage**: ~$5-10/month for this app
- **Features**: Always-on, full WebSocket support

### Vercel (Frontend)
- **Free Tier**: Unlimited static deployments
- **Usage**: $0/month for this app
- **Features**: Global CDN, automatic deployments

**Total**: ~$5-10/month for full production deployment

---

## 🔒 Security Best Practices

1. ✅ Never commit `.env` files to git
2. ✅ Keep repository private if it contains sensitive data
3. ✅ Use environment variables for all API keys
4. ✅ Regularly rotate API keys
5. ✅ Monitor API usage for unauthorized access

---

## 📊 Monitoring & Maintenance

### Railway Monitoring
- Check deployment logs regularly
- Monitor resource usage
- Set up alerts for downtime

### Vercel Monitoring
- Check build logs for errors
- Monitor function execution times
- Set up analytics (optional)

### Application Monitoring
- Monitor API usage and costs
- Check WebSocket connection stability
- Track error rates and performance

---

## 🎉 Success Checklist

- [ ] Backend deployed on Railway
- [ ] Frontend deployed on Vercel
- [ ] Environment variables configured
- [ ] WebSocket connection working
- [ ] API calls functioning
- [ ] Stock alerts processing
- [ ] Real-time updates working
- [ ] No console errors
- [ ] Application fully functional

---

## 📞 Support & Resources

### Documentation
- [Railway Docs](https://docs.railway.app)
- [Vercel Docs](https://vercel.com/docs)

### Your Project URLs
- **Frontend**: `https://your-vercel-app.vercel.app`
- **Backend**: `https://your-railway-app.up.railway.app`

### API Endpoints
- Health Check: `https://your-railway-app.up.railway.app/api/health`
- Toplist: `https://your-railway-app.up.railway.app/api/toplist`
- WebSocket: `wss://your-railway-app.up.railway.app`

---

**Deployment Status**: ✅ Ready for Production  
**Last Updated**: January 2025  
**Architecture**: Frontend (Vercel) + Backend (Railway)
