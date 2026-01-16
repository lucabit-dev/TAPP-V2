# AWS Deployment Quick Start Checklist

Use this checklist to track your deployment progress.

## Pre-Deployment

- [ ] AWS account created and billing enabled
- [ ] GitHub repository created (private recommended)
- [ ] Domain name purchased (optional but recommended)
- [ ] All API keys ready:
  - [ ] Polygon.io API Key
  - [ ] ChartsWatcher credentials
  - [ ] P&L API Key
  - [ ] MongoDB Atlas connection string

## Step 1: MongoDB Atlas Setup

- [ ] MongoDB Atlas account created
- [ ] Cluster created (Free tier M0 is fine)
- [ ] Database user created (`tapp-admin`)
- [ ] Network access configured (allow from anywhere initially)
- [ ] Connection string saved (`MONGODB_URI`)

## Step 2: EC2 Instance

- [ ] EC2 instance launched (t3.medium recommended)
- [ ] Security group configured:
  - [ ] SSH (22) - Your IP only
  - [ ] HTTP (80) - 0.0.0.0/0
  - [ ] HTTPS (443) - 0.0.0.0/0
  - [ ] Custom TCP (3001) - 0.0.0.0/0
- [ ] Elastic IP allocated and associated
- [ ] SSH key pair created/downloaded

## Step 3: EC2 Configuration

- [ ] Connected to EC2 via SSH
- [ ] Node.js 20.x installed
- [ ] Git installed
- [ ] PM2 installed
- [ ] Nginx installed
- [ ] Application directory created (`/var/www/tapp`)
- [ ] `.env` file created with all variables
- [ ] Repository cloned to EC2
- [ ] Dependencies installed (`npm install`)
- [ ] Frontend built (`cd client && npm run build`)
- [ ] PM2 ecosystem config created
- [ ] PM2 started and saved
- [ ] Nginx configured and started
- [ ] Application accessible via HTTP

## Step 4: GitHub Actions CI/CD

- [ ] GitHub Actions workflow file created (`.github/workflows/deploy-aws.yml`)
- [ ] GitHub Secrets configured:
  - [ ] `EC2_SSH_KEY` (your private SSH key)
  - [ ] `VITE_API_BASE_URL`
  - [ ] `VITE_WS_BASE_URL`
- [ ] Workflow file updated with your EC2 IP
- [ ] Test deployment triggered
- [ ] Deployment successful

## Step 5: Domain & SSL (Optional but Recommended)

- [ ] Domain DNS configured (A record → Elastic IP)
- [ ] Certbot installed on EC2
- [ ] SSL certificate obtained
- [ ] Nginx updated with SSL configuration
- [ ] HTTPS working
- [ ] Environment variables updated with domain URLs

## Step 6: Verification

- [ ] Application accessible via browser
- [ ] API endpoints responding (`/api/health`)
- [ ] WebSocket connection working
- [ ] Frontend loading correctly
- [ ] Database connection verified
- [ ] All features tested

## Step 7: Security Hardening

- [ ] MongoDB Atlas network access restricted to EC2 IP
- [ ] SSH access restricted to your IP only
- [ ] Firewall rules reviewed
- [ ] Environment variables secured
- [ ] SSL certificate auto-renewal configured

## Post-Deployment

- [ ] Monitoring set up (CloudWatch, PM2 monitoring)
- [ ] Backups configured
- [ ] Documentation updated
- [ ] Team notified of deployment URL

---

## Quick Commands Reference

### On EC2 Instance

```bash
# View application logs
pm2 logs tapp-backend

# Restart application
pm2 restart tapp-backend

# Check application status
pm2 status

# View Nginx logs
sudo tail -f /var/log/nginx/error.log

# Test Nginx configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# Check if app is running
curl http://localhost:3001/api/health
```

### Local Machine

```bash
# Test SSH connection
ssh -i ~/.ssh/your-key.pem ec2-user@YOUR_ELASTIC_IP

# Test API endpoint
curl http://YOUR_ELASTIC_IP/api/health

# Trigger manual deployment
git push origin main
```

---

## Common Issues & Solutions

### Issue: Can't connect via SSH
**Solution**: Check security group allows SSH from your IP

### Issue: Application not accessible
**Solution**: 
- Check security group allows HTTP/HTTPS
- Verify Nginx is running: `sudo systemctl status nginx`
- Check PM2: `pm2 status`

### Issue: WebSocket not connecting
**Solution**: 
- Verify Nginx has WebSocket headers
- Check application logs: `pm2 logs`
- Verify port 443 is open in security group

### Issue: GitHub Actions fails
**Solution**:
- Verify SSH key secret is correct
- Check EC2 IP in workflow file
- Ensure Git is installed on EC2

---

## Estimated Time

- **MongoDB Atlas Setup**: 10 minutes
- **EC2 Setup**: 30 minutes
- **Application Configuration**: 20 minutes
- **GitHub Actions Setup**: 15 minutes
- **Domain & SSL**: 15 minutes
- **Testing**: 20 minutes

**Total**: ~2 hours

---

## Cost Breakdown

| Service | Cost/Month |
|---------|-----------|
| EC2 t3.medium | ~$30 |
| Elastic IP | Free |
| S3 + CloudFront | ~$1-5 |
| MongoDB Atlas (Free tier) | $0 |
| Data Transfer | ~$5-10 |
| **Total** | **~$35-50** |

---

**Need Help?** Refer to `AWS_DEPLOYMENT.md` for detailed instructions.
