# Order State Management Fix - Duplicate Order Prevention

## Problem
After redeploy/restart, the application was not detecting already-active SELL orders with status "Queued (DON)" and was sending duplicate SELL orders. The broker rejected these as "Rejected (REJ)" because a sell order was already active.

## Solution Overview
Implemented a comprehensive order state management system that:
1. **Persists active orders to MongoDB** - Orders survive redeploys/restarts
2. **Rehydrates state on startup** - Loads active orders from DB and reconciles with broker
3. **Idempotent order placement** - Checks for active orders before placing new ones
4. **Concurrency guards** - Prevents concurrent duplicate orders
5. **REJ handling** - Reconciles with broker when orders are rejected

## Architecture

### Components

#### 1. MongoDB Schema (`models/orderState.model.js`)
- **Collection**: `orderstates`
- **Key Fields**:
  - `brokerOrderId` (unique, indexed)
  - `symbol`, `side`, `statusNorm` (compound index)
  - `statusRaw` (broker status: DON, ACK, REJ, etc.)
  - `statusNorm` (normalized: ACTIVE or INACTIVE)
  - `source` (ws or rest_snapshot)

#### 2. OrderStateService (`services/orderStateService.js`)
Manages order state persistence and reconciliation:

**Key Methods**:
- `upsertOrder(order, source)` - Persists order to MongoDB and updates in-memory map
- `getActiveSell(symbol)` - Checks for active sell orders (in-memory → DB → broker REST)
- `reconcileSymbolOrders(symbol)` - Fetches orders from broker REST API and updates state
- `rehydrateActiveOrders()` - Loads active orders from DB on startup and reconciles
- `acquireOrderLock(symbol)` / `releaseOrderLock(symbol)` - Per-symbol mutex for concurrency

**Status Normalization**:
- **ACTIVE**: DON, QUE, ACK, REC, NEW, OPEN, PENDING, PARTIALLY_FILLED, WORKING
- **INACTIVE**: FILLED, CAN, EXP, REJECTED, OUT, CLOSED

#### 3. Integration Points

**server.js**:
- Initializes `OrderStateService` after DB connection
- Updates orders WebSocket handler to persist orders via `orderStateService.upsertOrder()`
- Rehydrates order state on WebSocket reconnect

**stopLimitV2Service.js**:
- `postOrder()` method now:
  1. Acquires per-symbol lock
  2. Checks for active sell order via `orderStateService.getActiveSell()`
  3. Skips order placement if active sell exists
  4. Handles REJ status by reconciling with broker
  5. Releases lock after order placement attempt

## Flow Diagrams

### Startup/Reconnect Flow
```
1. App starts / WebSocket reconnects
2. orderStateService.rehydrateActiveOrders()
   ├─ Load ACTIVE orders from MongoDB
   ├─ Build in-memory map: activeOrdersBySymbolSide[symbol][side]
   └─ Reconcile each symbol with broker REST API (if available)
3. Ready to prevent duplicates
```

### Order Placement Flow (SELL orders)
```
1. postOrder() called with SELL order
2. Acquire per-symbol lock
3. Check getActiveSell(symbol):
   ├─ Check in-memory map (fast)
   ├─ If miss, query MongoDB
   └─ If stale, reconcile with broker REST
4. If active sell exists:
   └─ SKIP order placement, return existing order info
5. If no active sell:
   ├─ Place order via broker API
   ├─ If REJ response:
   │  ├─ Reconcile with broker
   │  └─ Check again for active sell
   └─ Release lock
```

### WebSocket Order Update Flow
```
1. Order update received via WebSocket
2. Update ordersCache (existing behavior)
3. orderStateService.upsertOrder(order, 'ws')
   ├─ Extract order data
   ├─ Normalize status (ACTIVE/INACTIVE)
   ├─ Upsert to MongoDB
   └─ Update in-memory map
```

## Key Features

### 1. Idempotent Order Placement
Before placing ANY SELL order, the system:
- Checks in-memory map (fastest)
- Falls back to MongoDB query
- Reconciles with broker if data is stale (>30 seconds)
- Skips placement if active sell exists

### 2. Concurrency Protection
- Per-symbol mutex prevents concurrent duplicate orders
- Lock is acquired before check and released after placement attempt
- If lock acquisition fails, order placement continues (fail-open)

### 3. REJ Handling
When broker returns REJ:
- System reconciles with broker REST API (if available)
- Checks again for active sell order
- Returns existing order info if found
- Prevents retry loops

### 4. Graceful Degradation
- If `orderStateService` is not available, orders still work (no duplicate prevention)
- If broker REST endpoint doesn't exist (404), relies on WebSocket updates
- Errors in reconciliation don't block order placement

## Database Indexes

```javascript
// Compound index for efficient queries
{ symbol: 1, side: 1, statusNorm: 1 }

// Individual indexes
{ brokerOrderId: 1 } // unique
{ symbol: 1, side: 1 }
{ statusNorm: 1, side: 1 }
{ updatedAt: -1 }
```

## Configuration

No additional configuration required. The system uses:
- `PNL_API_KEY` (existing) - For broker API authentication
- MongoDB connection (existing) - For order state persistence

## Testing Recommendations

1. **Test duplicate prevention**:
   - Place a SELL order manually
   - Restart the application
   - Verify no duplicate order is created

2. **Test REJ handling**:
   - Place a SELL order that will be rejected
   - Verify reconciliation runs
   - Verify no retry loop occurs

3. **Test concurrency**:
   - Trigger multiple order placements simultaneously for same symbol
   - Verify only one order is placed

4. **Test rehydration**:
   - Place orders
   - Restart application
   - Verify orders are detected on startup

## Monitoring

Check logs for:
- `⏭️ SKIP duplicate sell` - Duplicate prevention working
- `🔄 Reconciling orders for {symbol}` - Reconciliation running
- `✅ Rehydrated {N} active orders from DB` - Startup rehydration
- `⚠️ Order rejected (REJ)` - REJ handling triggered

## Files Modified

1. `models/orderState.model.js` - NEW: MongoDB schema
2. `services/orderStateService.js` - NEW: Order state management service
3. `server.js` - Modified: Integrated OrderStateService, updated WebSocket handlers
4. `stopLimitV2Service.js` - Modified: Added idempotent checks and REJ handling to `postOrder()`

## Notes

- The system prioritizes WebSocket updates over REST API reconciliation
- REST API reconciliation is optional (gracefully handles 404)
- Order state is persisted in real-time via WebSocket updates
- In-memory map provides fast lookups, MongoDB provides persistence
