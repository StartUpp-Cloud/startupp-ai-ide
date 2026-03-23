#!/bin/bash

echo "🚀 Starting AI Prompt Maker..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp env.example .env
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    npm install
fi

if [ ! -d "src/client/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd src/client
    npm install
    cd ../..
fi

echo "🎯 Starting development servers..."
echo "   Backend: http://localhost:55590"
echo "   Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all servers"

# Start both servers
npm run dev
