#!/bin/bash
# Run buy tracking diagnostic - requires server to be running
# Usage: ./scripts/run-buy-tracking-test.sh [SYMBOL1] [SYMBOL2] ...
# Example: ./scripts/run-buy-tracking-test.sh AAPL PLTR UAMY

cd "$(dirname "$0")/.."
SYMBOLS=("${@:-AAPL}")

echo "=============================================="
echo "BUY TRACKING DIAGNOSTIC - 10 min test session"
echo "=============================================="
echo "1. Ensure server is running: npm start"
echo "2. This script will execute test buys and capture logs"
echo ""

# Check server
if ! curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
  echo "ERROR: Server not reachable at localhost:3001"
  echo "Start with: npm start"
  exit 1
fi

echo "Server OK. Executing test buys..."
echo ""

for sym in "${SYMBOLS[@]}"; do
  echo "--- Buy $sym ---"
  node scripts/test-buy-tracking.js "$sym"
  echo ""
  sleep 2
done

echo "=============================================="
echo "Check server logs for:"
echo "  📋 [TRACKING] - Response structure from Sections Bot"
echo "  📌 [DEBUG] Tracking manual buy - Order was TRACKED"
echo "  ⚠️ [DEBUG] Buy order sent but no order_id - Order NOT tracked"
echo "  📥 [FALLBACK] - Untracked order using fallback path"
echo "  🔍 [DEBUG] handleManualBuyFilled started - StopLimit creation flow"
echo "=============================================="
