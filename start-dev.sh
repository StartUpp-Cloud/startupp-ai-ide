#!/bin/bash

# StartUpp AI IDE Development Startup Script
# This script starts both frontend and backend for development

echo "🚀 Starting StartUpp AI IDE in Development Mode..."

# Install dependencies if needed
echo "📦 Installing dependencies..."
npm run install:all

# Fix node-pty permissions (macOS can strip execute bit from prebuilt binaries)
echo "🔧 Fixing node-pty permissions..."
bash scripts/fix-pty-permissions.sh

# Start the backend server with PM2
echo "🔧 Starting backend server on port 55590..."
pm2 start ecosystem.config.cjs

# Wait a moment for backend to start
sleep 2

# Start the frontend development server
echo "🎨 Starting frontend development server on port 5173..."
cd src/client && npm run dev &

# Wait a moment for frontend to start
sleep 3

echo ""
echo "✅ Development environment started successfully!"
echo ""
echo "🌐 Backend API: http://localhost:55590"
echo "📱 API Health: http://localhost:55590/api/health"
echo "🎨 Frontend: http://localhost:5173"
echo ""
echo "🔍 Useful commands:"
echo "   pm2 status                    - Check backend status"
echo "   pm2 logs                      - View backend logs"
echo "   pm2 restart ecosystem.config.cjs - Restart backend"
echo "   pm2 stop ecosystem.config.cjs    - Stop backend"
echo ""
echo "📝 To stop development:"
echo "   pm2 stop ecosystem.config.cjs    - Stop backend"
echo "   pkill -f 'vite'                 - Stop frontend"
echo ""
echo "🎉 Happy coding!"
