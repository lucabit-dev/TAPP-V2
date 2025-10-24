#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Trading Dashboard with Clean Ports${NC}"
echo "=================================================="

# Function to kill processes on specific ports
kill_port() {
    local port=$1
    local process_name=$2
    
    echo -e "${YELLOW}🔍 Checking port $port ($process_name)...${NC}"
    
    # Find processes using the port
    local pids=$(lsof -ti:$port 2>/dev/null)
    
    if [ -n "$pids" ]; then
        echo -e "${RED}⚠️  Found processes on port $port: $pids${NC}"
        echo -e "${YELLOW}🔄 Killing processes on port $port...${NC}"
        
        # Kill processes
        echo $pids | xargs kill -9 2>/dev/null
        
        # Wait a moment
        sleep 1
        
        # Check if still running
        local remaining_pids=$(lsof -ti:$port 2>/dev/null)
        if [ -n "$remaining_pids" ]; then
            echo -e "${RED}❌ Failed to kill some processes on port $port${NC}"
            echo -e "${YELLOW}🔄 Trying force kill...${NC}"
            echo $remaining_pids | xargs kill -9 2>/dev/null
            sleep 1
        else
            echo -e "${GREEN}✅ Successfully cleared port $port${NC}"
        fi
    else
        echo -e "${GREEN}✅ Port $port is free${NC}"
    fi
}

# Function to kill processes by name pattern
kill_processes() {
    local pattern=$1
    local name=$2
    
    echo -e "${YELLOW}🔍 Checking for $name processes...${NC}"
    
    # Find processes matching pattern
    local pids=$(pgrep -f "$pattern" 2>/dev/null)
    
    if [ -n "$pids" ]; then
        echo -e "${RED}⚠️  Found $name processes: $pids${NC}"
        echo -e "${YELLOW}🔄 Killing $name processes...${NC}"
        
        # Kill processes
        pkill -f "$pattern" 2>/dev/null
        sleep 1
        
        # Check if still running
        local remaining_pids=$(pgrep -f "$pattern" 2>/dev/null)
        if [ -n "$remaining_pids" ]; then
            echo -e "${RED}❌ Failed to kill some $name processes${NC}"
            echo -e "${YELLOW}🔄 Trying force kill...${NC}"
            pkill -9 -f "$pattern" 2>/dev/null
            sleep 1
        else
            echo -e "${GREEN}✅ Successfully cleared $name processes${NC}"
        fi
    else
        echo -e "${GREEN}✅ No $name processes found${NC}"
    fi
}

# Clear specific ports
kill_port 3001 "Backend Server"
kill_port 5173 "Vite Dev Server"

# Clear process patterns
kill_processes "node.*server.js" "Node.js Server"
kill_processes "vite" "Vite Dev Server"
kill_processes "concurrently" "Concurrently"

echo ""
echo -e "${BLUE}🧹 Port cleanup completed!${NC}"
echo "=================================================="

# Wait a moment for cleanup to complete
sleep 2

# Check final status
echo -e "${YELLOW}📊 Final port status:${NC}"
echo -e "Port 3001: $(lsof -ti:3001 >/dev/null 2>&1 && echo -e "${RED}❌ OCCUPIED${NC}" || echo -e "${GREEN}✅ FREE${NC}")"
echo -e "Port 5173: $(lsof -ti:5173 >/dev/null 2>&1 && echo -e "${RED}❌ OCCUPIED${NC}" || echo -e "${GREEN}✅ FREE${NC}")"

echo ""
echo -e "${BLUE}🚀 Starting services...${NC}"
echo "=================================================="

# Start the services
npm run start-full-original
