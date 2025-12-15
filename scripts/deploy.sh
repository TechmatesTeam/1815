#!/bin/bash

# 1815 API Deployment Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-production}
APP_NAME="1815-api"
LOG_DIR="./logs"

echo -e "${GREEN}Starting deployment for ${ENVIRONMENT} environment...${NC}"

# Validate environment
if [[ "$ENVIRONMENT" != "production" && "$ENVIRONMENT" != "staging" ]]; then
    echo -e "${RED}Error: Environment must be 'production' or 'staging'${NC}"
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p $LOG_DIR

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}PM2 not found. Installing PM2...${NC}"
    npm install -g pm2
fi

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
npm ci --only=production

# Build the application
echo -e "${YELLOW}Building application...${NC}"
npm run build

# Copy environment file
if [[ -f ".env.${ENVIRONMENT}" ]]; then
    echo -e "${YELLOW}Copying environment configuration...${NC}"
    cp ".env.${ENVIRONMENT}" .env
else
    echo -e "${RED}Warning: .env.${ENVIRONMENT} not found. Using default .env${NC}"
fi

# Stop existing PM2 processes
echo -e "${YELLOW}Stopping existing processes...${NC}"
pm2 stop $APP_NAME 2>/dev/null || echo "No existing process to stop"

# Start the application with PM2
echo -e "${YELLOW}Starting application with PM2...${NC}"
pm2 start ecosystem.config.js --env $ENVIRONMENT

# Save PM2 configuration
pm2 save

# Setup PM2 startup script (run once per server)
if [[ "$ENVIRONMENT" == "production" ]]; then
    echo -e "${YELLOW}Setting up PM2 startup script...${NC}"
    pm2 startup || echo "PM2 startup already configured"
fi

# Show status
echo -e "${GREEN}Deployment completed successfully!${NC}"
pm2 status
pm2 logs $APP_NAME --lines 10

echo -e "${GREEN}Application is running on port 3000${NC}"
echo -e "${YELLOW}Useful commands:${NC}"
echo -e "  pm2 status           - Show process status"
echo -e "  pm2 logs $APP_NAME   - Show logs"
echo -e "  pm2 restart $APP_NAME - Restart application"
echo -e "  pm2 stop $APP_NAME   - Stop application"
echo -e "  pm2 monit            - Monitor processes"