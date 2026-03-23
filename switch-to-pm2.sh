#!/bin/bash

# Switch to PM2 Management Script
# This script stops manual processes and starts PM2 management

echo "🔄 Switching to PM2 management mode..."

# Stop any manual frontend processes
echo "🛑 Stopping manual frontend processes..."
pkill -f "vite" 2>/dev/null || true

# Stop any manual backend processes
echo "🛑 Stopping manual backend processes..."
pkill -f "node.*src/server/index.js" 2>/dev/null || true

# Wait a moment for processes to stop
sleep 2

# Start both processes with PM2
echo "▶️  Starting both frontend and backend with PM2..."
pm2 start ecosystem.config.cjs

# Check status
echo ""
echo "📊 PM2 Status:"
pm2 status

echo ""
echo "✅ Successfully switched to PM2 management!"
echo "🌐 Your app is now running:"
echo "   🎨 Frontend: http://localhost:5173 (PM2 managed)"
echo "   🔧 Backend: http://localhost:55590 (PM2 managed)"
echo ""
echo "🔍 PM2 Commands:"
echo "   pm2 status                    - Check status"
echo "   pm2 logs                      - View logs"
echo "   pm2 monit                     - Monitor processes"
echo "   pm2 restart ecosystem.config.cjs - Restart both"
echo "   pm2 stop ecosystem.config.cjs    - Stop both"
