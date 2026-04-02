#!/bin/bash
# Launch Chrome with remote debugging enabled for StartUpp AI IDE
# This allows the IDE to capture screenshots, console errors, and inspect DOM elements
#
# Usage:
#   ./scripts/launch-chrome-debug.sh          # default port 9222
#   ./scripts/launch-chrome-debug.sh 9333     # custom port

PORT=${1:-9222}

echo "Starting Chrome with remote debugging on port $PORT..."

# Detect Chrome binary
if command -v google-chrome &> /dev/null; then
  CHROME="google-chrome"
elif command -v google-chrome-stable &> /dev/null; then
  CHROME="google-chrome-stable"
elif command -v chromium-browser &> /dev/null; then
  CHROME="chromium-browser"
elif command -v chromium &> /dev/null; then
  CHROME="chromium"
elif [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif [ -f "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" ]; then
  CHROME="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
else
  echo "Error: Chrome not found."
  echo "Please install Google Chrome or Chromium, or set the CHROME_BIN environment variable."
  exit 1
fi

# Allow override via environment variable
if [ -n "$CHROME_BIN" ]; then
  CHROME="$CHROME_BIN"
fi

echo "Using browser: $CHROME"

# Check if debug port is already in use
if curl -s "http://localhost:$PORT/json/version" > /dev/null 2>&1; then
  echo ""
  echo "Chrome is already running with debug port $PORT"
  echo ""
  curl -s "http://localhost:$PORT/json/version" | python3 -m json.tool 2>/dev/null || \
    curl -s "http://localhost:$PORT/json/version"
  echo ""
  echo "Debug endpoint: http://localhost:$PORT"
  exit 0
fi

# Launch Chrome with remote debugging
"$CHROME" \
  --remote-debugging-port="$PORT" \
  --no-first-run \
  --no-default-browser-check \
  &

echo ""
echo "Chrome launched with PID $!"
echo "Debug endpoint: http://localhost:$PORT"
echo ""
echo "You can now use the Debug Element feature in StartUpp AI IDE."
echo "To verify: curl http://localhost:$PORT/json/version"
