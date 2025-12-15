#!/bin/bash

# Health Check Script for 1815 API
set -e

# Configuration
API_URL=${1:-"http://localhost:3000"}
HEALTH_ENDPOINT="/api/v1/health"
TIMEOUT=10
MAX_RETRIES=3

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Checking health of 1815 API at ${API_URL}${HEALTH_ENDPOINT}...${NC}"

# Function to check health
check_health() {
    local retry_count=0
    
    while [ $retry_count -lt $MAX_RETRIES ]; do
        echo -e "${YELLOW}Attempt $((retry_count + 1))/${MAX_RETRIES}...${NC}"
        
        # Make health check request
        response=$(curl -s -w "%{http_code}" --connect-timeout $TIMEOUT "${API_URL}${HEALTH_ENDPOINT}" || echo "000")
        http_code="${response: -3}"
        body="${response%???}"
        
        if [ "$http_code" = "200" ]; then
            echo -e "${GREEN}✓ Health check passed${NC}"
            echo "Response: $body"
            
            # Parse JSON response to check individual services
            if command -v jq &> /dev/null; then
                echo -e "\n${YELLOW}Service Status:${NC}"
                echo "$body" | jq -r '.data | to_entries[] | "\(.key): \(.value.status)"' 2>/dev/null || echo "Could not parse service details"
            fi
            
            return 0
        else
            echo -e "${RED}✗ Health check failed (HTTP $http_code)${NC}"
            if [ -n "$body" ]; then
                echo "Response: $body"
            fi
        fi
        
        retry_count=$((retry_count + 1))
        if [ $retry_count -lt $MAX_RETRIES ]; then
            echo -e "${YELLOW}Retrying in 5 seconds...${NC}"
            sleep 5
        fi
    done
    
    return 1
}

# Function to check PM2 status
check_pm2_status() {
    if command -v pm2 &> /dev/null; then
        echo -e "\n${YELLOW}PM2 Process Status:${NC}"
        pm2 jlist | jq -r '.[] | select(.name=="1815-api") | "Name: \(.name), Status: \(.pm2_env.status), CPU: \(.monit.cpu)%, Memory: \(.monit.memory/1024/1024 | floor)MB"' 2>/dev/null || pm2 status
    fi
}

# Function to check system resources
check_system_resources() {
    echo -e "\n${YELLOW}System Resources:${NC}"
    
    # Memory usage
    if command -v free &> /dev/null; then
        echo "Memory Usage:"
        free -h | grep -E "Mem|Swap"
    fi
    
    # Disk usage
    echo "Disk Usage:"
    df -h / 2>/dev/null || echo "Could not check disk usage"
    
    # Load average
    if [ -f /proc/loadavg ]; then
        echo "Load Average: $(cat /proc/loadavg | cut -d' ' -f1-3)"
    fi
}

# Main execution
if check_health; then
    check_pm2_status
    check_system_resources
    echo -e "\n${GREEN}All checks completed successfully!${NC}"
    exit 0
else
    echo -e "\n${RED}Health check failed after $MAX_RETRIES attempts${NC}"
    check_pm2_status
    exit 1
fi