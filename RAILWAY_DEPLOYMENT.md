# Railway Deployment Guide - Backend

## 🚂 Deploy Backend to Railway

Railway is perfect for your Node.js backend with WebSocket support!

### Step 1: Create Railway Account

1. Go to https://railway.app
2. Sign up with GitHub (recommended)

### Step 2: Deploy from GitHub

1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Choose your repository: `lucabit-dev/TAPP`
4. Railway will automatically detect it's a Node.js project

### Step 3: Configure Environment Variables

After deployment starts, add these environment variables:

1. Go to your project
2. Click on your service
3. Go to **"Variables"** tab
4. Add these variables:

```
POLYGON_API_KEY=oLNQ0GD8RpIcP8X2iApVnlzg28P6Ttcc
CHARTSWATCHER_USER_ID=68a9bba1b2c529407770fddb
CHARTSWATCHER_API_KEY=68ac935db2c5294077b0cd51
CHARTSWATCHER_CONFIG_ID=68d2f1d1e0373f708e67d801
PORT=3001
NODE_ENV=production
```

### Step 4: Get Your Railway URL

1. After deployment completes, Railway will give you a URL
2. It will look like: `https://your-app.up.railway.app`
3. **Copy this URL** - you'll need it for the frontend!

### Step 5: Test Your Backend

Visit these URLs to verify it's working:

```
https://your-app.up.railway.app/api/health
https://your-app.up.railway.app/api/chartswatcher/status
https://your-app.up.railway.app/api/toplist
```

### Step 6: Enable WebSocket Support

Railway automatically supports WebSockets - no configuration needed! ✅

Your WebSocket URL will be:
```
wss://your-app.up.railway.app
```

---

## 🎯 Important Notes

### Railway Advantages:
- ✅ **Full WebSocket support** (no timeouts!)
- ✅ **Always-on server** (not serverless)
- ✅ **$5/month free credit** (enough for testing)
- ✅ **Automatic HTTPS and WSS**
- ✅ **Easy GitHub integration**

### Monitoring:
- Check logs in Railway dashboard
- Monitor resource usage
- Set up alerts (optional)

### Pricing:
- Free $5/month credit
- Pay only for what you use after that
- Typically $5-10/month for this app

---

## 🔄 Redeployment

Railway automatically redeploys when you push to GitHub!

```bash
git add .
git commit -m "Update backend"
git push origin main
```

Railway will detect the push and redeploy automatically.

---

## 🐛 Troubleshooting

### Build Fails
- Check build logs in Railway dashboard
- Verify all dependencies are in `package.json`
- Check Node.js version compatibility

### Server Won't Start
- Check environment variables are set
- Review logs for errors
- Verify PORT is set to 3001

### WebSocket Not Connecting
- Verify URL uses `wss://` (not `ws://`)
- Check CORS settings in `server.js`
- Review Railway logs for connection errors

---

## ✅ Next Step

Once your backend is deployed on Railway, proceed to deploy the frontend on Vercel!

**Your Railway URL**: `https://your-app.up.railway.app`

Keep this URL handy - you'll need it for the frontend configuration!
