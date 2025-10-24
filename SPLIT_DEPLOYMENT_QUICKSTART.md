# 🚀 Split Deployment Quick Start

Deploy your Trading Alerts Tool with full WebSocket support!

---

## 📋 Deployment Order

### 1️⃣ Deploy Backend to Railway (15 minutes)
### 2️⃣ Deploy Frontend to Vercel (10 minutes)

---

## 1️⃣ BACKEND - Railway Deployment

### Step 1: Go to Railway
1. Visit https://railway.app
2. Sign up/login with GitHub

### Step 2: Create New Project
1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Choose: `lucabit-dev/TAPP`
4. Railway starts building automatically

### Step 3: Add Environment Variables
Click on your service → **Variables** tab → Add these:

```
POLYGON_API_KEY=oLNQ0GD8RpIcP8X2iApVnlzg28P6Ttcc
CHARTSWATCHER_USER_ID=68a9bba1b2c529407770fddb
CHARTSWATCHER_API_KEY=68ac935db2c5294077b0cd51
CHARTSWATCHER_CONFIG_ID=68d2f1d1e0373f708e67d801
PORT=3001
NODE_ENV=production
```

### Step 4: Get Your Railway URL
1. Wait for deployment to complete (~2-3 minutes)
2. Railway will show your URL (e.g., `https://tapp-production.up.railway.app`)
3. **COPY THIS URL** - you need it for step 2!

### Step 5: Test Backend
Visit: `https://your-railway-url.up.railway.app/api/health`

Should return: `{"status":"ok","message":"Trading Alerts API is running"}`

✅ **Backend deployed!**

---

## 2️⃣ FRONTEND - Vercel Deployment

### Step 1: Go to Vercel
Your project should already be connected. Go to: https://vercel.com/dashboard

### Step 2: Add Environment Variables
Go to your project → **Settings** → **Environment Variables**

Add these **TWO** variables (use your Railway URL from step 1):

```
VITE_API_BASE_URL=https://YOUR-RAILWAY-URL.up.railway.app/api
VITE_WS_BASE_URL=wss://YOUR-RAILWAY-URL.up.railway.app
```

**Example:**
```
VITE_API_BASE_URL=https://tapp-production.up.railway.app/api
VITE_WS_BASE_URL=wss://tapp-production.up.railway.app
```

⚠️ **Important:**
- Add to **all three environments** (Production, Preview, Development)
- Use `https://` for API (with `/api` at end)
- Use `wss://` for WebSocket (secure)

### Step 3: Redeploy
1. Go to **Deployments** tab
2. Click **"..."** on latest deployment
3. Click **"Redeploy"**
4. Uncheck "Use existing Build Cache"
5. Click **"Redeploy"**

### Step 4: Wait for Build
Build takes ~2-3 minutes. Watch the logs for any errors.

### Step 5: Test Frontend
1. Visit your Vercel URL (e.g., `https://your-app.vercel.app`)
2. Open browser console (F12)
3. Look for: "🔌 Connected to backend WebSocket"
4. Check alerts are loading

✅ **Frontend deployed!**

---

## 🎉 Success Checklist

- [ ] Railway backend deployed
- [ ] Railway URL copied
- [ ] Vercel environment variables added
- [ ] Vercel frontend deployed
- [ ] Website loads
- [ ] WebSocket connected (check console)
- [ ] Alerts loading
- [ ] Stock modal works

---

## 🐛 Troubleshooting

### "CORS Error"
Update `server.js` CORS to include your Vercel domain, then push to GitHub.

### "WebSocket connection failed"
- Check `VITE_WS_BASE_URL` uses `wss://` (not `ws://`)
- Verify Railway backend is running

### "API 404 errors"
- Check `VITE_API_BASE_URL` ends with `/api`
- Verify Railway URL is correct

### "Build fails on Vercel"
- Check build logs for TypeScript errors
- Verify `client/tsconfig.json` has `noUnusedLocals: false`

---

## 📊 Your Deployment

**Frontend (Vercel)**: `https://your-app.vercel.app`  
**Backend (Railway)**: `https://your-app.up.railway.app`

**Cost**: ~$5-10/month (Railway) + Free (Vercel)

---

## 🔄 Future Updates

Just push to GitHub - both platforms auto-deploy!

```bash
git add .
git commit -m "Your update"
git push origin main
```

- Railway redeploys backend automatically
- Vercel redeploys frontend automatically

---

## 📚 Detailed Guides

- **Railway Backend**: See `RAILWAY_DEPLOYMENT.md`
- **Vercel Frontend**: See `VERCEL_FRONTEND_DEPLOYMENT.md`

---

**Ready to deploy? Start with Step 1️⃣ (Railway)!** 🚀
