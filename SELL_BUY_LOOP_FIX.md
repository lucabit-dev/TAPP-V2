# Sell → Buy StopLimit Loop Fix

## Issue Found

After manually selling a stock and then buying it again:
1. First StopLimit order is sent correctly ✅
2. But then the program loops sending multiple StopLimit sell orders ❌

## Root Causes

### 1. **CRITICAL: Stale StopLimit Orders in Cache**
   - **Problem**: 
     - When a stock is manually sold, the StopLimit order is cancelled
     - The cancelled order (status: CAN, FIL, FLL) remains in `ordersCache`
     - When buying again, `findExistingStopLimitSellForSymbol` finds the cancelled order
     - System tries to update a cancelled order, fails, then creates a new one
     - But the old cancelled order is still there, causing confusion and loops
   - **Impact**: Multiple StopLimit orders created because system finds stale cancelled orders

### 2. **No "Recently Sold" Tracking**
   - **Problem**: 
     - No mechanism to track that a stock was recently sold
     - System doesn't know to wait before creating StopLimit for rebuys
     - Immediate rebuy after sell triggers StopLimit creation before cleanup completes
   - **Impact**: StopLimit created too quickly after sell, causing conflicts

### 3. **Incomplete Cleanup on Position Close**
   - **Problem**: 
     - Position close cleanup doesn't remove cancelled/filled StopLimit orders from cache
     - Stale orders remain in cache and are found by search functions
   - **Impact**: Stale orders cause false positives in StopLimit detection

### 4. **findExistingStopLimitSellForSymbol Returns Cancelled Orders**
   - **Problem**: 
     - Function checks tracking/pending maps first (which might have stale references)
     - Doesn't skip cancelled/filled orders in tracking/pending maps
     - Cache search doesn't filter out terminal statuses aggressively enough
   - **Impact**: Cancelled orders are returned as "existing" StopLimit orders

## Fixes Applied

### Fix 1: Recently Sold Tracking
```javascript
// NEW: Track recently sold symbols
const recentlySoldSymbols = new Map(); // Map<symbol, timestamp>

// When position closes or manual sell happens:
recentlySoldSymbols.set(normalizedSymbol, Date.now());

// In handleManualBuyFilled:
const recentlySoldTimestamp = recentlySoldSymbols.get(normalizedSymbol);
if (recentlySoldTimestamp && (Date.now() - recentlySoldTimestamp < 15000)) {
  // Skip StopLimit creation for 15 seconds after sell
  return;
}
```

### Fix 2: Skip Cancelled Orders in findExistingStopLimitSellForSymbol
```javascript
// In tracking map check:
const terminalStatuses = new Set(['CAN', 'FIL', 'FLL', 'EXP', 'REJ', ...]);
if (terminalStatuses.has(status)) {
  // Remove from tracking and cache, don't return
  stopLimitOrderIdsBySymbol.delete(normalized);
  ordersCache.delete(trackingOrderId);
  // Continue searching, don't return this order
}

// In cache search:
if (terminalStatuses.has(status)) {
  console.log(`⏭️ Skipping StopLimit order with terminal status ${status}`);
  continue; // Skip this order
}
```

### Fix 3: Clean Up Cancelled Orders on Position Close
```javascript
// When position closes:
// Clean up any cancelled/filled StopLimit orders in cache
for (const [orderId, cachedOrder] of ordersCache.entries()) {
  if (legSymbol === normalizedSymbol && legSide === 'SELL') {
    const cachedStatus = (cachedOrder.Status || '').toUpperCase();
    if (['CAN', 'FIL', 'FLL', 'EXP', 'REJ'].includes(cachedStatus)) {
      console.log(`🗑️ Removing stale StopLimit order ${orderId} from cache`);
      ordersCache.delete(orderId);
    }
  }
}
```

### Fix 4: Clean Up Cancelled Orders on Manual Sell
```javascript
// In /api/sell endpoint after cleanup:
// Clean up any cancelled/filled StopLimit orders in cache
for (const [orderId, cachedOrder] of ordersCache.entries()) {
  if (legSymbol === normalizedSymbol && legSide === 'SELL') {
    if (['CAN', 'FIL', 'FLL', 'EXP', 'REJ'].includes(cachedStatus)) {
      ordersCache.delete(orderId);
    }
  }
}
```

### Fix 5: Remove from Recently Sold When Position Created
```javascript
// When position is created (quantity > 0):
if (recentlySoldSymbols.has(normalizedSymbol)) {
  console.log(`✅ Position exists - removing from recently sold tracking (rebuy detected)`);
  recentlySoldSymbols.delete(normalizedSymbol);
}
```

### Fix 6: Periodic Cleanup of Recently Sold
```javascript
// In periodic cleanup (every 2 minutes):
const RECENTLY_SOLD_MAX_AGE = 30000; // 30 seconds
for (const [symbol, timestamp] of recentlySoldSymbols.entries()) {
  if (Date.now() - timestamp > RECENTLY_SOLD_MAX_AGE) {
    recentlySoldSymbols.delete(symbol);
  }
}
```

## Test Scenario: Sell → Buy

### Flow:
1. **Manual sell** → StopLimit cancelled, tracking cleaned up
2. **Recently sold tracking** → Symbol marked as recently sold (timestamp saved)
3. **Position closes** → Cancelled StopLimit orders removed from cache
4. **Buy again** → 
   - Check recently sold: If < 15 seconds, skip StopLimit creation
   - If > 15 seconds or position exists, remove from recently sold
   - Clean up any stale cancelled orders found
   - Create new StopLimit if no existing active order found
5. **Result**: ✅ Single StopLimit created, no loops

### Before Fix:
- ❌ Cancelled StopLimit orders remain in cache
- ❌ System finds cancelled orders and tries to update them
- ❌ Multiple StopLimit orders created in loop
- ❌ No protection against immediate rebuy after sell

### After Fix:
- ✅ Cancelled orders removed from cache on sell/position close
- ✅ Recently sold tracking prevents immediate StopLimit creation
- ✅ findExistingStopLimitSellForSymbol skips cancelled orders
- ✅ Single StopLimit created correctly

## Debug Endpoints

### `POST /api/debug/stoplimit/test-sell-buy`
Tests the sell → buy scenario:
```json
{
  "symbol": "TRX"
}
```

Returns:
- Before sell state
- After sell cleanup state
- Recently sold tracking status
- Whether creation would be blocked

### `GET /api/debug/stoplimit`
Now includes `recentlySoldMap` showing:
- Symbol
- Timestamp when sold
- Age (ms and seconds)

## Benefits

1. **Prevents Loops**: Recently sold tracking blocks StopLimit creation for 15 seconds after sell
2. **Clean Cache**: Cancelled orders removed from cache, preventing false positives
3. **Accurate Detection**: findExistingStopLimitSellForSymbol skips cancelled orders
4. **Automatic Cleanup**: Periodic cleanup removes old recently sold entries
5. **Rebuy Support**: Removes from recently sold when position is created (legitimate rebuy)

## Conclusion

The fix adds multiple layers of protection:
1. **Recently sold tracking** - Prevents immediate StopLimit creation after sell
2. **Cache cleanup** - Removes cancelled orders to prevent false positives
3. **Improved search** - Skips cancelled orders in all checks
4. **Automatic removal** - Removes from recently sold when position is created

The system now correctly handles sell → buy scenarios without creating duplicate StopLimit orders.
