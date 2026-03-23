#!/bin/bash

# AI Prompt Maker PM2 Startup Script
# This script builds the frontend and starts the production server with PM2

echo "🚀 Starting AI Prompt Maker with PM2..."

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 is not installed. Installing PM2 globally..."
    npm install -g pm2
fi

# Install dependencies if needed
echo "📦 Installing dependencies..."
npm run install:all

# Build the frontend
echo "🔨 Building frontend..."
npm run build

# Check if build was successful
if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed. Please check the errors above."
    exit 1
fi

# Stop any existing PM2 processes
echo "🛑 Stopping existing PM2 processes..."
pm2 stop ai-prompt-maker-api 2>/dev/null || true
pm2 delete ai-prompt-maker-api 2>/dev/null || true

# Start the production API server only; it serves the built frontend itself.
echo "▶️  Starting production server with PM2..."
pm2 start ecosystem.config.cjs --only ai-prompt-maker-api --env production

# Check if PM2 start was successful
if [ $? -eq 0 ]; then
    echo "✅ Application started successfully with PM2!"
    echo ""
    echo "📊 PM2 Status:"
    pm2 status
    echo ""
    echo "🔍 Useful PM2 commands:"
    echo "   pm2 logs                    - View all logs"
    echo "   pm2 monit                   - Monitor processes"
    echo "   pm2 restart ai-prompt-maker-api  - Restart the app"
    echo "   pm2 stop ai-prompt-maker-api     - Stop the app"
    echo "   pm2 delete ai-prompt-maker-api   - Remove it from PM2"
    echo ""
    echo "🌐 Your app is now running with PM2:"
    echo "   App: http://localhost:55590"
    echo "   API health check: http://localhost:55590/api/health"
else
    echo "❌ Failed to start application with PM2."
    exit 1
fi
