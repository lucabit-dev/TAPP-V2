# Manual Sell StopLimit Loop Fix

## Issue Found

After manually selling a stock, the program was still sending StopLimit orders for that stock periodically.

## Root Causes

### 1. **CRITICAL: Stale Buy Orders Not Cleaned Up**
   - **Location**: `pendingManualBuyOrders` map
   - **Problem**: 
     - When a position is manually sold, `pendingManualBuyOrders` was not cleaned up
     - Old buy orders remained in the map
     - When WebSocket sent delayed FLL updates for these old orders, they triggered `handleManualBuyFilled`
     - This caused StopLimit orders to be created even though the position was sold
   - **Impact**: StopLimit orders created periodically for sold positions

### 2. **No Position Check in WebSocket Handler**
   - **Location**: Orders WebSocket handler (line ~3245)
   - **Problem**: 
     - When a buy order gets FLL status, the handler immediately calls `handleManualBuyFilled`
     - No check if position still exists before processing
     - If position was sold, it would still try to create StopLimit
   - **Impact**: StopLimit creation attempted even when position doesn't exist

### 3. **No Stale Order Detection**
   - **Location**: `handleManualBuyFilled` function
   - **Problem**: 
     - No timestamp tracking for buy orders
     - No validation to check if order is stale (from before manual sell)
     - Old orders could trigger StopLimit creation days later
   - **Impact**: Very old buy orders could trigger StopLimit creation

## Fixes Applied

### Fix 1: Clean Up pendingManualBuyOrders When Position Closes
```javascript
// In positions WebSocket handler when position closes:
// CRITICAL: Clean up any stale pendingManualBuyOrders for this symbol
let cleanedBuyOrders = 0;
for (const [buyOrderId, buyData] of pendingManualBuyOrders.entries()) {
  if (buyData && buyData.symbol && buyData.symbol.toUpperCase() === normalizedSymbol) {
    console.log(`🧹 Cleaning up stale pending buy order ${buyOrderId}`);
    pendingManualBuyOrders.delete(buyOrderId);
    stopLimitCreationInProgress.delete(buyOrderId);
    cleanedBuyOrders++;
  }
}
```

### Fix 2: Clean Up pendingManualBuyOrders After Manual Sell
```javascript
// In /api/sell endpoint after manual sell:
// CRITICAL: Clean up any stale pendingManualBuyOrders for this symbol
let cleanedBuyOrders = 0;
for (const [buyOrderId, buyData] of pendingManualBuyOrders.entries()) {
  if (buyData && buyData.symbol && buyData.symbol.toUpperCase() === normalizedSymbol) {
    console.log(`🧹 Cleaning up stale pending buy order ${buyOrderId} after manual sell`);
    pendingManualBuyOrders.delete(buyOrderId);
    stopLimitCreationInProgress.delete(buyOrderId);
    cleanedBuyOrders++;
  }
}
```

### Fix 3: Add Timestamp to Buy Orders
```javascript
// When tracking buy order:
pendingManualBuyOrders.set(oid, { 
  symbol, 
  quantity, 
  limitPrice: currentPrice,
  timestamp: Date.now() // Track when order was placed
});
```

### Fix 4: Validate Order in handleManualBuyFilled
```javascript
// At start of handleManualBuyFilled:
// CRITICAL: Verify this order is still in pendingManualBuyOrders
const pendingBuyData = pendingManualBuyOrders.get(orderId);
if (!pendingBuyData) {
  console.warn(`Order not found in pendingManualBuyOrders - may have been cleaned up after manual sell`);
  return; // Abort
}

// CRITICAL: Check if this is a stale order (older than 5 minutes)
if (pendingBuyData.timestamp) {
  const orderAge = Date.now() - pendingBuyData.timestamp;
  const MAX_ORDER_AGE = 5 * 60 * 1000; // 5 minutes
  if (orderAge > MAX_ORDER_AGE) {
    console.warn(`Order is stale (${orderAge}s old) - may be from before manual sell`);
    pendingManualBuyOrders.delete(orderId);
    return; // Abort
  }
}
```

### Fix 5: Position Check in WebSocket Handler
```javascript
// In orders WebSocket handler before calling handleManualBuyFilled:
// CRITICAL: Check if position still exists before processing
const normalizedSymbol = (symbol || '').toUpperCase();
const position = positionsCache.get(normalizedSymbol);
const hasPosition = position && parseFloat(position.Quantity || '0') > 0;

if (!hasPosition) {
  console.warn(`Order ${orderId} filled but position no longer exists - may have been manually sold`);
  // Clean up stale order and abort
  pendingManualBuyOrders.delete(orderId);
  stopLimitCreationInProgress.delete(orderId);
  return;
}
```

## Test Scenario: Manual Sell → StopLimit Loop

### Flow:
1. **Buy stock** → Order tracked in `pendingManualBuyOrders`
2. **Buy fills** → StopLimit created
3. **Manual sell** → Position removed, StopLimit cancelled
4. **Stale buy order cleanup** → `pendingManualBuyOrders` cleaned up ✅
5. **Delayed FLL update** → WebSocket sends FLL for old buy order
6. **Position check** → Position doesn't exist, abort ✅
7. **Order validation** → Order not in `pendingManualBuyOrders`, abort ✅
8. **Result**: ✅ No StopLimit created

### Before Fix:
- ❌ Stale buy orders remained in `pendingManualBuyOrders`
- ❌ No position check before processing
- ❌ No stale order detection
- ❌ StopLimit created periodically for sold positions

### After Fix:
- ✅ `pendingManualBuyOrders` cleaned up when position closes
- ✅ `pendingManualBuyOrders` cleaned up after manual sell
- ✅ Position check before processing FLL orders
- ✅ Stale order detection (5 minute timeout)
- ✅ Order validation in `handleManualBuyFilled`
- ✅ No StopLimit created for sold positions

## All Locations Fixed

1. **Position close cleanup** (line ~3040): Cleans up `pendingManualBuyOrders` for closed positions
2. **Manual sell cleanup** (line ~5680): Cleans up `pendingManualBuyOrders` after manual sell
3. **Buy order tracking** (line ~3490): Adds timestamp to track order age
4. **handleManualBuyFilled validation** (line ~4260): Validates order exists and is not stale
5. **WebSocket handler position check** (line ~3245): Checks position exists before processing

## Benefits

1. **Complete Cleanup**: All stale buy orders removed when position is sold
2. **Multiple Safety Nets**: Position check, order validation, and stale detection
3. **Timestamp Tracking**: Detects and prevents very old orders from triggering StopLimit
4. **Defensive Programming**: Multiple layers prevent StopLimit creation for sold positions

## Conclusion

The fix ensures that:
- ✅ Stale buy orders are cleaned up when position is sold
- ✅ Position existence is verified before processing
- ✅ Old orders (older than 5 minutes) are rejected
- ✅ Multiple validation layers prevent StopLimit creation for sold positions

The system now correctly prevents StopLimit orders from being created for manually sold stocks, even if delayed WebSocket updates arrive.
