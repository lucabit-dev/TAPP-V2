# Vercel Deployment Guide - Frontend Only

## 🎨 Deploy Frontend to Vercel

After deploying your backend to Railway, deploy the React frontend to Vercel.

### Prerequisites

✅ Backend deployed on Railway  
✅ Railway URL ready (e.g., `https://your-app.up.railway.app`)

---

## Step 1: Configure Vercel Project

Your repository is already connected to Vercel. Now we need to configure it for frontend-only deployment.

### In Vercel Dashboard:

1. Go to your project settings
2. Navigate to **"General"** → **"Build & Development Settings"**
3. Verify these settings:
   - **Framework Preset**: Other (or None)
   - **Build Command**: `cd client && npm install && npm run build`
   - **Output Directory**: `client/dist`
   - **Install Command**: Leave empty or `npm install`

---

## Step 2: Add Environment Variables

In Vercel Dashboard → **Settings** → **Environment Variables**:

Add these **TWO** variables (replace with your Railway URL):

| Variable Name | Value | Environments |
|--------------|-------|--------------|
| `VITE_API_BASE_URL` | `https://your-app.up.railway.app/api` | Production, Preview, Development |
| `VITE_WS_BASE_URL` | `wss://your-app.up.railway.app` | Production, Preview, Development |

**Example:**
```
VITE_API_BASE_URL=https://tapp-production.up.railway.app/api
VITE_WS_BASE_URL=wss://tapp-production.up.railway.app
```

⚠️ **Important**: 
- Use `https://` for API URL (with `/api` at the end)
- Use `wss://` for WebSocket URL (secure WebSocket)
- Check all three environment boxes for each variable

---

## Step 3: Deploy

### Option A: Automatic Deployment (Recommended)

Simply push to GitHub:
```bash
git add .
git commit -m "Configure for split deployment"
git push origin main
```

Vercel will automatically detect and deploy!

### Option B: Manual Deployment

1. Go to **Deployments** tab in Vercel
2. Click **"Redeploy"** on the latest deployment
3. Make sure "Use existing Build Cache" is unchecked

---

## Step 4: Test Your Deployment

Once deployed, visit your Vercel URL (e.g., `https://your-app.vercel.app`)

### ✅ Verify These Work:

1. **Frontend loads** - You should see the dashboard
2. **API calls work** - Check browser console (F12) for errors
3. **WebSocket connects** - Look for "Connected to backend WebSocket" in console
4. **Alerts load** - Valid alerts should appear
5. **Stock modal works** - Click an alert to see detailed info

### 🐛 Debugging:

Open browser console (F12) and check for:
- ✅ No CORS errors
- ✅ WebSocket connection successful
- ✅ API calls returning data
- ❌ Any 404 or 500 errors

---

## Step 5: Configure CORS on Backend (If Needed)

If you see CORS errors, you need to update your Railway backend.

### Update `server.js` on Railway:

The CORS configuration should allow your Vercel domain:

```javascript
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://your-app.vercel.app',  // Add your Vercel URL
    'https://*.vercel.app'           // Allow all Vercel preview deployments
  ],
  credentials: true
}));
```

Then push to GitHub - Railway will auto-redeploy.

---

## 🎯 Architecture Overview

```
┌─────────────────────────────────────────┐
│  User Browser                           │
│  https://your-app.vercel.app           │
└────────────┬────────────────────────────┘
             │
             │ HTTP/HTTPS Requests
             │ WebSocket Connection
             ▼
┌─────────────────────────────────────────┐
│  Railway Backend                        │
│  https://your-app.up.railway.app       │
│  - Express Server                       │
│  - WebSocket Server                     │
│  - ChartsWatcher Integration            │
│  - Polygon.io API                       │
└─────────────────────────────────────────┘
```

---

## 📊 Monitoring & Logs

### Vercel Logs:
- Go to **Deployments** → Click on a deployment → **View Function Logs**
- Check for build errors or runtime issues

### Railway Logs:
- Go to Railway dashboard → Your service → **Logs**
- Monitor API requests and WebSocket connections

---

## 🔄 Updating Your App

### Update Frontend:
```bash
# Make changes to client/src files
git add .
git commit -m "Update frontend"
git push origin main
# Vercel auto-deploys
```

### Update Backend:
```bash
# Make changes to server.js or other backend files
git add .
git commit -m "Update backend"
git push origin main
# Railway auto-redeploys
```

---

## 💰 Costs

### Vercel:
- **Free tier** is sufficient for this app
- Unlimited bandwidth for static files
- 100GB bandwidth/month free

### Railway:
- **$5/month free credit**
- Typically **$5-10/month** for this app
- Pay only for what you use

**Total: ~$5-10/month** for production deployment with full features!

---

## ✅ Success Checklist

- [ ] Backend deployed on Railway
- [ ] Railway URL obtained
- [ ] Environment variables added to Vercel
- [ ] Frontend deployed on Vercel
- [ ] Vercel URL accessible
- [ ] API calls working (check console)
- [ ] WebSocket connected (check console)
- [ ] Alerts loading successfully
- [ ] Stock modal displaying data
- [ ] No CORS errors

---

## 🎉 You're Live!

Your Trading Alerts Tool is now fully deployed with:
- ✅ Fast static frontend on Vercel
- ✅ Powerful backend with WebSockets on Railway
- ✅ Real-time alerts working
- ✅ Full technical indicators
- ✅ Professional deployment

**Frontend URL**: `https://your-app.vercel.app`  
**Backend URL**: `https://your-app.up.railway.app`

---

## 🆘 Need Help?

### Common Issues:

**CORS Errors**: Update CORS in `server.js` to include your Vercel domain  
**WebSocket Won't Connect**: Verify `VITE_WS_BASE_URL` uses `wss://`  
**API 404 Errors**: Check `VITE_API_BASE_URL` includes `/api` at the end  
**Build Fails**: Check TypeScript errors in build logs

### Resources:
- Railway Docs: https://docs.railway.app
- Vercel Docs: https://vercel.com/docs
- Your deployment guides: `RAILWAY_DEPLOYMENT.md`
