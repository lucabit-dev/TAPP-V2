# Rebuy StopLimit Quantity Update Fix

## Issue Found

When buying a stock that already has a position and an existing StopLimit order, the system was **not correctly updating the StopLimit quantity** to match the new total position quantity.

## Root Cause

### **CRITICAL: Incorrect Quantity Calculation**
   - **Location**: Multiple locations in `handleManualBuyFilled` function
   - **Problem**: 
     - The code was calculating new quantity as: `newQty = existingQty + quantity`
     - Where `existingQty` came from the StopLimit order's `QuantityRemaining` or `QuantityOrdered`
     - And `quantity` was the new buy quantity
     - **This is incorrect** because:
       1. The StopLimit order quantity might not match the actual position quantity
       2. If the position was partially sold, the order quantity would be wrong
       3. The order quantity might be stale or incorrect
   - **Impact**: StopLimit quantity didn't match actual position quantity after rebuy
   - **Fix**: Use actual position quantity from `positionsCache` instead of calculating from order quantity

## Fix Applied

### Before (Incorrect):
```javascript
const leg = existingOrder.Legs?.[0];
const existingQty = parseInt(leg?.QuantityRemaining || leg?.QuantityOrdered || '0', 10) || 0;
const newQty = existingQty + quantity; // ❌ Wrong calculation
await modifyOrderQuantity(existingOrderId, newQty);
```

### After (Correct):
```javascript
// CRITICAL: Use actual position quantity, not order quantity
const position = positionsCache.get(normalizedSymbol);
const positionQty = position ? parseFloat(position.Quantity || '0') : 0;
if (positionQty > 0) {
  console.log(`📊 [DEBUG] Updating StopLimit quantity to match position: ${positionQty} shares`);
  await modifyOrderQuantity(existingOrderId, positionQty); // ✅ Correct
}
```

## Locations Fixed

All instances where StopLimit quantity was updated have been fixed:

1. **Early check wait loop** (line ~4367)
2. **Creation completed check** (line ~4389)
3. **Final wait check** (line ~4412)
4. **Unified check - pending order** (line ~4458)
5. **Unified check - active order** (line ~4469)
6. **Wait check after creation in progress** (line ~4519)
7. **Race condition check** (line ~4542)
8. **Absolute final check** (line ~4585)
9. **Final check before creation** (line ~4642)

## Test Scenario: Rebuy with Existing StopLimit

### Flow:
1. **Initial buy** → Position: 100 shares, StopLimit: 100 shares
2. **Rebuy** → New buy: 50 shares
3. **Buy fills (FLL)** → Position: 150 shares (updated via WebSocket)
4. **StopLimit update** → Now uses position quantity: 150 shares ✅

### Before Fix:
- ❌ Calculated: `newQty = 100 + 50 = 150` (but if order was wrong, result would be wrong)
- ❌ Used order quantity which might be stale

### After Fix:
- ✅ Uses actual position quantity: `positionQty = 150` (from positionsCache)
- ✅ Always matches actual position, regardless of order state

## Benefits

1. **Accuracy**: StopLimit quantity always matches actual position quantity
2. **Reliability**: Works even if order quantity is stale or incorrect
3. **Handles Partial Sells**: If position was partially sold, StopLimit updates correctly
4. **Single Source of Truth**: Position cache is the authoritative source

## Debug Logging

Enhanced logging shows:
- Position quantity being used
- Order quantity (for comparison)
- Clear indication when position quantity is used vs. calculated

Example log:
```
📊 [DEBUG] Updating StopLimit quantity to match position: 150 shares (order currently has: 100)
```

## Conclusion

The fix ensures that when rebuying a stock with an existing StopLimit, the StopLimit quantity is updated to match the **actual position quantity** from the positions cache, not a calculated value based on the order quantity. This guarantees accuracy and handles all edge cases correctly.
