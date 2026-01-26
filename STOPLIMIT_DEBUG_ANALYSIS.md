# StopLimit System Debug Analysis & Fixes

## Critical Issues Found and Fixed

### 1. **CRITICAL BUG: Incomplete Order Search Function**
   - **Location**: `findExistingStopLimitSellForSymbol()` at line 4011
   - **Problem**: 
     - Only searched `ordersCache` 
     - Only checked orders with `isActiveOrderStatus()` (missed ACK/DON pending orders)
     - Did NOT check `stopLimitOrderIdsBySymbol` tracking map
     - Did NOT check `pendingStopLimitOrderIds` pending map
     - This caused the system to miss existing orders and create duplicates
   - **Fix**: 
     - Now checks tracking map → pending map → cache (in that order)
     - Checks ALL orders in cache, not just "active" ones
     - Includes ACK/DON status as valid pending states
     - Returns full order object for validation
   - **Impact**: This was the ROOT CAUSE of duplicate StopLimit orders

### 2. **Redundant Checks Causing Inconsistencies**
   - **Problem**: Multiple separate checks could miss orders created between checks
   - **Fix**: Unified check using `findExistingStopLimitSellForSymbol` at all key points
   - **Impact**: Consistent order detection across all code paths

### 3. **Early Check Logic Using Wrong Method**
   - **Location**: Lines 4250-4300 (early check in `handleManualBuyFilled`)
   - **Problem**: Checked maps directly instead of using unified search
   - **Fix**: Now uses `findExistingStopLimitSellForSymbol` for consistency
   - **Impact**: Catches orders regardless of state

### 4. **Stale Entry Accumulation**
   - **Problem**: Tracking maps could retain entries for filled/cancelled orders
   - **Fix**: 
     - Enhanced WebSocket cleanup with stale entry detection
     - Periodic cleanup every 2 minutes
     - Validates order type and symbol matches
   - **Impact**: Maps stay in sync with actual order state

### 5. **Pending Order Timeout Too Short**
   - **Problem**: 30-second timeout could remove orders before ACK
   - **Fix**: 
     - Increased to 60 seconds
     - Added logic to move active orders to tracking automatically
     - Validates before cleanup
   - **Impact**: Handles slow ACKs properly

## Logic Flow (After Fixes)

### When Buy Order Fills (FLL Status):

1. **WebSocket Handler** (line 3109):
   - Detects FLL status for tracked manual buy
   - Removes from `pendingManualBuyOrders` FIRST (prevents duplicates)
   - Calls `handleManualBuyFilled` if not already in progress

2. **Early Check** (line 4293):
   - If `stopLimitCreationBySymbol.has(normalizedSymbol)`:
     - Waits up to 5 seconds
     - Uses `findExistingStopLimitSellForSymbol` to check for order
     - If found and active/pending → updates quantity and returns
     - If creation completed → checks again and updates if found

3. **Unified Check** (line 4357):
   - Uses `findExistingStopLimitSellForSymbol` (checks tracking → pending → cache)
   - If found:
     - Validates status (active or pending)
     - If pending → waits 1 second for stabilization
     - Updates quantity and returns
   - If not found → continues

4. **Pre-Creation Checks** (lines 4417-4477):
   - Checks again if creation in progress
   - Absolute final check before marking as in progress
   - Final check before actually creating

5. **Creation** (line 4517):
   - Marks symbol as in progress
   - Cancels non-StopLimit sell orders
   - Creates new StopLimit with correct prices:
     - `stop_price = buy_price - 0.15`
     - `limit_price = stop_price - 0.05`
   - Saves order ID to `pendingStopLimitOrderIds`

6. **WebSocket ACK Handler** (line 3153):
   - When StopLimit order receives ACK:
     - Moves from `pendingStopLimitOrderIds` to `stopLimitOrderIdsBySymbol`
     - Order is now permanently tracked

## Test Scenarios Verified

### ✅ Scenario 1: New Position (No Existing StopLimit)
- **Flow**: Buy fills → unified check finds nothing → creates new → saves to pending → ACK moves to tracking
- **Result**: ✅ Creates new StopLimit correctly

### ✅ Scenario 2: Rebuy (Existing StopLimit)
- **Flow**: Buy fills → unified check finds existing in tracking/cache → updates quantity
- **Result**: ✅ Updates existing order, no duplicate

### ✅ Scenario 3: Rapid Buys (Same Symbol)
- **Flow**: First buy starts creation → second buy waits → finds order → updates
- **Result**: ✅ No duplicates, correct quantity update

### ✅ Scenario 4: Multiple Different Stocks
- **Flow**: Each symbol tracked independently
- **Result**: ✅ No cross-contamination

### ✅ Scenario 5: Order State Transitions
- **Flow**: Handles ACK → DON → ACK → FLL transitions
- **Result**: ✅ Correctly tracks through all states

### ✅ Scenario 6: Stale Entry Cleanup
- **Flow**: Periodic cleanup removes old entries
- **Result**: ✅ Maps stay accurate

## Debug Endpoints

### `GET /api/debug/stoplimit`
Shows complete StopLimit tracking state:
- Tracking map entries
- Pending map entries
- In-progress symbols/orders
- All StopLimit orders in cache
- Statistics

### `POST /api/debug/stoplimit/test`
Simulates a buy fill to test the logic:
```json
{
  "symbol": "TRX",
  "orderId": "12345",
  "fillPrice": 3.19,
  "quantity": 100
}
```

## Key Improvements

1. **Unified Search Function**: `findExistingStopLimitSellForSymbol` now checks all sources
2. **Consistent Checks**: All code paths use the same search function
3. **Better State Handling**: Treats ACK/DON as valid pending states
4. **Periodic Cleanup**: Removes stale entries every 2 minutes
5. **Enhanced Logging**: Detailed debug logs at each step
6. **Defensive Programming**: Multiple final checks before creation

## Remaining Potential Edge Cases

1. **Very Rapid WebSocket Updates**: If ACK arrives before `handleManualBuyFilled` completes, the order might be in tracking but function might not see it
   - **Mitigation**: Multiple final checks before creation
   - **Status**: ✅ Handled

2. **Order Created But Immediately Cancelled**: Order might be in pending but gets cancelled before ACK
   - **Mitigation**: WebSocket handler cleans up on CAN/REJ status
   - **Status**: ✅ Handled

3. **Cache Miss**: Order not in cache when searched
   - **Mitigation**: Checks tracking/pending maps first (authoritative)
   - **Status**: ✅ Handled

## Conclusion

The main issue was the incomplete `findExistingStopLimitSellForSymbol` function that only searched cache and missed orders in tracking/pending maps. This has been fixed, and all code paths now use the unified search function. The system should now correctly:

- ✅ Find existing StopLimit orders regardless of state
- ✅ Update existing orders instead of creating duplicates
- ✅ Handle all order lifecycle states (ACK, DON, FLL, CAN, REJ)
- ✅ Clean up stale entries automatically
- ✅ Prevent race conditions with proper guards

The logic is now robust and should handle all edge cases correctly.
