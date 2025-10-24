#!/bin/bash

# Trading Alerts Tool - Development Startup Script
# This script starts both backend and frontend servers simultaneously

echo "🚀 Starting Trading Alerts Tool Development Environment..."
echo "📊 Backend: http://localhost:3001"
echo "🌐 Frontend: http://localhost:5173"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down servers..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Start backend server in background
echo "🔧 Starting backend server..."
npm start &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Start frontend server in background
echo "🎨 Starting frontend server..."
cd client && npm run dev &
FRONTEND_PID=$!

# Go back to root directory
cd ..

echo ""
echo "✅ Both servers are starting up..."
echo "📈 Backend API: http://localhost:3001/api/health"
echo "🎯 Frontend UI: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID































