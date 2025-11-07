# Orders WebSocket Implementation Guide

This document explains how the Orders WebSocket connection is implemented in this project, including the architecture, data flow, and implementation details. Use this guide to implement similar functionality in other projects.

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Frontend Implementation](#frontend-implementation)
3. [Backend Proxy Service](#backend-proxy-service)
4. [Server Routing](#server-routing)
5. [Data Flow](#data-flow)
6. [Key Features](#key-features)
7. [Implementation Checklist](#implementation-checklist)

---

## Architecture Overview

The Orders WebSocket implementation uses a **proxy pattern** where:

1. **Frontend** connects to a backend WebSocket endpoint (`/ws/orders`)
2. **Backend** acts as a proxy, forwarding connections to an external P&L service
3. **External Service** streams real-time order updates
4. **Data flows bidirectionally** through the proxy

```
Frontend (React) 
    ↓ WebSocket (wss://your-app.com/ws/orders?token=JWT)
Backend Proxy (Node.js/Express)
    ↓ WebSocket (wss://external-service.com/ws/orders?api_key=KEY)
External P&L Service
```

### Why a Proxy?
- **Security**: Keeps API keys server-side (never exposed to frontend)
- **Authentication**: Validates user JWT tokens before proxying
- **Abstraction**: Frontend doesn't need to know about external service details
- **Control**: Can add logging, rate limiting, or data transformation

---

## Frontend Implementation

### Component Structure: `OrdersSection.tsx`

The frontend component manages the WebSocket connection and displays orders in real-time.

#### Key State Management

```typescript
const [orders, setOrders] = React.useState<Map<string, Order>>(new Map());
const [isConnected, setIsConnected] = React.useState(false);
const [loading, setLoading] = React.useState(true);
const [error, setError] = React.useState<string | null>(null);
const wsRef = React.useRef<WebSocket | null>(null);
const reconnectAttemptsRef = React.useRef(0);
const reconnectTimerRef = React.useRef<number | null>(null);
const connectionTimeoutRef = React.useRef<number | null>(null);
```

**Why Map instead of Array?**
- Orders are keyed by `OrderID` for O(1) lookups
- Easy to update/replace specific orders
- Prevents duplicates automatically

#### Connection Setup

```typescript
const connectWebSocket = React.useCallback(() => {
  // 1. Validate authentication token
  const token = localStorage.getItem('auth_token');
  if (!token) {
    setError('Authentication required. Please log in.');
    return;
  }

  // 2. Construct WebSocket URL with token
  const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';
  const url = `${WS_BASE_URL}/ws/orders?token=${encodeURIComponent(token)}`;
  
  // 3. Create WebSocket connection
  const ws = new WebSocket(url);
  ws.binaryType = 'blob'; // Handle blob data if needed
  wsRef.current = ws;

  // 4. Set connection timeout (10 seconds)
  connectionTimeoutRef.current = window.setTimeout(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setError('Connection timeout. Please check your connection.');
      setLoading(false);
    }
  }, 10000);

  // 5. Handle connection open
  ws.onopen = () => {
    setIsConnected(true);
    setLoading(false);
    setError(null);
    reconnectAttemptsRef.current = 0;
    // Clear timeout
    if (connectionTimeoutRef.current) {
      window.clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  };

  // 6. Handle incoming messages
  ws.onmessage = async (event) => {
    try {
      // Handle different data types (Blob, string, ArrayBuffer)
      let dataStr: string;
      if (event.data instanceof Blob) {
        dataStr = await event.data.text();
      } else if (typeof event.data === 'string') {
        dataStr = event.data;
      } else {
        dataStr = new TextDecoder().decode(event.data as ArrayBuffer);
      }
      
      const data = JSON.parse(dataStr);
      
      // Ignore heartbeat/status messages
      if (data.Heartbeat || data.StreamStatus) return;

      // Process order updates
      if (data.OrderID) {
        const order: Order = data;
        setOrders(prev => {
          const m = new Map(prev);
          m.set(order.OrderID, order); // Update or add order
          return m;
        });
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  };

  // 7. Handle errors
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    setIsConnected(false);
    setError('Connection error. Please check your connection.');
  };

  // 8. Handle connection close with auto-reconnect
  ws.onclose = (event) => {
    setIsConnected(false);
    
    // Only reconnect if not a normal closure
    if (event.code !== 1000) {
      const attempts = reconnectAttemptsRef.current + 1;
      reconnectAttemptsRef.current = attempts;
      
      // Exponential backoff: 1s, 2s, 4s, 8s, 15s (max)
      const delay = Math.min(15000, 1000 * Math.pow(2, attempts - 1));
      
      reconnectTimerRef.current = window.setTimeout(connectWebSocket, delay);
    }
  };
}, [token, WS_BASE_URL]);
```

#### Order Data Structure

```typescript
interface Order {
  AccountID: string;
  CommissionFee: string;
  Currency: string;
  Duration: string; // e.g., GTC
  FilledPrice: string;
  GoodTillDate: string;
  Legs: OrderLeg[];
  LimitPrice?: string;
  OpenedDateTime: string;
  OrderID: string; // Primary key
  OrderType: string; // e.g., Limit, Market, StopLimit
  PriceUsedForBuyingPower?: string;
  Routing?: string;
  Status: string; // e.g., DON, REC
  StatusDescription: string; // e.g., Queued, Received, Filled
  UnbundledRouteFee?: string;
}

interface OrderLeg {
  AssetType: string;
  BuyOrSell: string; // Buy | Sell
  ExecQuantity: string | number;
  OpenOrClose: string; // Open | Close
  QuantityOrdered: string | number;
  QuantityRemaining: string | number;
  Symbol: string;
}
```

#### Display Logic

Orders are displayed in a virtualized list (using `react-virtuoso` for performance):

```typescript
const ordersArray = Array.from(orders.values()).sort((a, b) => {
  // Sort newest first
  return new Date(b.OpenedDateTime).getTime() - new Date(a.OpenedDateTime).getTime();
});
```

#### Order Cancellation

```typescript
const handleCancelOrder = async (orderId: string) => {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/orders/${orderId}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      // Order will be removed from list via WebSocket update
      console.log(`Order ${orderId} cancelled successfully`);
    }
  } catch (err) {
    console.error(`Error cancelling order:`, err);
  }
};
```

**Note**: The order is removed from the UI automatically when the WebSocket receives an update with the cancelled status.

#### Cleanup on Unmount

```typescript
React.useEffect(() => {
  connectWebSocket();
  return () => {
    disconnectWebSocket(); // Clean up on unmount
  };
}, [connectWebSocket, disconnectWebSocket]);
```

---

## Backend Proxy Service

### Service: `pnlProxyService.js`

The proxy service handles bidirectional message forwarding between frontend clients and the external P&L service.

#### Class Structure

```javascript
class PnLProxyService {
  constructor() {
    this.apiKey = process.env.PNL_API_KEY; // External service API key
    this.wsBaseUrl = process.env.PNL_WS_BASE_URL || 'wss://sections-bot.inbitme.com';
    this.proxyConnections = new Map(); // Track clientWs -> externalWs mappings
  }
}
```

#### Authentication Verification

```javascript
async verifyToken(token) {
  if (!token) return null;
  try {
    const secret = process.env.JWT_SECRET || 'dev_secret';
    const payload = jwt.verify(token, secret);
    const user = await User.findById(payload.sub).select('_id email');
    return user ? { id: user._id.toString(), email: user.email } : null;
  } catch {
    return null;
  }
}
```

#### Proxy Connection Handler

```javascript
async handleProxyConnection(clientWs, req, path) {
  // 1. Extract token from query string or headers
  let token = null;
  if (req.url && req.url.includes('?')) {
    const urlParts = req.url.split('?');
    const params = new URLSearchParams(urlParts[1]);
    token = params.get('token');
  }
  
  // 2. Verify authentication
  const user = await this.verifyToken(token);
  if (!user) {
    clientWs.close(1008, 'Authentication required');
    return;
  }

  // 3. Determine endpoint (positions or orders)
  const isPositions = path.includes('/positions');
  const externalPath = isPositions ? '/ws/positions' : '/ws/orders';
  const externalUrl = `${this.wsBaseUrl}${externalPath}?api_key=${encodeURIComponent(this.apiKey)}`;

  // 4. Create external WebSocket connection
  const externalWs = new WebSocket(externalUrl);

  // 5. Forward messages: External → Client
  externalWs.on('message', (data) => {
    try {
      // Convert Buffer to string for browser compatibility
      const textData = Buffer.isBuffer(data) ? data.toString('utf8') : 
                     (typeof data === 'string' ? data : data.toString());
      
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(textData); // Forward to frontend
      }
    } catch (error) {
      console.error('Error forwarding message to client:', error);
    }
  });

  // 6. Forward messages: Client → External
  clientWs.on('message', (data) => {
    try {
      if (externalWs.readyState === WebSocket.OPEN) {
        externalWs.send(data); // Forward to external service
      }
    } catch (error) {
      console.error('Error forwarding client message:', error);
    }
  });

  // 7. Handle external connection events
  externalWs.on('open', () => {
    console.log('External WebSocket connected');
  });

  externalWs.on('error', (error) => {
    console.error('External WebSocket error:', error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'proxy_error', error: 'External connection failed' }));
    }
  });

  externalWs.on('close', (code, reason) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason); // Close client connection too
    }
  });

  // 8. Handle client disconnect
  clientWs.on('close', () => {
    if (externalWs.readyState === WebSocket.OPEN || externalWs.readyState === WebSocket.CONNECTING) {
      externalWs.close(); // Clean up external connection
    }
    this.proxyConnections.delete(clientWs);
  });

  // 9. Store connection mapping
  this.proxyConnections.set(clientWs, externalWs);
}
```

**Key Points:**
- **Bidirectional forwarding**: Messages flow both ways
- **State checking**: Always verify `readyState === WebSocket.OPEN` before sending
- **Cleanup**: Properly close connections when one side disconnects
- **Error handling**: Forward errors to client when external connection fails

---

## Server Routing

### WebSocket Upgrade Handling: `server.js`

The server routes WebSocket upgrade requests to the appropriate handler.

```javascript
const WebSocket = require('ws');
const http = require('http');
const PnLProxyService = require('./pnlProxyService');

const app = express();
const server = http.createServer(app);

// Create separate WebSocket servers for different endpoints
const wss = new WebSocket.Server({ noServer: true }); // Main alerts
const positionsWss = new WebSocket.Server({ noServer: true }); // Positions proxy
const ordersWss = new WebSocket.Server({ noServer: true }); // Orders proxy

const pnlProxyService = new PnLProxyService();

// Handle orders proxy connections
ordersWss.on('connection', async (ws, req) => {
  console.log('Client orders WebSocket connection established');
  await pnlProxyService.handleProxyConnection(ws, req, req.url);
});

// Manual upgrade handling to route to correct WebSocket server
server.on('upgrade', (request, socket, head) => {
  try {
    // Parse pathname (remove query string for matching)
    const url = request.url.split('?')[0];
    const pathname = url;

    if (pathname === '/ws/orders') {
      // Route to orders WebSocket server
      ordersWss.handleUpgrade(request, socket, head, (ws) => {
        ordersWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/positions') {
      // Route to positions WebSocket server
      positionsWss.handleUpgrade(request, socket, head, (ws) => {
        positionsWss.emit('connection', ws, request);
      });
    } else {
      // Default: route to main alerts WebSocket server
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  } catch (error) {
    console.error('WebSocket upgrade error:', error);
    socket.destroy();
  }
});
```

**Why `noServer: true`?**
- Allows manual routing based on URL path
- Multiple WebSocket servers can share the same HTTP server
- More control over connection handling

---

## Data Flow

### Complete Flow Diagram

```
┌─────────────────┐
│  Frontend       │
│  (React)        │
└────────┬────────┘
         │
         │ 1. WebSocket Connection
         │    ws://app.com/ws/orders?token=JWT
         │
         ▼
┌─────────────────┐
│  Backend Server  │
│  (Express)      │
│                 │
│  2. Extract     │
│     token       │
│                 │
│  3. Verify JWT  │
│     (User auth) │
│                 │
│  4. Route to    │
│     ordersWss   │
└────────┬────────┘
         │
         │ 5. Create Proxy Connection
         │
         ▼
┌─────────────────┐
│ Proxy Service   │
│ (PnLProxy)      │
│                 │
│  6. Connect to  │
│     external    │
│     wss://...   │
│     /ws/orders? │
│     api_key=KEY │
└────────┬────────┘
         │
         │ 7. WebSocket Connection
         │
         ▼
┌─────────────────┐
│ External P&L    │
│ Service         │
│                 │
│  8. Stream      │
│     order       │
│     updates     │
└─────────────────┘
```

### Message Flow Example

**Order Update Received:**

1. External service sends order update: `{ OrderID: "123", Status: "Filled", ... }`
2. Proxy receives message on `externalWs.on('message')`
3. Proxy converts Buffer to string and forwards to `clientWs.send(textData)`
4. Frontend receives message on `ws.onmessage`
5. Frontend parses JSON and updates state: `setOrders(prev => { m.set(order.OrderID, order); return m; })`
6. React re-renders with updated order data

**Order Cancellation:**

1. User clicks "Cancel" button
2. Frontend calls `DELETE /api/orders/:orderId`
3. Backend processes cancellation with external API
4. External service sends order update via WebSocket: `{ OrderID: "123", Status: "Cancelled" }`
5. Frontend receives update and removes/updates order in UI

---

## Key Features

### 1. Automatic Reconnection

**Exponential Backoff Strategy:**
- First attempt: 1 second
- Second attempt: 2 seconds
- Third attempt: 4 seconds
- Fourth attempt: 8 seconds
- Maximum: 15 seconds

```typescript
const delay = Math.min(15000, 1000 * Math.pow(2, attempts - 1));
```

**When to Reconnect:**
- Connection closes unexpectedly (`event.code !== 1000`)
- Network errors
- Server restarts

**When NOT to Reconnect:**
- Normal closure (`event.code === 1000`)
- User logout
- Component unmount

### 2. Connection Timeout

Prevents indefinite loading states:

```typescript
connectionTimeoutRef.current = window.setTimeout(() => {
  if (wsRef.current?.readyState !== WebSocket.OPEN) {
    setError('Connection timeout. Please check your connection.');
    setLoading(false);
  }
}, 10000); // 10 seconds
```

### 3. Data Type Handling

Handles multiple data formats from WebSocket:

```typescript
let dataStr: string;
if (event.data instanceof Blob) {
  dataStr = await event.data.text();
} else if (typeof event.data === 'string') {
  dataStr = event.data;
} else {
  dataStr = new TextDecoder().decode(event.data as ArrayBuffer);
}
```

### 4. Heartbeat Filtering

Ignores keep-alive messages:

```typescript
if (data.Heartbeat || data.StreamStatus) return;
```

### 5. Order State Management

Uses Map for efficient updates:

```typescript
setOrders(prev => {
  const m = new Map(prev);
  m.set(order.OrderID, order); // Update or add
  return m;
});
```

**Benefits:**
- O(1) lookup by OrderID
- Automatic deduplication
- Easy updates (just replace by key)

### 6. Error Handling

**Frontend:**
- Connection errors → Show error message
- Parse errors → Log and continue
- Timeout → Show timeout message

**Backend:**
- Authentication failures → Close connection with error code
- External connection failures → Forward error to client
- Proxy errors → Log and close gracefully

### 7. Loading States

Three states managed:
- `loading`: Initial connection attempt
- `isConnected`: Current connection status
- `error`: Error message (if any)

---

## Implementation Checklist

Use this checklist when implementing Orders WebSocket in another project:

### Frontend (React/TypeScript)

- [ ] **State Management**
  - [ ] Create state for orders (Map<string, Order>)
  - [ ] Create state for connection status (isConnected, loading, error)
  - [ ] Create refs for WebSocket instance and timers

- [ ] **Connection Setup**
  - [ ] Extract authentication token (JWT from localStorage)
  - [ ] Construct WebSocket URL with token query parameter
  - [ ] Create WebSocket instance with proper binary type
  - [ ] Set connection timeout (10 seconds)

- [ ] **Event Handlers**
  - [ ] `onopen`: Set connected state, clear timeout, reset reconnect attempts
  - [ ] `onmessage`: Parse JSON, filter heartbeats, update orders Map
  - [ ] `onerror`: Set error state, log error
  - [ ] `onclose`: Handle reconnection with exponential backoff

- [ ] **Data Processing**
  - [ ] Handle Blob, string, and ArrayBuffer data types
  - [ ] Parse JSON messages
  - [ ] Filter heartbeat/status messages
  - [ ] Update orders Map by OrderID

- [ ] **Reconnection Logic**
  - [ ] Exponential backoff (1s, 2s, 4s, 8s, max 15s)
  - [ ] Only reconnect on unexpected closures
  - [ ] Clear timers on cleanup

- [ ] **UI Display**
  - [ ] Show connection status indicator
  - [ ] Display loading state during connection
  - [ ] Show error messages
  - [ ] Render orders list (virtualized for performance)
  - [ ] Sort orders (newest first)

- [ ] **Order Actions**
  - [ ] Implement cancel order functionality
  - [ ] Call DELETE API endpoint
  - [ ] Handle loading states during cancellation

- [ ] **Cleanup**
  - [ ] Disconnect WebSocket on component unmount
  - [ ] Clear all timers
  - [ ] Reset state

### Backend (Node.js/Express)

- [ ] **WebSocket Server Setup**
  - [ ] Install `ws` package
  - [ ] Create HTTP server
  - [ ] Create WebSocket server with `noServer: true`
  - [ ] Handle upgrade requests

- [ ] **Routing**
  - [ ] Parse URL path to determine endpoint
  - [ ] Route `/ws/orders` to orders handler
  - [ ] Route `/ws/positions` to positions handler (if needed)
  - [ ] Handle routing errors

- [ ] **Proxy Service**
  - [ ] Create PnLProxyService class
  - [ ] Store API key in environment variables
  - [ ] Store WebSocket base URL in environment variables
  - [ ] Track proxy connections (Map)

- [ ] **Authentication**
  - [ ] Extract token from query string or headers
  - [ ] Verify JWT token
  - [ ] Check user exists in database
  - [ ] Reject unauthenticated connections

- [ ] **Proxy Connection**
  - [ ] Determine endpoint (orders vs positions)
  - [ ] Construct external WebSocket URL with API key
  - [ ] Create external WebSocket connection
  - [ ] Forward messages: External → Client
  - [ ] Forward messages: Client → External
  - [ ] Handle external connection events (open, error, close)
  - [ ] Handle client disconnect
  - [ ] Clean up connections properly

- [ ] **Error Handling**
  - [ ] Log connection attempts
  - [ ] Log authentication failures
  - [ ] Log proxy errors
  - [ ] Forward errors to client when appropriate
  - [ ] Close connections gracefully on errors

- [ ] **Environment Variables**
  - [ ] `PNL_API_KEY`: External service API key
  - [ ] `PNL_WS_BASE_URL`: External WebSocket base URL
  - [ ] `JWT_SECRET`: Secret for JWT verification
  - [ ] `WS_HEARTBEAT_MS`: Heartbeat interval (optional)

### API Endpoints

- [ ] **Order Cancellation**
  - [ ] `DELETE /api/orders/:orderId`
  - [ ] Require authentication middleware
  - [ ] Call external API to cancel order
  - [ ] Return success/error response

### Testing

- [ ] **Connection Tests**
  - [ ] Test successful connection
  - [ ] Test connection with invalid token
  - [ ] Test connection timeout
  - [ ] Test reconnection after disconnect

- [ ] **Message Tests**
  - [ ] Test receiving order updates
  - [ ] Test filtering heartbeat messages
  - [ ] Test handling different data types (Blob, string, ArrayBuffer)
  - [ ] Test order state updates

- [ ] **Error Tests**
  - [ ] Test external service unavailable
  - [ ] Test malformed messages
  - [ ] Test network errors
  - [ ] Test authentication failures

- [ ] **UI Tests**
  - [ ] Test loading states
  - [ ] Test error display
  - [ ] Test order list rendering
  - [ ] Test order cancellation

---

## Environment Variables

### Frontend (.env)

```env
VITE_WS_BASE_URL=ws://localhost:3001
VITE_API_BASE_URL=http://localhost:3001/api
```

### Backend (.env)

```env
PNL_API_KEY=your_external_api_key_here
PNL_WS_BASE_URL=wss://sections-bot.inbitme.com
JWT_SECRET=your_jwt_secret_here
WS_HEARTBEAT_MS=30000
PORT=3001
```

---

## Common Issues and Solutions

### Issue: WebSocket connects but no messages received

**Solution:**
- Check external service is streaming data
- Verify API key is correct
- Check proxy is forwarding messages correctly
- Look for errors in backend logs

### Issue: Connection closes immediately

**Solution:**
- Verify JWT token is valid
- Check authentication middleware
- Verify external service URL is correct
- Check API key is valid

### Issue: Messages received as Blob instead of JSON

**Solution:**
- Set `ws.binaryType = 'blob'` on frontend
- Convert Blob to string: `await event.data.text()`
- Backend should send as text: `clientWs.send(textData)`

### Issue: Reconnection loops infinitely

**Solution:**
- Check `event.code !== 1000` before reconnecting
- Implement maximum reconnect attempts
- Add exponential backoff delay
- Clear timers on cleanup

### Issue: Orders not updating in UI

**Solution:**
- Verify `OrderID` exists in message
- Check Map update logic: `m.set(order.OrderID, order)`
- Verify React state updates trigger re-render
- Check for filtering logic removing valid orders

---

## Best Practices

1. **Always verify authentication** before proxying connections
2. **Use Map for order storage** for O(1) lookups and automatic deduplication
3. **Handle multiple data types** (Blob, string, ArrayBuffer) for compatibility
4. **Implement exponential backoff** for reconnections to avoid server overload
5. **Set connection timeouts** to prevent indefinite loading states
6. **Filter heartbeat messages** to avoid unnecessary state updates
7. **Clean up connections** properly on component unmount
8. **Log connection events** for debugging and monitoring
9. **Forward errors to client** when external connection fails
10. **Use virtualized lists** for large order lists to maintain performance

---

## Example Usage

### Frontend Component

```typescript
import React from 'react';
import { useAuth } from '../auth/AuthContext';

const OrdersSection: React.FC = () => {
  const [orders, setOrders] = React.useState<Map<string, Order>>(new Map());
  const [isConnected, setIsConnected] = React.useState(false);
  const { fetchWithAuth } = useAuth();
  const wsRef = React.useRef<WebSocket | null>(null);

  // ... (implementation as described above)

  return (
    <div>
      <div>Status: {isConnected ? 'Connected' : 'Disconnected'}</div>
      <div>Orders: {orders.size}</div>
      {/* Render orders list */}
    </div>
  );
};
```

### Backend Proxy

```javascript
const PnLProxyService = require('./pnlProxyService');
const pnlProxyService = new PnLProxyService();

ordersWss.on('connection', async (ws, req) => {
  await pnlProxyService.handleProxyConnection(ws, req, req.url);
});
```

---

## Summary

This implementation provides:

✅ **Secure proxy pattern** - API keys stay server-side  
✅ **JWT authentication** - User verification before connection  
✅ **Automatic reconnection** - Exponential backoff strategy  
✅ **Robust error handling** - Graceful degradation  
✅ **Real-time updates** - Bidirectional message forwarding  
✅ **Efficient state management** - Map-based order storage  
✅ **Production-ready** - Timeouts, cleanup, logging  

Use this guide as a reference when implementing Orders WebSocket functionality in other projects. Adapt the patterns to your specific requirements and external service APIs.



