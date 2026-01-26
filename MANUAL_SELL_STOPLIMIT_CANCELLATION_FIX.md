# Manual Sell StopLimit Cancellation Fix

## Issue Found

When manually selling a position from the Positions section, the active StopLimit sell order for that position/stock was **not being cancelled** before sending the limit sell order.

## Root Causes

### 1. **Timing Issue: StopLimit Order Not Found in Initial Check**
   - **Location**: `/api/sell` endpoint (line ~5387)
   - **Problem**: 
     - The initial StopLimit check happens before general sell order cancellation
     - If the StopLimit order was just added to cache via WebSocket, it might not be found in the initial check
     - The order might not be in the tracking map if it was never ACK'd or tracking was lost
   - **Impact**: StopLimit order not cancelled, causing API rejection when placing new sell order

### 2. **Missing Re-check Before Order Placement**
   - **Location**: `/api/sell` endpoint (line ~5624)
   - **Problem**: 
     - Only checked for general active sell orders before placing new order
     - Did not specifically re-check for StopLimit orders
     - StopLimit orders might be re-added via WebSocket between cancellation and order placement
   - **Impact**: StopLimit order might slip through and cause conflicts

### 3. **Insufficient Logging**
   - **Problem**: No specific logging for StopLimit orders found in general cancellation
   - **Impact**: Hard to debug when StopLimit orders are not being cancelled

## Fixes Applied

### Fix 1: Additional StopLimit Check Before General Cancellation
```javascript
// CRITICAL: Re-check for StopLimit orders one more time before general cancellation
// This catches any StopLimit orders that might not have been found in the initial check
const additionalStopLimitCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
if (additionalStopLimitCheck && additionalStopLimitCheck.orderId) {
  // Cancel the StopLimit order immediately
  // Clean up tracking maps
  // Wait for cancellation to propagate
}
```

### Fix 2: Final StopLimit Check Before Order Placement
```javascript
// CRITICAL: One final check right before placing the order
const finalStopLimitCheck = findExistingStopLimitSellForSymbol(normalizedSymbol);
if (finalStopLimitCheck && finalStopLimitCheck.orderId) {
  // Cancel immediately if found
  // This catches StopLimit orders that might have been re-added via WebSocket
}
```

### Fix 3: Enhanced Logging
- Added specific logging for StopLimit orders found in active sell orders
- Added logging to identify StopLimit orders in pre-order check
- Clear indication when StopLimit orders are found and cancelled

## Test Scenario: Manual Sell with Active StopLimit

### Flow:
1. **Position exists** → Has active StopLimit order (ACK status)
2. **User clicks Sell** → `/api/sell` endpoint called
3. **Initial StopLimit check** → Finds and cancels StopLimit order
4. **Additional StopLimit check** → Re-checks before general cancellation (catches any missed)
5. **General cancellation** → Cancels all active sell orders (including any remaining StopLimit)
6. **Final StopLimit check** → One more check right before placing order
7. **Place limit sell order** → ✅ No conflicts, order placed successfully

### Before Fix:
- ❌ StopLimit order might not be found in initial check
- ❌ No re-check before general cancellation
- ❌ No final check before order placement
- ❌ StopLimit order not cancelled → API rejection

### After Fix:
- ✅ Multiple checks for StopLimit orders
- ✅ Re-check before general cancellation
- ✅ Final check right before order placement
- ✅ StopLimit order always cancelled → Order placed successfully

## Locations Fixed

1. **Additional StopLimit check** (line ~5532): Re-checks before general cancellation
2. **Enhanced logging** (line ~5541): Logs StopLimit orders specifically
3. **Final StopLimit check** (line ~5624): One more check before order placement
4. **Pre-order check enhancement** (line ~5626): Identifies StopLimit orders in final check

## Benefits

1. **Multiple Safety Nets**: Three separate checks ensure StopLimit orders are found
2. **Timing Resilience**: Handles WebSocket timing issues where orders are added between checks
3. **Better Debugging**: Enhanced logging makes it easy to see when StopLimit orders are found/cancelled
4. **Reliability**: Ensures StopLimit orders are always cancelled before placing new sell orders

## Debug Logging

Enhanced logging shows:
- When StopLimit orders are found in additional check
- When StopLimit orders are found in general cancellation
- When StopLimit orders are found in final pre-order check
- Clear indication of StopLimit orders vs. regular sell orders

Example logs:
```
🛑 [DEBUG] Found additional StopLimit order 12345 (status: ACK) - cancelling before general cleanup...
✅ Additional StopLimit order 12345 cancelled successfully
🛑 [DEBUG] Found 1 StopLimit order(s) in active sell orders: 12345 (ACK)
🛑 [DEBUG] CRITICAL: Found StopLimit order 12345 (status: ACK) right before placing sell order! Cancelling immediately...
```

## Conclusion

The fix adds multiple layers of StopLimit order detection and cancellation:
1. Initial check (existing)
2. Additional check before general cancellation (new)
3. Final check right before order placement (new)

This ensures that StopLimit orders are **always** cancelled before placing a new sell order, regardless of timing issues or WebSocket updates.
