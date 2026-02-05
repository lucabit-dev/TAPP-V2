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
| No position after 10s | `⚠️ [FALLBACK] No position found for X after 10s` |
| Invalid data (qty=0, price=0) | `⚠️ [FALLBACK] Invalid order data for X` |

### 3. **Tracked Path Early Returns**

When an order IS tracked, it can still skip StopLimit creation if:

| Condition | Log to look for |
|-----------|-----------------|
| StopLimit already exists (rebuy) | `✅ [DEBUG] StopLimit already exists for X` |
| StopLimit was recently filled | `⚠️ [DEBUG] Symbol X had StopLimit filled previously` |
| Symbol recently sold | `⚠️ [DEBUG] Symbol X was recently sold` |
| No position after 10s | `⚠️ [DEBUG] handleManualBuyFilled: No position for X` |
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

5. **Check position timing** – FLL can arrive before Positions WebSocket updates. We wait up to 10s. If position still missing, we skip. If you see "no position after 10s" but the position exists in the Positions WebSocket (client sees it), the server's Positions WS may use a different message format – we now support batch format and lowercase `symbol`.

---

## Fixes Already Applied

- ✅ Track orders with any 2xx status (not just 200/201)
- ✅ FALLBACK: During 30s reconnect window, **never create new StopLimits** – only update existing ones (prevents FUSE-style REJ burst)
- ✅ FALLBACK: Accept empty/unknown OrderType as Limit
- ✅ Fixed `quantity` undefined bug in handleManualBuyFilled stuck-guard path
- ✅ TRACKED path: 5s delay during reconnect window before create-check (lets StopLimit ACKs arrive first)
- ✅ **Orders WS watchdog**: 2 min idle + pending buys → force reconnect (was 10 min; COTY FLL missed after ~6 min uptime)
- ✅ **Proactive reconnect**: When adding a tracked buy, if Orders WS idle >2 min, reconnect immediately
- ✅ Added diagnostic logging throughout the flow

---

## StopLimit Stops Working After Program Active Time (e.g. COTY)

**Symptom:** Buy is sent, tracked, and fills – but no StopLimit is created. RR and TSLG work earlier in the session; COTY (or later buys) do not.

**Root cause:** The Orders WebSocket connection can go **silent** (half-open) after ~5–6 minutes of uptime. Cloud platforms (Railway, Vercel, etc.) often have idle timeouts. The connection appears open but stops delivering FLL messages.

**Evidence from logs (COTY):**
- 17:32:16 – Container starts, Orders WS connects, snapshot processed
- 17:33:56 – RR: buy sent → FLL received → StopLimit created ✓
- 17:34:23 – TSLG: buy sent → FLL received → StopLimit created ✓
- 17:38:23 – COTY: buy sent, tracked, manual buy logged ✓
- **No FLL for COTY in logs** – Orders WS likely silent by then

**Fixes applied:**
1. **Watchdog timeout** reduced from 10 min to **2 min** when there are pending buys.
2. **Proactive reconnect** when adding a tracked buy: if Orders WS has been idle >2 min, reconnect immediately so the new connection is ready before the fill.

---

## Symbols Not Being Analyzed/Tracked (e.g. GCTS)

If a symbol like **GCTS** is not appearing in alerts, toplist, or getting StopLimit creation after buys:

### 1. **Symbol must be in a ChartsWatcher source**

- **Alerts**: ChartsWatcher alerts config `68d2f1d1e0373f708e67d801` – symbols must be in this config’s scan list to receive alerts.
- **Toplist**: Symbols must be in one of the toplist configs (A–E or MANUAL `692117e2b7bb6ba7a6ae6f6c`) for momentum thresholds and group assignment.

If GCTS is not in any of these ChartsWatcher configs, it will not be analyzed or tracked automatically.

### 2. **Manual analysis**

You can still analyze any symbol manually:

```
GET /api/analyze/GCTS
```

If the symbol is not in the toplist, `meetsMomentum` will be `false` because no group thresholds exist for it.

### 3. **Add GCTS to MANUAL list**

To have GCTS analyzed and tracked:

1. Add GCTS to the MANUAL toplist (`692117e2b7bb6ba7a6ae6f6c`) in ChartsWatcher.
2. Or add GCTS to the alerts config scan list so it receives alerts.

### 4. **Buy tracking for GCTS**

Buy tracking is symbol-agnostic. If GCTS buys are not getting StopLimits:

- Check `📋 [TRACKING]` logs after placing a GCTS buy – if `order_id: MISSING`, the Sections Bot API format may have changed.
- If you see `📥 [FALLBACK]` for GCTS, the order was untracked; follow the FALLBACK checklist above.

---

## Zero Logs for a Symbol (e.g. GCTS)

If you get **no logs at all** for a symbol when buying:

### Possible causes

1. **Buy not placed through TAPP** – If you bought via the broker’s app or website instead of TAPP’s buy button, TAPP never receives the order. The Orders WebSocket only receives orders from the broker account connected to TAPP.

2. **Orders WebSocket not receiving the order** – The broker sends order updates to TAPP via the Orders WebSocket. If that connection is down or uses a different account, no orders will appear.

3. **Different message format** – Some broker messages may use a different structure (e.g. `order_id` instead of `OrderID`). These are now logged as `⚠️ [ORDERS] Order-like message without OrderID`.

### New diagnostic logs

- **`📥 [ORDERS] Order {id} | {SYMBOL} | {status} | BUY/SELL | tracked=true/false`** – Logged for every order received. If GCTS never appears here, the Orders WebSocket is not receiving GCTS orders.

- **`🛒 Manual buy signal for GCTS`** – Logged when a buy request reaches the server. If this never appears, the buy request is not reaching TAPP (e.g. client error or wrong endpoint).

---

## "No Position After 5s" But Position Exists in Positions WebSocket (e.g. IOVA)

**Symptom:** Logs say "No position for IOVA after 5s" (or 10s) but the position is visible in the Positions WebSocket (client sees it).

**Possible causes:**
1. **Message format** – PnL API may send positions with `symbol` (lowercase) or in a batch `{ positions: [...] }`. We now support both.
2. **Timing** – FLL can arrive before the Positions WS has processed its snapshot. Wait time increased from 5s to 10s.
3. **Separate connections** – The server has its own Positions WS connection (populates `positionsCache`). The client sees data from its proxy connection. Both connect to the same PnL API; if the server's connection is delayed or uses a different message format, the cache may be empty when we check.

**Fixes applied:**
- Positions WS handler: support `symbol` (lowercase) and batch format `{ positions: [...] }`
- Position wait: 10s instead of 5s in both handleManualBuyFilled and FALLBACK
- Fallback: when not found by key, iterate `positionsCache` for case-insensitive symbol match
- **Derive position from FLL**: When we receive a filled BUY order, immediately add/merge its quantity into `positionsCache` (handles MARA-style instant fills / adds-to-existing before Positions WS arrives)
- **Positions WS: QuantityDelta**: Support incremental updates (`QuantityDelta`, `QuantityChange`, `Delta`) – add to existing position for add-to-position scenarios

---

## Instant Fills / Adds to Existing Position (e.g. MARA)

**Symptom:** Stock like MARA is instantly filled (add to existing position), but position is "not found" and StopLimit creation is skipped.

**Root cause:** FLL (filled) arrives from Orders WS before Positions WS has sent its update. The position exists at the broker but isn't in `positionsCache` yet.

**Fix:** When we receive an FLL for a BUY, we **immediately add the order's quantity to positionsCache** (merge with existing if any). This ensures we have a position when we check, even if Positions WS is delayed. For adds-to-existing (MARA had 2 filled buys in the snapshot), each FLL adds its quantity – so we build up the correct total.

---

## Stop Limit Adjustment Stops Working After Some Time

**Symptom:** Stop Limit Adjustment (P&L-based step updates) works initially, then stops updating StopLimit orders after the app has been running for a while.

**Root cause:** The Stop Limit Adjustment depends entirely on the **Positions WebSocket** (server → Sections Bot). Every time a position update arrives, the server calls `checkStopLimitTracker`, which compares P&L to your configured steps and updates the StopLimit when a new step is reached.

If the Positions WebSocket connection goes **silent** (half-open), no position updates arrive → `checkStopLimitTracker` is never called → StopLimit orders are never updated.

**Why connections go silent:**
- **Cloud idle timeouts** – Railway, Vercel, and similar platforms often close idle connections after ~5–10 minutes.
- **Load balancers** – May drop connections that have had no traffic for a while.
- **Half-open state** – The TCP connection appears open (`readyState === OPEN`) but the broker/network has stopped delivering messages. No `close` or `error` event fires.

**Unlike the Orders WebSocket**, the Positions WebSocket had **no idle watchdog**. The Orders WS reconnects after 2 min of no activity when there are pending buys. The Positions WS only reconnected on explicit `close` or `error` – so a silent connection would never recover.

**Fix applied:**
- **Positions WS watchdog**: When we have positions with active StopLimits and the Positions WS has received no updates for 3 minutes, force a reconnect. This mirrors the Orders WS watchdog and recovers from silent drops.
