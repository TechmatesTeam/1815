# 1815 API Deployment Guide

This guide covers deployment options for the 1815 API in different environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Docker Deployment](#docker-deployment)
- [PM2 Deployment](#pm2-deployment)
- [Production Deployment](#production-deployment)
- [Monitoring and Logging](#monitoring-and-logging)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- Node.js 18+
- MongoDB 7.0+
- Redis 7.2+
- Docker & Docker Compose (for containerized deployment)
- PM2 (for process management)

### External Services

- Blockfrost API account and API key
- SendGrid account and API key
- AWS account for S3 storage (optional)

## Environment Configuration

### Development Environment

```bash
# Copy environment template
cp .env.template .env

# Edit environment variables
nano .env
```

### Production Environment

```bash
# Copy production template
cp .env.production .env

# Set required environment variables
export MONGODB_URI="mongodb://localhost:27017/1815_prod"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET="your-super-secret-jwt-key"
export BLOCKFROST_API_KEY="your-blockfrost-api-key"
export SENDGRID_API_KEY="your-sendgrid-api-key"
```

## Docker Deployment

### Development with Docker

```bash
# Start development environment
npm run docker:dev

# Build and start
npm run docker:dev:build

# View logs
npm run docker:logs

# Stop services
npm run docker:down
```

### Production with Docker

```bash
# Start production environment
npm run docker:prod

# Build and start
npm run docker:prod:build

# View logs
npm run docker:logs:prod

# Stop services
npm run docker:down:prod
```

### Available Services

- **API**: http://localhost:3000
- **MongoDB Express**: http://localhost:8082 (admin/admin123)
- **Redis Commander**: http://localhost:8081 (admin/admin123)
- **MailHog** (dev only): http://localhost:8025

## PM2 Deployment

### Installation

```bash
# Install PM2 globally
npm install -g pm2

# Install dependencies
npm ci --only=production

# Build application
npm run build
```

### Starting the Application

```bash
# Start with PM2
npm run pm2:start:prod

# Or use the deployment script
npm run deploy:production
```

### PM2 Commands

```bash
# View status
pm2 status

# View logs
pm2 logs 1815-api

# Restart application
pm2 restart 1815-api

# Stop application
pm2 stop 1815-api

# Monitor processes
pm2 monit

# Save configuration
pm2 save

# Setup startup script
pm2 startup
```

## Production Deployment

### Server Setup

1. **Install Dependencies**

   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y

   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs

   # Install PM2
   sudo npm install -g pm2

   # Install MongoDB
   # Follow MongoDB installation guide for your OS

   # Install Redis
   sudo apt install redis-server
   ```

2. **Application Deployment**

   ```bash
   # Clone repository
   git clone https://github.com/Emmanuel-Odero/1815.git
   cd 1815/1815-api

   # Install dependencies
   npm ci --only=production

   # Build application
   npm run build

   # Deploy
   ./scripts/deploy.sh production
   ```

3. **Nginx Configuration** (Optional)

   ```bash
   # Install Nginx
   sudo apt install nginx

   # Copy configuration
   sudo cp nginx/nginx.conf /etc/nginx/sites-available/1815-api
   sudo ln -s /etc/nginx/sites-available/1815-api /etc/nginx/sites-enabled/

   # Test and reload
   sudo nginx -t
   sudo systemctl reload nginx
   ```

### SSL Certificate Setup

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

## Monitoring and Logging

### Health Checks

```bash
# Manual health check
npm run health-check

# Or direct curl
curl http://localhost:3000/api/v1/health
```

### Log Files

- **Application Logs**: `./logs/combined.log`
- **Error Logs**: `./logs/error.log`
- **PM2 Logs**: `~/.pm2/logs/`

### Monitoring Endpoints

- **Health**: `/api/v1/health`
- **Stats**: `/api/v1/stats`
- **Metrics**: Available through PM2 monitoring

### Log Rotation

```bash
# Setup logrotate
sudo nano /etc/logrotate.d/1815-api

# Add configuration:
/path/to/1815-api/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 nodejs nodejs
    postrotate
        pm2 reloadLogs
    endscript
}
```

## Troubleshooting

### Common Issues

1. **Port Already in Use**

   ```bash
   # Find process using port 3000
   lsof -i :3000

   # Kill process
   kill -9 <PID>
   ```

2. **MongoDB Connection Issues**

   ```bash
   # Check MongoDB status
   sudo systemctl status mongod

   # Start MongoDB
   sudo systemctl start mongod

   # Check logs
   sudo tail -f /var/log/mongodb/mongod.log
   ```

3. **Redis Connection Issues**

   ```bash
   # Check Redis status
   sudo systemctl status redis

   # Start Redis
   sudo systemctl start redis

   # Test connection
   redis-cli ping
   ```

4. **PM2 Process Issues**

   ```bash
   # Restart all processes
   pm2 restart all

   # Delete and restart
   pm2 delete 1815-api
   pm2 start ecosystem.config.js --env production

   # Check logs for errors
   pm2 logs 1815-api --lines 50
   ```

### Performance Tuning

1. **MongoDB Optimization**
   - Ensure proper indexes are created
   - Monitor slow queries
   - Configure appropriate connection pool size

2. **Redis Optimization**
   - Set appropriate memory limits
   - Configure persistence settings
   - Monitor memory usage

3. **Node.js Optimization**
   - Use cluster mode with PM2
   - Monitor memory leaks
   - Optimize garbage collection

### Backup and Recovery

1. **Database Backup**

   ```bash
   # MongoDB backup
   mongodump --db 1815_prod --out /backup/mongodb/$(date +%Y%m%d)

   # Redis backup
   cp /var/lib/redis/dump.rdb /backup/redis/dump-$(date +%Y%m%d).rdb
   ```

2. **Application Backup**
   ```bash
   # Create application backup
   tar -czf /backup/app/1815-api-$(date +%Y%m%d).tar.gz /path/to/1815-api
   ```

## Security Considerations

1. **Environment Variables**
   - Never commit sensitive environment variables
   - Use strong passwords and secrets
   - Rotate API keys regularly

2. **Network Security**
   - Use HTTPS in production
   - Configure firewall rules
   - Limit database access

3. **Application Security**
   - Keep dependencies updated
   - Monitor security vulnerabilities
   - Implement proper input validation

## Support

For deployment issues or questions:

- Check the [GitHub Issues](https://github.com/Emmanuel-Odero/1815/issues)
- Review application logs
- Contact support at support@1815.dev
