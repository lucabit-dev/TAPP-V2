import React, { useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAuth } from '../auth/AuthContext';

interface OrderLeg {
  AssetType: string;
  BuyOrSell: string; // Buy | Sell
  ExecQuantity: string | number;
  OpenOrClose: string; // Open | Close
  QuantityOrdered: string | number;
  QuantityRemaining: string | number;
  Symbol: string;
}

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
  OrderID: string;
  OrderType: string; // e.g., Limit, Market
  PriceUsedForBuyingPower?: string;
  Routing?: string;
  Status: string; // e.g., DON, REC
  StatusDescription: string; // e.g., Queued, Received
  UnbundledRouteFee?: string;
}

const OrdersSection: React.FC = () => {
  const [orders, setOrders] = React.useState<Map<string, Order>>(new Map());
  const [isConnected, setIsConnected] = React.useState(false);
  const { fetchWithAuth } = useAuth();
  // Get auth token from localStorage and Railway URL from env
  const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = React.useState(true);
  const [initialLoad, setInitialLoad] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [cancelingOrders, setCancelingOrders] = React.useState<Set<string>>(new Set());
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const connectionTimeoutRef = React.useRef<number | null>(null);

  const connectWebSocket = React.useCallback(() => {
    if (connectionTimeoutRef.current) {
      window.clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    if (!token) {
      setError('Authentication required. Please log in.');
      setLoading(false);
      setInitialLoad(false);
      return;
    }

    // Connect to backend proxy which will handle the external API key
    const url = `${WS_BASE_URL}/ws/orders?token=${encodeURIComponent(token)}`;
    console.log('🔌 Connecting to orders WebSocket proxy:', url.replace(token, '***'));
    
    try {
      setLoading(true);
      if (!initialLoad) setError(null);

      const ws = new WebSocket(url);
      ws.binaryType = 'blob'; // Ensure we can handle blob data
      wsRef.current = ws;

      if (initialLoad) {
        connectionTimeoutRef.current = window.setTimeout(() => {
          if (wsRef.current?.readyState !== WebSocket.OPEN) {
            setInitialLoad(false);
            setLoading(false);
            setError('Connection timeout. Please check your connection and try again.');
          }
        }, 10000);
      }

      ws.onopen = () => {
        setIsConnected(true);
        setLoading(false);
        setInitialLoad(false);
        setError(null);
        reconnectAttemptsRef.current = 0;
        if (connectionTimeoutRef.current) {
          window.clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
      };

      ws.onmessage = async (event) => {
        try {
          // Handle Blob or string data
          let dataStr: string;
          if (event.data instanceof Blob) {
            dataStr = await event.data.text();
          } else if (typeof event.data === 'string') {
            dataStr = event.data;
          } else {
            // ArrayBuffer or other format
            dataStr = new TextDecoder().decode(event.data as ArrayBuffer);
          }
          
          const data = JSON.parse(dataStr);
          console.log('📨 Received orders WebSocket message:', data);

          // Ignore heartbeats and stream status markers
          if (data.Heartbeat || data.StreamStatus) return;

          // Normalize and store by OrderID
          if (data.OrderID) {
            const order: Order = data;
            console.log('✅ Order update received:', order.OrderID, order.Status);
            setOrders(prev => {
              const m = new Map(prev);
              m.set(order.OrderID, order);
              return m;
            });
          } else {
            console.log('⚠️ Unknown message format:', data);
          }
        } catch (err) {
          console.error('❌ Error parsing WebSocket message:', err, 'Raw data type:', typeof event.data, 'Is Blob:', event.data instanceof Blob);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ Orders WebSocket error:', error);
        console.error('Attempted connection URL:', url.replace(token || '', '***'));
        setIsConnected(false);
        setError('Connection error. Please check your connection and authentication.');
        if (!initialLoad) setLoading(false);
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        if (connectionTimeoutRef.current) {
          window.clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        if (!initialLoad) {
          setLoading(false);
          if (event.code !== 1000) setError('Connection closed. Reconnecting...');
        }
        if (event.code !== 1000) {
          const attempts = reconnectAttemptsRef.current + 1;
          reconnectAttemptsRef.current = attempts;
          const delay = Math.min(15000, 1000 * Math.pow(2, attempts - 1));
          if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = window.setTimeout(connectWebSocket, delay);
        }
      };
    } catch (err) {
      setInitialLoad(false);
      setLoading(false);
      setError('Failed to connect. Please try again.');
    }
  }, [token, WS_BASE_URL, initialLoad]);

  const disconnectWebSocket = React.useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');
      wsRef.current = null;
    }
    setIsConnected(false);
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      window.clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
  }, []);

  React.useEffect(() => {
    connectWebSocket();
    return () => {
      disconnectWebSocket();
    };
  }, [connectWebSocket, disconnectWebSocket]);

  const ordersArray = Array.from(orders.values()).sort((a, b) => {
    // Sort newest first
    return new Date(b.OpenedDateTime).getTime() - new Date(a.OpenedDateTime).getTime();
  });

  const formatPrice = (value?: string) => {
    if (!value) return '—';
    const num = parseFloat(value);
    if (isNaN(num)) return '—';
    return `$${num.toFixed(2)}`;
  };

  const formatQty = (value: string | number | undefined) => {
    if (value === undefined || value === null) return '—';
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) return '—';
    return num.toLocaleString();
  };

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
  };

  // Check if order can be cancelled
  // Show cancel button for orders with remaining quantity that are not in terminal states
  // Specifically allow: Queued, DON, ACK, REC, and any active status with remaining quantity
  const canCancelOrder = (order: Order): boolean => {
    const leg = order.Legs && order.Legs.length > 0 ? order.Legs[0] : undefined;
    if (!leg) {
      console.log('❌ Order has no leg:', order.OrderID);
      return false;
    }
    
    // Check if order hasn't been filled (QuantityRemaining > 0)
    const qtyRemaining = typeof leg.QuantityRemaining === 'number' 
      ? leg.QuantityRemaining 
      : parseFloat(String(leg.QuantityRemaining || '0'));
    
    // If order is fully filled, it can't be cancelled
    if (qtyRemaining <= 0) {
      console.log('❌ Order fully filled:', order.OrderID, 'qtyRemaining:', qtyRemaining);
      return false;
    }
    
    // Check status fields (case-insensitive)
    const status = (order.Status || '').trim();
    const statusUpper = status.toUpperCase();
    const statusDesc = (order.StatusDescription || '').trim();
    const statusDescUpper = statusDesc.toUpperCase();
    
    // Terminal states that cannot be cancelled
    const terminalStates = ['FILLED', 'FIL', 'CANCELLED', 'CANCELED', 'CAN', 'EXPIRED', 'EXP', 'REJECTED', 'REJ'];
    const isTerminal = terminalStates.some(term => 
      statusUpper === term || 
      statusDescUpper.includes(term)
    );
    
    // If order is in a terminal state, it can't be cancelled
    if (isTerminal) {
      console.log('❌ Order in terminal state:', order.OrderID, 'status:', status, 'desc:', statusDesc);
      return false;
    }
    
    // Explicitly allow cancellation for DON and ACK statuses (check first, highest priority)
    // These are active orders that can be cancelled
    // Check both exact match and case variations to be thorough
    const isDON = statusUpper === 'DON' || status === 'DON' || status === 'don' || status === 'Don';
    const isACK = statusUpper === 'ACK' || status === 'ACK' || status === 'ack' || status === 'Ack';
    
    if (isDON || isACK) {
      console.log('✅ DON/ACK order can be cancelled:', {
        OrderID: order.OrderID,
        Status: status,
        StatusUpper: statusUpper,
        StatusDescription: statusDesc,
        QuantityRemaining: qtyRemaining,
        isDON,
        isACK
      });
      return true; // DON and ACK orders can always be cancelled if they have remaining quantity
    }
    
    // Explicitly allow cancellation for Queued orders (check both Status and StatusDescription)
    const isQueued = 
      statusUpper === 'QUEUED' || 
      statusDescUpper === 'QUEUED' ||
      statusDescUpper.includes('QUEUED');
    
    if (isQueued) {
      console.log('✅ Queued order can be cancelled:', order.OrderID, 'status:', status, 'desc:', statusDesc, 'qtyRemaining:', qtyRemaining);
      return true;
    }
    
    // Allow cancellation for other active statuses
    const isActiveStatus = 
      statusUpper === 'REC' ||
      statusUpper.startsWith('REC') ||
      statusDescUpper.includes('RECEIVED') ||
      statusDescUpper.includes('PENDING') ||
      statusDescUpper.includes('OPEN') ||
      statusDescUpper.includes('ACKNOWLEDGED');
    
    // Show cancel button if:
    // 1. Order has remaining quantity AND
    // 2. Order is Queued, REC, or any active status (not terminal)
    // Note: DON and ACK are already handled above
    // More permissive: if order has remaining quantity and is not terminal, allow cancellation
    const result = (isQueued || isActiveStatus || (qtyRemaining > 0 && !isTerminal));
    
    // Additional check: if order has remaining quantity and is not explicitly terminal, allow cancellation
    // This ensures we don't miss any cancellable orders
    const canCancelPermissive = qtyRemaining > 0 && !isTerminal;
    
    if (result || canCancelPermissive) {
      console.log('✅ Order can be cancelled:', {
        OrderID: order.OrderID,
        Status: status,
        StatusDescription: statusDesc,
        QuantityRemaining: qtyRemaining,
        isTerminal,
        result,
        canCancelPermissive
      });
    } else {
      console.log('❌ Order cannot be cancelled:', {
        OrderID: order.OrderID,
        Status: status,
        StatusDescription: statusDesc,
        QuantityRemaining: qtyRemaining,
        isTerminal,
        isQueued,
        isActiveStatus
      });
    }
    
    return result || canCancelPermissive;
  };

  // Cancel order handler - optimized for immediate UI feedback
  const handleCancelOrder = useCallback(async (orderId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Early return check BEFORE setting state
    if (cancelingOrders.has(orderId)) return; // Already canceling
    
    // CRITICAL: Set loading state IMMEDIATELY and synchronously
    setCancelingOrders(prev => {
      if (prev.has(orderId)) return prev; // Already processing
      const newSet = new Set(prev);
      newSet.add(orderId);
      return newSet;
    });
    
    // Force a microtask to ensure state is updated before async work
    // This ensures the button's disabled state is applied immediately
    await Promise.resolve();
    
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/orders/${encodeURIComponent(orderId)}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log(`✅ Order ${orderId} cancelled successfully`);
        // Order will be removed from list via WebSocket update
      } else {
        alert(`Failed to cancel order: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      console.error(`❌ Error cancelling order ${orderId}:`, err);
      alert(`Error cancelling order: ${err.message || 'Unknown error'}`);
    } finally {
      // Always clean up loading state
      setCancelingOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        return newSet;
      });
    }
  }, [cancelingOrders, fetchWithAuth]);

  return (
    <div className="h-full flex flex-col bg-[#14130e]">
      {/* Header */}
      <div className="p-4 border-b border-[#2a2820]/50 bg-gradient-to-r from-[#14130e] to-[#0f0e0a] backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#eae9e9] tracking-wider uppercase">Orders</h2>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-[#22c55e] shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-[#f87171] shadow-[0_0_6px_rgba(248,113,113,0.5)]'}`}></div>
              <span className="text-xs text-[#eae9e9]/80 font-medium">{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            {ordersArray.length > 0 && (
              <span className="text-xs text-[#eae9e9]/70 ml-2">({ordersArray.length} orders)</span>
            )}
          </div>
        </div>
      </div>

      {/* Error - not during initial loading */}
      {error && !loading && (
        <div className="mx-3 mt-3 bg-[#3a1e1e] border border-[#f87171] rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <svg className="w-4 h-4 text-[#f87171]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-[#f87171]">{error}</p>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center space-y-3">
              <div className="w-6 h-6 border-2 border-[#2a2820] border-t-[#808080] rounded-full animate-spin"></div>
              <p className="text-xs text-[#808080] uppercase tracking-wider">Connecting</p>
            </div>
          </div>
        ) : ordersArray.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#2a2820] rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-[#eae9e9] mb-2">No orders yet</h3>
              <p className="opacity-60 text-sm">Waiting for orders from WebSocket...</p>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="bg-[#14130e] border-b border-[#2a2820] px-4 py-2 sticky top-0 z-10">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium opacity-60 uppercase tracking-wide">
                <div className="col-span-1 text-right">Order ID</div>
                <div className="col-span-1">Symbol</div>
                <div className="col-span-1 text-center">Side</div>
                <div className="col-span-1 text-right">Qty</div>
                <div className="col-span-1 text-right">Remain</div>
                <div className="col-span-1 text-right">Type</div>
                <div className="col-span-1 text-right">Limit</div>
                <div className="col-span-1 text-right">Filled</div>
                <div className="col-span-2 text-left">Status</div>
                <div className="col-span-1 text-right">Opened</div>
                <div className="col-span-1 text-center">Action</div>
              </div>
            </div>

            {/* List */}
            <div className="flex-1">
              <Virtuoso
                style={{ height: '100%' }}
                data={ordersArray}
                overscan={200}
                itemContent={(index, order) => {
                  const leg = order.Legs && order.Legs.length > 0 ? order.Legs[0] : undefined;
                  const isBuy = leg?.BuyOrSell === 'Buy';
                  const canCancel = canCancelOrder(order);
                  const isCanceling = cancelingOrders.has(order.OrderID);
                  
                  // Debug logging for orders with DON, ACK, or Queued status
                  if (order.Status === 'DON' || order.Status === 'ACK' || 
                      order.StatusDescription?.toUpperCase().includes('QUEUED')) {
                    console.log('🔍 Order cancel check:', {
                      OrderID: order.OrderID,
                      Status: order.Status,
                      StatusDescription: order.StatusDescription,
                      QuantityRemaining: leg?.QuantityRemaining,
                      canCancel,
                      hasLeg: !!leg
                    });
                  }
                  
                  return (
                    <div
                      key={order.OrderID}
                      className={`px-4 py-2 border-b border-[#2a2820] hover:bg-[#1e1d17] transition-colors ${
                        index % 2 === 0 ? 'bg-[#0f0e0a]' : 'bg-[#14130e]'
                      }`}
                    >
                      <div className="grid grid-cols-12 gap-2 items-center text-sm">
                        <div className="col-span-1 text-right">
                          <div className="text-[#eae9e9] font-mono text-xs">{order.OrderID}</div>
                        </div>
                        <div className="col-span-1">
                          <div className="font-semibold text-[#eae9e9]">{leg?.Symbol || '—'}</div>
                          <div className="text-xs opacity-60">{leg?.AssetType || '—'}</div>
                        </div>
                        <div className="col-span-1 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            isBuy ? 'bg-[#1e3a2e] text-[#4ade80]' : 'bg-[#3a1e1e] text-[#f87171]'
                          }`}>
                            {leg?.BuyOrSell || '—'}
                          </span>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="text-[#eae9e9] font-mono">{formatQty(leg?.QuantityOrdered)}</div>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="text-[#eae9e9] font-mono">{formatQty(leg?.QuantityRemaining)}</div>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="text-[#eae9e9] font-mono text-xs">{order.OrderType}</div>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="text-[#eae9e9] font-mono text-xs">{formatPrice(order.LimitPrice)}</div>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="text-[#eae9e9] font-mono text-xs">{formatPrice(order.FilledPrice)}</div>
                        </div>
                        <div className="col-span-2 text-left">
                          <div className="text-[#eae9e9] text-xs font-medium">{order.StatusDescription}</div>
                          <div className="opacity-60 text-[11px]">{order.Status}</div>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="opacity-60 text-xs font-mono">{formatDate(order.OpenedDateTime)}</div>
                        </div>
                        <div className="col-span-1 text-center">
                          {canCancel ? (
                            <button
                              onClick={(e) => handleCancelOrder(order.OrderID, e)}
                              disabled={isCanceling}
                              className="px-2 py-1 text-xs font-semibold rounded transition-all duration-75 bg-[#f87171] hover:bg-[#ef4444] active:scale-95 text-[#14130e] disabled:bg-[#2a2820] disabled:text-[#eae9e9] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                              title={isCanceling ? 'Cancelling...' : 'Cancel order'}
                            >
                              {isCanceling ? (
                                <svg className="animate-spin h-3 w-3 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              ) : (
                                'Cancel'
                              )}
                            </button>
                          ) : (
                            <span className="text-xs text-[#808080] opacity-50">—</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrdersSection;


