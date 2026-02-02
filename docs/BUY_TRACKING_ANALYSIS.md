# Buy Tracking & StopLimit Creation - Diagnostic Guide

## Why Some Buys Don't Get StopLimit Orders

Based on code analysis, buys can fail to trigger StopLimit creation for these reasons:

### 1. **Order Not Tracked** (Most Common)

When the Sections Bot API response does **not** include `order_id` (or uses a different key), the order is not added to `pendingManualBuyOrders`. When the FLL (filled) message arrives via WebSocket, it goes to the **FALLBACK** path instead of the main tracked path.

**Causes:**
- API returns `orderId` or `OrderID` but we only check `order_id`, `OrderID`, `orderId` (we do check all three)
- API returns non-2xx status (e.g. 202) - we now accept any 2xx
- API returns empty or malformed JSON
- Network error before response is parsed

**New diagnostic log:** `📋 [TRACKING] Sections Bot response keys: [...] | order_id: X | status: Y`

### 2. **FALLBACK Path Skips**

When an untracked order fills, FALLBACK handles it. But FALLBACK can skip if:

| Condition | Log to look for |
|-----------|-----------------|
| Reconnect window + no position after 2s | `⏭️ [FALLBACK] Reconnect window: skipping new stop-limit for X` |
| Order type not LIMIT/LMT | `⏭️ [FALLBACK] Skipping filled BUY X - order type "Y" is not Limit` |
| No position after 5s | `⚠️ [FALLBACK] No position found for X after 5s` |
| Invalid data (qty=0, price=0) | `⚠️ [FALLBACK] Invalid order data for X` |

### 3. **Tracked Path Early Returns**

When an order IS tracked, it can still skip StopLimit creation if:

| Condition | Log to look for |
|-----------|-----------------|
| StopLimit already exists (rebuy) | `✅ [DEBUG] StopLimit already exists for X` |
| StopLimit was recently filled | `⚠️ [DEBUG] Symbol X had StopLimit filled previously` |
| Symbol recently sold | `⚠️ [DEBUG] Symbol X was recently sold` |
| No position after 5s | `⚠️ [DEBUG] handleManualBuyFilled: No position for X` |
| Duplicate FLL (already processed) | `⏭️ [DEBUG] Order X already processed for FLL` |

---

## How to Run the 10-Minute Test

### Prerequisites
- Server running: `npm start`
- MongoDB connected (check `/api/health` for `db: "connected"`)

### Step 1: Start server with log visibility
```bash
cd TAPP-V2
npm start 2>&1 | tee logs/buy-tracking-test.log
```

### Step 2: In another terminal, run test buys
```bash
# Single symbol
npm run test-buy-tracking AAPL

# Multiple symbols
./scripts/run-buy-tracking-test.sh AAPL PLTR UAMY
```

### Step 3: Watch for these log patterns

**When a buy is placed:**
```
📤 Sending buy order: 500 AAPL at LIMIT price 225.50
✅ Buy order sent for AAPL: 200 OK
📋 [TRACKING] Sections Bot response keys: [order_id, status, ...] | order_id: 933332643 | status: 200 OK
📌 [DEBUG] Tracking manual buy order 933332643 for AAPL (qty 500, limitPrice 225.5)
```

**If NOT tracked:**
```
⚠️ [DEBUG] Buy order sent for AAPL but no order_id in response. Response: {...}
```
or
```
📋 [TRACKING] Sections Bot response keys: [...] | order_id: MISSING | status: ...
```

**When FLL arrives (tracked):**
```
🔍 [DEBUG] Order update for TRACKED manual buy: 933332643 (AAPL, Status: FLL)
🚀 [DEBUG] Triggering StopLimit creation/modification for filled manual buy 933332643 (AAPL)
🔍 [DEBUG] handleManualBuyFilled started for AAPL (order 933332643)
🔍 [DEBUG] Starting unified check for existing StopLimit for AAPL...
```

**When FLL arrives (untracked - FALLBACK):**
```
📥 [FALLBACK] Filled BUY 933332643 (AAPL) not in pendingManualBuyOrders - attempting stop-limit creation
🔄 [FALLBACK] Detected untracked filled BUY order 933332643 for AAPL - attempting stop-limit creation
🚀 [FALLBACK] Creating stop-limit for untracked buy order 933332643 (AAPL)
🔍 [DEBUG] handleManualBuyFilled started for AAPL (order 933332643)
```

---

## Quick Checklist for UAMY/PLAG-like Failures

1. **Check API response format** – Look for `📋 [TRACKING]` right after each buy. If `order_id: MISSING`, the Sections Bot API format may have changed.

2. **Check if FLL was received** – Search logs for the order ID (e.g. `933332643`). If no FLL handling logs, the Orders WebSocket may not have delivered it.

3. **Check FALLBACK vs tracked** – If you see `📥 [FALLBACK]` for the symbol, it wasn't tracked. Trace back to why (no order_id in buy response).

4. **Check reconnect window** – If Orders WebSocket reconnected in the last 30 seconds before the fill, FALLBACK may skip. Look for `ordersReconnectWindowUntil` in logs.

5. **Check position timing** – FLL can arrive before Positions WebSocket updates. We wait up to 5s. If position still missing, we skip.

---

## Fixes Already Applied

- ✅ Track orders with any 2xx status (not just 200/201)
- ✅ FALLBACK: Don't skip during reconnect window if position exists (with 2s wait)
- ✅ FALLBACK: Accept empty/unknown OrderType as Limit
- ✅ Fixed `quantity` undefined bug in handleManualBuyFilled stuck-guard path
- ✅ Added diagnostic logging throughout the flow
