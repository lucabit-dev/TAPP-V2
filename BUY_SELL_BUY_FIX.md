# Buy → Sell → Buy StopLimit Creation Fix

## Issue Found

After buying a position, selling it manually, and then buying it again, a StopLimit order was **not being created** for the new buy.

## Root Causes

### 1. **CRITICAL: Position Check Too Strict (Race Condition)**
   - **Location**: `handleManualBuyFilled` function (line ~4286)
   - **Problem**: 
     - When a buy order fills (FLL status), the orders WebSocket handler immediately calls `handleManualBuyFilled`
     - However, the positions WebSocket handler might not have updated `positionsCache` yet
     - The position check was too strict - it would abort StopLimit creation if position wasn't in cache immediately
     - This is a race condition between orders WebSocket and positions WebSocket
   - **Impact**: StopLimit not created for valid new positions after a sell
   - **Fix**: Added retry/wait mechanism:
     - Waits up to 3 seconds (6 checks × 500ms) for position to appear in cache
     - Only aborts if position still doesn't exist after waiting
     - This handles the WebSocket timing difference

### 2. **Bug: Variable Name Mismatch in Position Close Cleanup**
   - **Location**: Positions WebSocket handler (line ~3022)
   - **Problem**: 
     - When position closes, cleanup code used `normalizedSymbol` but variable was `symbol`
     - This caused cleanup to fail silently (undefined variable)
   - **Impact**: StopLimit tracking might not be cleaned up properly when position closes
   - **Fix**: Added `const normalizedSymbol = symbol.toUpperCase()` before cleanup

### 3. **Missing Debug Logging**
   - **Problem**: No visibility into position cache updates
   - **Fix**: Added debug logging when position is added/updated in cache

## Fixes Applied

### Fix 1: Position Check with Retry
```javascript
// Before: Immediate check, abort if not found
if (!hasExistingPosition) {
  return; // Too strict!
}

// After: Wait for position to appear (handles WebSocket timing)
if (!hasExistingPosition) {
  console.log(`⏳ Position not found immediately. Waiting for positions WebSocket update...`);
  for (let i = 0; i < 6; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    existingPosition = positionsCache.get(normalizedSymbol);
    hasExistingPosition = existingPosition && parseFloat(existingPosition.Quantity || '0') > 0;
    if (hasExistingPosition) {
      console.log(`✅ Position found after ${(i + 1) * 500}ms wait`);
      break;
    }
  }
}

// Only abort if still not found after waiting
if (!hasExistingPosition) {
  console.warn(`⚠️ No position found after waiting - likely sold`);
  return;
}
```

### Fix 2: Variable Name Fix
```javascript
// Before: Used undefined variable
const stopLimitOrderId = stopLimitOrderIdsBySymbol.get(normalizedSymbol); // normalizedSymbol undefined!

// After: Normalize symbol first
const normalizedSymbol = symbol.toUpperCase();
const stopLimitOrderId = stopLimitOrderIdsBySymbol.get(normalizedSymbol);
```

### Fix 3: Enhanced Debug Logging
```javascript
// Added logging when position is added to cache
console.log(`🔍 [DEBUG] Position exists in cache for ${symbol}: Quantity=${quantity}, AveragePrice=${dataObj.AveragePrice || 'N/A'}`);
```

## Test Scenario: Buy → Sell → Buy

### Flow:
1. **Buy stock** → Order tracked in `pendingManualBuyOrders`
2. **Buy fills (FLL)** → WebSocket handler calls `handleManualBuyFilled`
3. **Position appears in cache** (via positions WebSocket) → May lag behind orders WebSocket
4. **StopLimit created** → Now waits for position if not found immediately
5. **Manual sell** → Position removed from cache, StopLimit cancelled and cleaned up
6. **Buy again** → Order tracked, fills, position check waits if needed
7. **StopLimit created** → ✅ Now works correctly!

### Before Fix:
- ❌ Position check too strict → Aborted StopLimit creation
- ❌ No retry mechanism → Failed if position not in cache immediately
- ❌ Variable bug → Cleanup might fail silently

### After Fix:
- ✅ Position check with retry → Waits for position to appear
- ✅ Handles WebSocket timing → Works even if positions WebSocket lags
- ✅ Variable fixed → Cleanup works correctly
- ✅ Enhanced logging → Better visibility into position cache updates

## Debug Endpoints

### `POST /api/debug/stoplimit/test-buy-sell-buy`
Tests the buy → sell → buy scenario and shows cleanup state.

### Enhanced Logging
- Position cache updates now logged with quantity and average price
- Position check retry attempts logged with timing
- Clear indication when position found after wait

## Conclusion

The main issue was a race condition between orders WebSocket and positions WebSocket. The fix adds a retry mechanism that waits up to 3 seconds for the position to appear in cache before aborting StopLimit creation. This ensures StopLimit orders are created correctly even when there's a timing difference between the two WebSocket streams.

The system now correctly handles:
- ✅ Buy → Sell → Buy scenarios
- ✅ WebSocket timing differences
- ✅ Position cache updates
- ✅ StopLimit creation after manual sell
