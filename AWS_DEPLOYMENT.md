# AWS Deployment Guide

Complete step-by-step guide to deploy your Trading Alerts Tool to AWS with automatic GitHub deployment.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Step 1: Set Up MongoDB Atlas](#step-1-set-up-mongodb-atlas)
4. [Step 2: Create EC2 Instance](#step-2-create-ec2-instance)
5. [Step 3: Configure EC2 Instance](#step-3-configure-ec2-instance)
6. [Step 4: Set Up GitHub Actions CI/CD](#step-4-set-up-github-actions-cicd)
7. [Step 5: Deploy Frontend to S3 + CloudFront](#step-5-deploy-frontend-to-s3--cloudfront)
8. [Step 6: Configure Domain & SSL](#step-6-configure-domain--ssl)
9. [Step 7: Set Up Monitoring](#step-7-set-up-monitoring)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- ✅ AWS Account (with billing enabled)
- ✅ GitHub repository (private recommended)
- ✅ Domain name (optional, but recommended)
- ✅ AWS CLI installed locally (optional, for easier management)
- ✅ SSH key pair for EC2 access

---

## Architecture Overview

**Recommended Setup:**
- **Backend**: EC2 instance (t3.medium or larger) - handles WebSockets
- **Frontend**: S3 + CloudFront (static hosting with CDN)
- **Database**: MongoDB Atlas (managed MongoDB)
- **CI/CD**: GitHub Actions (automatic deployment)
- **Load Balancer**: Application Load Balancer (optional, for high availability)

**Alternative (Simpler):**
- **Full Stack**: Single EC2 instance (backend + frontend)
- **Database**: MongoDB Atlas
- **CI/CD**: GitHub Actions

---

## Step 1: Set Up MongoDB Atlas

### 1.1 Create MongoDB Atlas Account
1. Go to https://www.mongodb.com/cloud/atlas
2. Sign up for free account
3. Create a new cluster (Free tier: M0 Sandbox)

### 1.2 Configure Database
1. **Create Database User**:
   - Go to "Database Access" → "Add New Database User"
   - Username: `tapp-admin`
   - Password: Generate secure password (save it!)
   - Database User Privileges: "Atlas admin"

2. **Configure Network Access**:
   - Go to "Network Access" → "Add IP Address"
   - For now: Add `0.0.0.0/0` (allow from anywhere)
   - **Later**: Restrict to your EC2 IP after deployment

3. **Get Connection String**:
   - Go to "Database" → "Connect"
   - Choose "Connect your application"
   - Copy connection string (looks like: `mongodb+srv://username:password@cluster.mongodb.net/tapp?retryWrites=true&w=majority`)
   - Replace `<password>` with your actual password
   - Save this as `MONGODB_URI`

---

## Step 2: Create EC2 Instance

### 2.1 Launch EC2 Instance

1. **Go to EC2 Console**:
   - Log into AWS Console
   - Navigate to EC2 → "Instances" → "Launch Instance"

2. **Configure Instance**:
   - **Name**: `tapp-backend` (or your preferred name)
   - **AMI**: Amazon Linux 2023 (or Ubuntu 22.04 LTS)
   - **Instance Type**: `t3.medium` (2 vCPU, 4 GB RAM) - minimum for WebSockets
   - **Key Pair**: Create new or select existing SSH key pair
   - **Network Settings**: 
     - Create new security group or select existing
     - **Inbound Rules** (add these):
       - SSH (22) - Your IP only
       - HTTP (80) - 0.0.0.0/0
       - HTTPS (443) - 0.0.0.0/0
       - Custom TCP (3001) - 0.0.0.0/0 (for your app)
   - **Storage**: 20 GB gp3 (minimum)

3. **Launch Instance**:
   - Click "Launch Instance"
   - Wait for instance to be "Running"

### 2.2 Allocate Elastic IP (Recommended)

1. Go to EC2 → "Elastic IPs" → "Allocate Elastic IP address"
2. Click "Allocate"
3. Select the Elastic IP → "Actions" → "Associate Elastic IP address"
4. Select your instance
5. **Save this IP** - you'll need it for:
   - MongoDB Atlas network whitelist
   - GitHub Actions deployment
   - Domain DNS configuration

---

## Step 3: Configure EC2 Instance

### 3.1 Connect to EC2 Instance

```bash
# Replace with your key file and Elastic IP
ssh -i ~/.ssh/your-key.pem ec2-user@YOUR_ELASTIC_IP

# For Ubuntu:
ssh -i ~/.ssh/your-key.pem ubuntu@YOUR_ELASTIC_IP
```

### 3.2 Install Dependencies

**For Amazon Linux 2023:**
```bash
# Update system
sudo yum update -y

# Install Node.js 20.x
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Install Git
sudo yum install -y git

# Install PM2 (process manager)
sudo npm install -g pm2

# Install Nginx (for reverse proxy)
sudo yum install -y nginx
```

**For Ubuntu 22.04:**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Git
sudo apt install -y git

# Install PM2
sudo npm install -g pm2

# Install Nginx
sudo apt install -y nginx
```

### 3.3 Set Up Application Directory

```bash
# Create app directory
sudo mkdir -p /var/www/tapp
sudo chown ec2-user:ec2-user /var/www/tapp  # For Amazon Linux
# OR
sudo chown ubuntu:ubuntu /var/www/tapp  # For Ubuntu

cd /var/www/tapp

# Clone your repository (you'll set up GitHub Actions later)
# For now, we'll set up the structure manually
```

### 3.4 Configure Environment Variables

```bash
# Create .env file
nano /var/www/tapp/.env
```

Add all your environment variables:
```env
# Server Configuration
PORT=3001
NODE_ENV=production

# MongoDB Atlas
MONGODB_URI=mongodb+srv://tapp-admin:YOUR_PASSWORD@cluster.mongodb.net/tapp?retryWrites=true&w=majority

# Polygon.io API
POLYGON_API_KEY=your_polygon_api_key

# ChartsWatcher API
CHARTSWATCHER_USER_ID=your_user_id
CHARTSWATCHER_API_KEY=your_api_key
CHARTSWATCHER_CONFIG_ID=your_config_id

# P&L API
PNL_API_KEY=your_pnl_api_key
PNL_WS_BASE_URL=wss://sections-bot.inbitme.com

# Auth
JWT_SECRET=your_long_random_secret_string_min_32_chars

# Optional
WS_HEARTBEAT_MS=30000
ENABLE_VERIFICATION=false
LOG_LEVEL=info
```

Save and exit (Ctrl+X, then Y, then Enter)

### 3.5 Configure Nginx Reverse Proxy

```bash
sudo nano /etc/nginx/conf.d/tapp.conf
```

Add this configuration:
```nginx
# Upstream for Node.js app
upstream tapp_backend {
    server localhost:3001;
    keepalive 64;
}

# HTTP server - redirect to HTTPS
server {
    listen 80;
    server_name YOUR_DOMAIN.com www.YOUR_DOMAIN.com;  # Replace with your domain
    
    # For Let's Encrypt verification (if using)
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    # Redirect all HTTP to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name YOUR_DOMAIN.com www.YOUR_DOMAIN.com;  # Replace with your domain
    
    # SSL certificates (we'll set these up later)
    # ssl_certificate /etc/letsencrypt/live/YOUR_DOMAIN.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN.com/privkey.pem;
    
    # For now, comment out SSL and use HTTP only
    # After setting up SSL, uncomment the SSL lines above
    
    # WebSocket support
    location / {
        proxy_pass http://tapp_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # WebSocket specific
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
    
    # API routes
    location /api {
        proxy_pass http://tapp_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Static files (if serving frontend from same server)
    location /static {
        alias /var/www/tapp/client/dist;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**For initial setup without domain:**
```bash
sudo nano /etc/nginx/conf.d/tapp.conf
```

```nginx
upstream tapp_backend {
    server localhost:3001;
    keepalive 64;
}

server {
    listen 80;
    server_name _;  # Accept any hostname
    
    location / {
        proxy_pass http://tapp_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
    
    location /api {
        proxy_pass http://tapp_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Test and restart Nginx:
```bash
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 3.6 Set Up PM2 for Process Management

```bash
# Create PM2 ecosystem file
nano /var/www/tapp/ecosystem.config.js
```

```javascript
module.exports = {
  apps: [{
    name: 'tapp-backend',
    script: 'server.js',
    cwd: '/var/www/tapp',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: '/var/www/tapp/logs/pm2-error.log',
    out_file: '/var/www/tapp/logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    watch: false
  }]
};
```

```bash
# Create logs directory
mkdir -p /var/www/tapp/logs

# Start PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Set up PM2 to start on boot
pm2 startup
# Follow the instructions it prints
```

---

## Step 4: Set Up GitHub Actions CI/CD

### 4.1 Create GitHub Actions Workflow

Create the workflow file in your repository:

```bash
# On your local machine
mkdir -p .github/workflows
nano .github/workflows/deploy-aws.yml
```

Add this workflow:

```yaml
name: Deploy to AWS EC2

on:
  push:
    branches:
      - main  # Change to your main branch name
  workflow_dispatch:  # Allow manual triggers

env:
  AWS_REGION: us-east-1  # Change to your AWS region
  EC2_INSTANCE_IP: YOUR_ELASTIC_IP  # Your EC2 Elastic IP
  EC2_USER: ec2-user  # Use 'ubuntu' for Ubuntu instances
  APP_DIR: /var/www/tapp

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: |
          npm ci
          cd client && npm ci
      
      - name: Build frontend
        run: |
          cd client
          npm run build
        env:
          VITE_API_BASE_URL: ${{ secrets.VITE_API_BASE_URL }}
          VITE_WS_BASE_URL: ${{ secrets.VITE_WS_BASE_URL }}
      
      - name: Configure SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.EC2_SSH_KEY }}" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -H ${{ env.EC2_INSTANCE_IP }} >> ~/.ssh/known_hosts
      
      - name: Deploy to EC2
        run: |
          ssh -i ~/.ssh/deploy_key -o StrictHostKeyChecking=no ${{ env.EC2_USER }}@${{ env.EC2_INSTANCE_IP }} << 'EOF'
            set -e
            cd ${{ env.APP_DIR }}
            
            # Pull latest code
            git fetch origin
            git reset --hard origin/main
            
            # Install/update dependencies
            npm ci --production
            
            # Copy frontend build
            cp -r client/dist/* /var/www/tapp/client/dist/ 2>/dev/null || mkdir -p /var/www/tapp/client/dist && cp -r client/dist/* /var/www/tapp/client/dist/
            
            # Restart application with PM2
            pm2 restart tapp-backend || pm2 start ecosystem.config.js
            
            # Show status
            pm2 status
          EOF
      
      - name: Verify deployment
        run: |
          sleep 5
          curl -f http://${{ env.EC2_INSTANCE_IP }}/api/health || exit 1
```

### 4.2 Set Up GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add:

   - **`EC2_SSH_KEY`**: Your private SSH key content (the .pem file)
     ```bash
     # Get the content:
     cat ~/.ssh/your-key.pem
     # Copy the entire output including -----BEGIN and -----END lines
     ```
   
   - **`VITE_API_BASE_URL`**: `https://YOUR_DOMAIN.com/api` (or `http://YOUR_ELASTIC_IP/api` if no domain)
   
   - **`VITE_WS_BASE_URL`**: `wss://YOUR_DOMAIN.com` (or `ws://YOUR_ELASTIC_IP` if no domain)

**Note for Private Repositories:**
If your repository is private, you need to set up authentication on EC2. Choose one method:

**Option 1: GitHub Personal Access Token (Recommended)**
1. Create a token: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate token with `repo` scope
3. On EC2, configure git:
   ```bash
   git config --global credential.helper store
   echo "https://YOUR_TOKEN@github.com" > ~/.git-credentials
   chmod 600 ~/.git-credentials
   ```

**Option 2: SSH Key**
1. Generate SSH key on EC2: `ssh-keygen -t ed25519 -C "ec2-deploy"`
2. Add public key to GitHub: Settings → SSH and GPG keys
3. Update workflow to use SSH URL (change `https://` to `git@github.com:`)

### 4.3 Initial Manual Deployment

Before GitHub Actions works, you need to set up the repository on EC2:

```bash
# SSH into your EC2 instance
ssh -i ~/.ssh/your-key.pem ec2-user@YOUR_ELASTIC_IP

# Install Git if not already installed
sudo yum install -y git  # Amazon Linux
# OR
sudo apt install -y git  # Ubuntu

# Clone your repository
cd /var/www/tapp

# For public repos:
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git .

# For private repos, use one of these methods:
# Option 1: Use personal access token
# git clone https://YOUR_TOKEN@github.com/YOUR_USERNAME/YOUR_REPO.git .

# Option 2: Set up SSH key (recommended)
# ssh-keygen -t ed25519 -C "ec2-deploy"
# cat ~/.ssh/id_ed25519.pub
# Add this public key to GitHub → Settings → SSH and GPG keys
# git clone git@github.com:YOUR_USERNAME/YOUR_REPO.git .

# Install dependencies
npm install --production
cd client && npm install && npm run build && cd ..

# Copy environment file
# Make sure .env is already set up (from Step 3.4)

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
```

### 4.4 Test GitHub Actions

1. Make a small change to your code
2. Commit and push:
   ```bash
   git add .
   git commit -m "Test deployment"
   git push origin main
   ```
3. Go to GitHub → **Actions** tab
4. Watch the deployment workflow run
5. Check your EC2 instance to verify deployment

---

## Step 5: Deploy Frontend to S3 + CloudFront (Optional)

If you want to serve the frontend separately (better performance):

### 5.1 Create S3 Bucket

1. Go to S3 → "Create bucket"
2. **Bucket name**: `tapp-frontend` (must be globally unique)
3. **Region**: Same as your EC2 instance
4. **Block Public Access**: Uncheck (we'll make it public for static hosting)
5. **Bucket Versioning**: Enable (optional)
6. Create bucket

### 5.2 Configure S3 for Static Hosting

1. Select your bucket → "Properties"
2. Scroll to "Static website hosting" → "Edit"
3. Enable static website hosting
4. **Index document**: `index.html`
5. **Error document**: `index.html` (for React Router)
6. Save

### 5.3 Set Bucket Policy

1. Go to "Permissions" → "Bucket policy"
2. Add this policy (replace `YOUR_BUCKET_NAME`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

### 5.4 Create CloudFront Distribution

1. Go to CloudFront → "Create distribution"
2. **Origin domain**: Select your S3 bucket
3. **Viewer protocol policy**: Redirect HTTP to HTTPS
4. **Allowed HTTP methods**: GET, HEAD, OPTIONS
5. **Cache policy**: CachingOptimized
6. **Default root object**: `index.html`
7. **Custom error responses**:
   - 403 → 200 → `/index.html`
   - 404 → 200 → `/index.html`
8. Create distribution
9. **Save the CloudFront URL** (e.g., `d1234abcd.cloudfront.net`)

### 5.5 Update GitHub Actions for S3 Deployment

Add this to your workflow after the build step:

```yaml
      - name: Deploy frontend to S3
        run: |
          aws s3 sync client/dist/ s3://YOUR_BUCKET_NAME/ --delete
          aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

Add these secrets to GitHub:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

---

## Step 6: Configure Domain & SSL

### 6.1 Point Domain to EC2

1. Go to your domain registrar (GoDaddy, Namecheap, etc.)
2. Add DNS records:
   - **A Record**: `@` → Your Elastic IP
   - **A Record**: `www` → Your Elastic IP

### 6.2 Install SSL Certificate with Let's Encrypt

```bash
# SSH into EC2
ssh -i ~/.ssh/your-key.pem ec2-user@YOUR_ELASTIC_IP

# Install Certbot
sudo yum install -y certbot python3-certbot-nginx  # Amazon Linux
# OR
sudo apt install -y certbot python3-certbot-nginx  # Ubuntu

# Get certificate
sudo certbot --nginx -d YOUR_DOMAIN.com -d www.YOUR_DOMAIN.com

# Follow prompts:
# - Enter email
# - Agree to terms
# - Choose whether to redirect HTTP to HTTPS (recommended: Yes)

# Test auto-renewal
sudo certbot renew --dry-run

# Certbot will automatically update your Nginx config
```

### 6.3 Update Environment Variables

Update your `.env` on EC2 and GitHub secrets:
- `VITE_API_BASE_URL`: `https://YOUR_DOMAIN.com/api`
- `VITE_WS_BASE_URL`: `wss://YOUR_DOMAIN.com`

---

## Step 7: Set Up Monitoring

### 7.1 CloudWatch Logs

```bash
# Install CloudWatch agent (optional)
# This allows you to view logs in AWS Console
```

### 7.2 PM2 Monitoring

```bash
# On EC2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 7.3 Health Check Endpoint

Your app already has `/api/health` endpoint. Set up CloudWatch alarms:

1. Go to CloudWatch → "Alarms" → "Create alarm"
2. **Metric**: EC2 → "StatusCheckFailed"
3. **Threshold**: Any status check failure
4. **Action**: Send notification to SNS topic

---

## Troubleshooting

### Application Won't Start

```bash
# Check PM2 logs
pm2 logs tapp-backend

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log

# Check if port is in use
sudo netstat -tulpn | grep 3001
```

### WebSocket Connection Fails

1. Check Nginx config has WebSocket headers
2. Verify security group allows port 443
3. Check application logs for WebSocket errors

### GitHub Actions Deployment Fails

1. Verify SSH key secret is correct
2. Check EC2 instance IP is correct
3. Ensure Git is installed on EC2
4. Verify repository is accessible

### Database Connection Issues

1. Check MongoDB Atlas network access (whitelist EC2 IP)
2. Verify `MONGODB_URI` is correct
3. Check MongoDB user permissions

---

## Cost Estimation

**Monthly Costs (Approximate):**
- EC2 t3.medium: ~$30/month
- Elastic IP: Free (if attached to instance)
- S3 + CloudFront: ~$1-5/month (for frontend)
- MongoDB Atlas: Free tier available
- Data Transfer: ~$5-10/month
- **Total**: ~$35-50/month

**Free Tier Eligible:**
- First 12 months: t2.micro instance (not recommended for production)
- S3: 5 GB storage
- CloudFront: 1 TB data transfer

---

## Security Best Practices

1. ✅ **Restrict SSH Access**: Only allow your IP in security group
2. ✅ **Use Environment Variables**: Never commit secrets
3. ✅ **Enable HTTPS**: Always use SSL/TLS
4. ✅ **Restrict MongoDB Access**: Whitelist only EC2 IP
5. ✅ **Regular Updates**: Keep system and dependencies updated
6. ✅ **Firewall**: Use security groups to restrict ports
7. ✅ **Backup**: Set up automated backups for database

---

## Next Steps

1. ✅ Test all features after deployment
2. ✅ Set up automated backups
3. ✅ Configure monitoring alerts
4. ✅ Set up staging environment (optional)
5. ✅ Document your deployment process
6. ✅ Set up log aggregation (CloudWatch, etc.)

---

## Support Resources

- **AWS EC2 Documentation**: https://docs.aws.amazon.com/ec2/
- **GitHub Actions**: https://docs.github.com/en/actions
- **MongoDB Atlas**: https://docs.atlas.mongodb.com/
- **PM2 Documentation**: https://pm2.keymetrics.io/docs/

---

**Last Updated**: January 2025
**Status**: Production Ready ✅
