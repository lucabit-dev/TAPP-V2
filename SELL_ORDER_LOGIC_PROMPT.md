# Sell Order Logic Implementation Prompt for Cursor AI

## Overview
Implement a sell order system that follows the same logic and patterns as the reference implementation. The system should handle individual position sells and panic sell-all operations, with proper order management to prevent duplicate sell orders.

## Core Requirements

### 1. Individual Sell Order Endpoint (`POST /api/sell`)

**Request Body:**
```json
{
  "symbol": "AAPL",           // Required, uppercase
  "quantity": 100,            // Required, positive integer
  "order_type": "Limit",      // Optional, default: "Limit". Valid values: "Limit", "Market", "StopLimit"
  "long_short": "Long"        // Required, "Long" or "Short"
}
```

**Logic Flow:**
1. **Validate Input:**
   - Symbol must be present and non-empty (normalize to uppercase)
   - Quantity must be a positive integer
   - Normalize `order_type` to valid values: "Limit", "Market", or "StopLimit" (case-insensitive, handle variations like "stop_limit", "stop-limit")

2. **Determine Order Side:**
   - For Long positions: `side = "SELL"` (to close long position)
   - For Short positions: `side = "BUY"` (to close short position by buying back)

3. **Delete Existing SELL Orders (Critical Step):**
   - **ONLY if `side === "SELL"`**, delete all existing SELL orders for this symbol BEFORE creating the new sell order
   - This ensures only one SELL order can be active per stock at a time
   - Use a helper function `deleteAllSellOrdersForSymbol(symbol)` that:
     - Finds all order IDs associated with this symbol (from buy list entries, stop-loss orders, or order tracking system)
     - Deletes each order sequentially using `DELETE /order/{order_id}` endpoint
     - Adds a 100ms delay between deletions to avoid rate limiting
     - Returns: `{ success: boolean, deleted: number, failed: number, results: array }`
   - After deletion, wait 200ms to ensure orders are fully cancelled before proceeding

4. **Build Order Request Body:**
   - **IMPORTANT:** Do NOT include a `price` parameter in the order body
   - Only include: `symbol`, `side`, `order_type`, `quantity`
   ```json
   {
     "symbol": "AAPL",
     "side": "SELL",
     "order_type": "Limit",
     "quantity": 100
   }
   ```

5. **Send Order to External API:**
   - Endpoint: `POST https://sections-bot.inbitme.com/order`
   - Headers: `Content-Type: application/json`, `Accept: application/json`
   - Body: Order request body (JSON stringified)

6. **Handle Response:**
   - Parse response body (try JSON first, fallback to text)
   - Success: HTTP status 200 or 201
   - Extract error messages from response if status is not OK
   - Log success/error with appropriate emoji indicators (✅ for success, ❌ for errors)

7. **Return Response:**
   - **Network/Parse Errors:** Return HTTP 500 with error details
   - **External API Errors:** Return HTTP 200 with `success: false` and error message in response body
   - **Success:** Return HTTP 200 with `success: true` and response data
   ```json
   {
     "success": true,
     "data": {
       "symbol": "AAPL",
       "quantity": 100,
       "orderType": "Limit",
       "notifyStatus": "200 OK",
       "response": { /* API response */ }
     }
   }
   ```

### 2. Sell All Endpoint (`POST /api/sell_all`)

**Request Body:** None (empty body)

**Logic Flow:**
1. **Delete All Existing SELL Orders:**
   - Collect all unique symbols that have active SELL orders (from buy list, stop-loss tracking, etc.)
   - For each symbol, call `deleteAllSellOrdersForSymbol(symbol)` in parallel
   - Wait for all deletions to complete
   - Log total deleted/failed counts
   - Wait 300ms after deletions to ensure orders are fully cancelled

2. **Send Sell All Request:**
   - Endpoint: `POST https://sections-bot.inbitme.com/sell_all`
   - Headers: `Accept: */*`
   - Body: None (empty request)

3. **Handle Response:**
   - Success: HTTP 200 with no content (or empty body)
   - Parse response body only if content-length > 0
   - Log success/error appropriately

4. **Return Response:**
   - Same pattern as individual sell: 500 for network errors, 200 with success flag for API responses
   ```json
   {
     "success": true,
     "data": {
       "notifyStatus": "200 OK",
       "message": "Sell All executed successfully - all pending orders cancelled and positions sold"
     }
   }
   ```

### 3. Order Deletion Helper Functions

**`deleteOrder(orderId)` Function:**
- Endpoint: `DELETE https://sections-bot.inbitme.com/order/{order_id}`
- Headers: `Accept: */*`
- Returns: `{ success: boolean, error: string | null, status: string }`
- Success codes: 200 or 204
- Extract error messages from response if deletion fails

**`deleteAllSellOrdersForSymbol(symbol)` Function:**
- Find all order IDs for SELL orders associated with this symbol
- Iterate through order IDs and call `deleteOrder()` for each
- Add 100ms delay between deletions (if more than one order)
- Return summary: `{ success: boolean, deleted: number, failed: number, results: array }`
- Log deletion results

### 4. Frontend Integration (React/TypeScript)

**Individual Sell Handler:**
```typescript
const handleSell = async (position: Position) => {
  // 1. Extract symbol, quantity, long_short from position
  // 2. Show confirmation modal
  // 3. On confirm, send POST request to `/api/sell`:
  const response = await fetchWithAuth(`${API_BASE_URL}/sell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      symbol: symbol.toUpperCase(),
      quantity: parseInt(quantity),
      order_type: 'Limit',
      long_short: position.LongShort
    })
  });
  
  // 4. Handle response:
  //    - HTTP errors (500): Show error notification
  //    - API errors (200 with success: false): Show error notification
  //    - Success: Show success notification
  // 5. Update UI state (remove from selling set, refresh positions)
};
```

**Sell All Handler:**
```typescript
const handleSellAll = async () => {
  // 1. Show confirmation modal with warning
  // 2. On confirm, send POST request to `/api/sell_all`:
  const response = await fetchWithAuth(`${API_BASE_URL}/sell_all`, {
    method: 'POST',
    headers: { 'Accept': '*/*' }
  });
  
  // 3. Handle response same as individual sell
  // 4. Show status message in UI
};
```

## Key Implementation Details

### Order Type Normalization
```javascript
const rawOrderType = (req.body?.order_type || 'Limit').toString().trim();
const normalizedInput = rawOrderType.toLowerCase();
let orderType = 'Limit'; // default
if (normalizedInput === 'limit') {
  orderType = 'Limit';
} else if (normalizedInput === 'market') {
  orderType = 'Market';
} else if (normalizedInput === 'stoplimit' || normalizedInput === 'stop_limit' || normalizedInput === 'stop-limit') {
  orderType = 'StopLimit';
}
```

### Side Determination
```javascript
const isLong = longShort.toLowerCase() === 'long';
const side = isLong ? 'SELL' : 'BUY';
const action = isLong ? 'sell' : 'close (buy back)';
```

### Error Handling Pattern
- Always try to parse response body (JSON first, fallback to text)
- Extract error messages from: `responseData.message || responseData.error || responseData.detail || JSON.stringify(responseData)`
- Log errors with context (status, response, body)
- Return appropriate HTTP status codes (500 for network errors, 200 with success flag for API errors)

### Logging Pattern
- Use emoji indicators: ✅ for success, ❌ for errors, 🗑️ for deletions, 💸 for sell operations, 📤 for sending requests, 🛡️ for stop-loss orders, 📋 for queued operations, 📊 for position updates
- Include relevant context: symbol, quantity, order type, status codes

### 5. StopLimit Sell Logic (Stop-Loss Orders)

**Overview:**
Stop-loss orders are automatically created after buy orders are successfully placed. They use `StopLimit` order type to protect positions by automatically selling when the price drops to a certain level.

**Key Characteristics:**
- Stop-loss orders are **queued** after buy orders, not created immediately
- They wait for the position to be filled before being created
- They use price-based offsets that vary by stock price range
- Both `stop_price` and `limit_price` are required for StopLimit orders
- Order IDs are tracked and stored for later deletion

**Stop-Loss Price Calculation:**
Based on stock price ranges, calculate stop-loss price using fixed offsets:
```javascript
let stopLossPrice;
let stopLossOffset;

if (stockPrice > 0 && stockPrice <= 5) {
  stopLossOffset = 0.20;
  stopLossPrice = stockPrice - stopLossOffset;  // e.g., $4.50 → $4.30
} else if (stockPrice > 5 && stockPrice <= 10) {
  stopLossOffset = 0.35;
  stopLossPrice = stockPrice - stopLossOffset;  // e.g., $7.50 → $7.15
} else if (stockPrice > 10 && stockPrice <= 12) {
  stopLossOffset = 0.45;
  stopLossPrice = stockPrice - stopLossOffset;  // e.g., $11.50 → $11.05
} else {
  // Price outside supported range (0-12) - skip stop-loss
  return { success: false, errorMessage: 'Price outside supported range (0-12)' };
}

// Ensure stop-loss price is positive
if (stopLossPrice <= 0) {
  return { success: false, errorMessage: 'Stop-loss price is not positive' };
}
```

**Stop-Loss Order Request Body:**
```json
{
  "symbol": "AAPL",
  "side": "SELL",
  "order_type": "StopLimit",
  "quantity": 100,
  "limit_price": 4.30,
  "stop_price": 4.30
}
```

**Important:** For StopLimit orders, you MUST include both `limit_price` and `stop_price` parameters (unlike regular Limit/Market orders which don't include price).

**Stop-Loss Creation Flow:**

1. **Queue Stop-Loss After Buy Order:**
   ```javascript
   // After successful buy order
   if (buyOrderSuccess) {
     queueStopLossOrder(symbol, stockPrice, quantity, onComplete);
     // Returns placeholder: { success: true, queued: true, notifyStatus: 'QUEUED' }
   }
   ```

2. **Position Monitoring System:**
   - Maintain a WebSocket connection to positions endpoint: `wss://sections-bot.inbitme.com/ws/positions?api_key={API_KEY}`
   - Keep a cache of current positions: `Map<symbol, positionData>`
   - Update cache when position messages are received
   - Remove from cache when quantity becomes 0

3. **Process Pending Stop-Loss Queue:**
   - Poll every 5 seconds (`STOP_LOSS_POLL_INTERVAL_MS = 5000`)
   - For each queued stop-loss:
     - Check if position exists using `checkPositionExists(symbol)` (checks cache)
     - If position exists: create stop-loss order immediately
     - If not: increment attempt counter and wait for next poll
     - Timeout after 5 minutes (60 attempts × 5 seconds)
     - Max attempts: 60

4. **Create Stop-Loss Order:**
   ```javascript
   async function createStopLossOrder(symbol, stockPrice, quantity) {
     // 1. Calculate stop-loss price using price ranges
     // 2. Validate price is in range (0-12) and stop-loss price is positive
     // 3. Build order body with StopLimit type, both limit_price and stop_price
     // 4. Send POST to https://sections-bot.inbitme.com/order
     // 5. Extract order_id from response
     // 6. Return: { success, notifyStatus, responseData, errorMessage, stopLossPrice, stopLossOffset, orderId }
   }
   ```

5. **Store Order ID:**
   - Extract `order_id` from API response: `responseData.order_id || responseData.orderId || responseData.id`
   - Store in buy entry: `buyEntry.stopLoss.orderId = orderId`
   - This order ID is used later when deleting stop-loss orders

**Queue Management:**
```javascript
// Queue structure
const pendingStopLossQueue = new Map(); // Map<symbol, {
//   stockPrice: number,
//   quantity: number,
//   createdAt: timestamp,
//   attempts: number,
//   onComplete: callback
// }>

function queueStopLossOrder(symbol, stockPrice, quantity, onComplete = null) {
  const normalizedSymbol = symbol.toUpperCase();
  pendingStopLossQueue.set(normalizedSymbol, {
    stockPrice,
    quantity,
    createdAt: Date.now(),
    attempts: 0,
    onComplete
  });
}

async function processPendingStopLossOrders() {
  const now = Date.now();
  const MAX_WAIT_TIME = 5 * 60 * 1000; // 5 minutes
  const MAX_ATTEMPTS = 60;
  
  for (const [symbol, pending] of pendingStopLossQueue.entries()) {
    pending.attempts++;
    const elapsed = now - pending.createdAt;
    
    // Timeout check
    if (elapsed > MAX_WAIT_TIME || pending.attempts > MAX_ATTEMPTS) {
      // Remove from queue
      pendingStopLossQueue.delete(symbol);
      continue;
    }
    
    // Check if position exists
    if (checkPositionExists(symbol)) {
      // Create stop-loss order
      const result = await createStopLossOrder(symbol, pending.stockPrice, pending.quantity);
      
      // Update buy entry with stop-loss result
      const buyEntry = buyList.find(entry => entry.ticker === symbol);
      if (buyEntry && buyEntry.stopLoss?.queued) {
        buyEntry.stopLoss = result; // Replace queued status with actual result
      }
      
      // Remove from queue
      pendingStopLossQueue.delete(symbol);
      
      // Call completion callback if provided
      if (pending.onComplete) {
        pending.onComplete(result);
      }
    }
  }
}

// Start polling interval
setInterval(processPendingStopLossOrders, 5000);
```

**Position Cache Management:**
```javascript
const positionsCache = new Map(); // Map<symbol, positionData>

// WebSocket message handler
positionsWs.on('message', (data) => {
  const dataObj = JSON.parse(data.toString());
  
  if (dataObj.Heartbeat) return; // Skip heartbeats
  
  if (dataObj.PositionID && dataObj.Symbol) {
    const symbol = dataObj.Symbol.toUpperCase();
    const quantity = parseFloat(dataObj.Quantity || '0');
    
    if (quantity > 0) {
      // Update cache
      positionsCache.set(symbol, {
        ...dataObj,
        Symbol: symbol,
        lastUpdated: Date.now()
      });
    } else {
      // Remove from cache (position closed)
      positionsCache.delete(symbol);
    }
  }
});

function checkPositionExists(symbol) {
  const position = positionsCache.get(symbol.toUpperCase());
  if (position) {
    const quantity = parseFloat(position.Quantity || '0');
    return quantity > 0;
  }
  return false;
}
```

**Stop-Loss Order Deletion:**
- When deleting SELL orders for a symbol, check buy entries for stored stop-loss order IDs:
  ```javascript
  for (const buyEntry of buyList) {
    if (buyEntry.ticker === symbol && buyEntry.stopLoss?.orderId) {
      ordersToDelete.push(buyEntry.stopLoss.orderId);
    }
  }
  ```

**Key Points:**
- Stop-loss orders are **automatically created** after buy orders (not manual)
- They wait for positions to exist before being created (queued system)
- Price offsets are fixed: $0.20 for $0-5, $0.35 for $5-10, $0.45 for $10-12
- Only supports stocks priced between $0-12
- Order IDs must be tracked for proper deletion
- Uses WebSocket for real-time position monitoring
- Polls every 5 seconds to check for positions
- Times out after 5 minutes if position never appears

## Testing Checklist

### Individual Sell Orders
- [ ] Individual sell order for Long position (should delete existing SELL orders first)
- [ ] Individual sell order for Short position (should use BUY side, no deletion needed)
- [ ] Sell order with invalid symbol (should return 400)
- [ ] Sell order with invalid quantity (should return 400)
- [ ] Sell order with different order types (Limit, Market, StopLimit)
- [ ] Sell order deletes existing stop-loss orders before creating new sell order

### Sell All
- [ ] Sell All endpoint (should delete all SELL orders first, then call sell_all)
- [ ] Sell All deletes all stop-loss orders across all symbols

### Order Deletion
- [ ] Order deletion helper functions work correctly
- [ ] `deleteOrder()` handles success (200/204) and error responses
- [ ] `deleteAllSellOrdersForSymbol()` finds and deletes all orders for a symbol
- [ ] Deletion includes stop-loss order IDs from buy entries

### Stop-Loss Orders (StopLimit)
- [ ] Stop-loss is queued after successful buy order
- [ ] Stop-loss price calculation for $0-5 range (offset: $0.20)
- [ ] Stop-loss price calculation for $5-10 range (offset: $0.35)
- [ ] Stop-loss price calculation for $10-12 range (offset: $0.45)
- [ ] Stop-loss skipped for prices outside $0-12 range
- [ ] Stop-loss skipped if calculated price is not positive
- [ ] Position WebSocket connection and cache updates work correctly
- [ ] Stop-loss order created when position appears in cache
- [ ] Stop-loss queue times out after 5 minutes if position never appears
- [ ] Stop-loss order includes both `limit_price` and `stop_price` parameters
- [ ] Stop-loss order ID is extracted and stored correctly
- [ ] Buy entry updated with stop-loss result when order is created

### Frontend
- [ ] Frontend handles all response scenarios (success, API error, network error)
- [ ] Confirmation modals appear before executing sells
- [ ] UI updates correctly after successful sells
- [ ] Stop-loss status displayed correctly (queued vs created vs failed)

## API Documentation Reference
- Sections Bot API: https://inbitme.gitbook.io/sections-bot/xKy06Pb8j01LsqEnmSik/rest-api/ordenes
- POST /order: Create order (symbol, side, order_type, quantity - NO price for Limit/Market, but REQUIRES limit_price and stop_price for StopLimit)
- DELETE /order/{order_id}: Cancel order
- POST /sell_all: Panic sell all positions (no body)
- WebSocket /ws/positions: Real-time position updates (requires api_key query parameter)

