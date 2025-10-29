import React from 'react';
import { Virtuoso } from 'react-virtuoso';

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
  Status: string; // e.g., DON
  StatusDescription: string; // e.g., Queued
  UnbundledRouteFee?: string;
}

const OrdersSection: React.FC = () => {
  const [orders, setOrders] = React.useState<Map<string, Order>>(new Map());
  const [isConnected, setIsConnected] = React.useState(false);
  const API_KEY = import.meta.env.VITE_PNL_API_KEY || '';
  const WS_BASE_URL = import.meta.env.VITE_PNL_WS_BASE_URL || 'wss://sections-bot.inbitme.com';
  const [loading, setLoading] = React.useState(true);
  const [initialLoad, setInitialLoad] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const connectionTimeoutRef = React.useRef<number | null>(null);

  const connectWebSocket = React.useCallback(() => {
    if (connectionTimeoutRef.current) {
      window.clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    if (!API_KEY) {
      setError('API key is required');
      setLoading(false);
      setInitialLoad(false);
      return;
    }

    const url = `${WS_BASE_URL}/ws/orders?api_key=${encodeURIComponent(API_KEY)}`;
    console.log('🔌 Connecting to orders WebSocket:', url.replace(API_KEY, '***'));
    
    try {
      setLoading(true);
      if (!initialLoad) setError(null);

      const ws = new WebSocket(url);
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

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Ignore heartbeats and stream status markers
          if (data.Heartbeat || data.StreamStatus) return;

          // Normalize and store by OrderID
          if (data.OrderID) {
            const order: Order = data;
            setOrders(prev => {
              const m = new Map(prev);
              m.set(order.OrderID, order);
              return m;
            });
          }
        } catch (err) {
          // Swallow parse errors in production UI
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        console.error('Attempted connection URL:', url.replace(API_KEY, '***'));
        setIsConnected(false);
        if (!initialLoad) setLoading(false);
        if (!initialLoad) setError('Connection error. Reconnecting...');
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
  }, [API_KEY, WS_BASE_URL, initialLoad]);

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

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      {/* Header */}
      <div className="p-3 border-b border-[#3e3e42] bg-[#252526]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#cccccc] tracking-wide">Orders</h2>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#4ec9b0]' : 'bg-[#f44747]'}`}></div>
            <span className="text-xs text-[#969696]">{isConnected ? 'Connected' : 'Disconnected'}</span>
            {ordersArray.length > 0 && (
              <span className="text-xs text-[#969696] ml-2">({ordersArray.length} orders)</span>
            )}
          </div>
        </div>
      </div>

      {/* Error - not during initial loading */}
      {error && !loading && (
        <div className="mx-3 mt-3 bg-[#5a1d1d] border border-[#f44747] rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <svg className="w-4 h-4 text-[#f44747]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-[#f44747]">{error}</p>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#2d2d30] rounded-lg flex items-center justify-center mx-auto mb-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4ec9b0]"></div>
              </div>
              <h3 className="text-lg font-medium text-[#cccccc] mb-2">Connecting...</h3>
              <p className="text-[#969696] text-sm">Establishing WebSocket connection...</p>
            </div>
          </div>
        ) : ordersArray.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#2d2d30] rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-[#808080]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-[#cccccc] mb-2">No orders yet</h3>
              <p className="text-[#969696] text-sm">Waiting for orders from WebSocket...</p>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="bg-[#252526] border-b border-[#3e3e42] px-4 py-2 sticky top-0 z-10">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-[#969696] uppercase tracking-wide">
                <div className="col-span-2">Symbol</div>
                <div className="col-span-1 text-center">Side</div>
                <div className="col-span-1 text-right">Qty</div>
                <div className="col-span-1 text-right">Remain</div>
                <div className="col-span-1 text-right">Type</div>
                <div className="col-span-1 text-right">Limit</div>
                <div className="col-span-1 text-right">Filled</div>
                <div className="col-span-2 text-left">Status</div>
                <div className="col-span-2 text-right">Opened</div>
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
                  return (
                    <div
                      key={order.OrderID}
                      className={`px-4 py-2 border-b border-[#3e3e42] hover:bg-[#252526] transition-colors ${
                        index % 2 === 0 ? 'bg-[#1e1e1e]' : 'bg-[#252526]'
                      }`}
                    >
                      <div className="grid grid-cols-12 gap-2 items-center text-sm">
                        <div className="col-span-2">
                          <div className="font-semibold text-[#cccccc]">{leg?.Symbol || '—'}</div>
                          <div className="text-xs text-[#808080]">{leg?.AssetType || '—'}</div>
                        </div>
                        <div className="col-span-1 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            isBuy ? 'bg-[#0d3a2e] text-[#4ec9b0]' : 'bg-[#5a1d1d] text-[#f44747]'
                          }`}>
                            {leg?.BuyOrSell || '—'}
                          </span>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="text-[#cccccc] font-mono">{formatQty(leg?.QuantityOrdered)}</div>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="text-[#cccccc] font-mono">{formatQty(leg?.QuantityRemaining)}</div>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="text-[#cccccc] font-mono text-xs">{order.OrderType}</div>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="text-[#cccccc] font-mono text-xs">{formatPrice(order.LimitPrice)}</div>
                        </div>
                        <div className="col-span-1 text-right">
                          <div className="text-[#cccccc] font-mono text-xs">{formatPrice(order.FilledPrice)}</div>
                        </div>
                        <div className="col-span-2 text-left">
                          <div className="text-[#cccccc] text-xs font-medium">{order.StatusDescription}</div>
                          <div className="text-[#808080] text-[11px]">{order.Status}</div>
                        </div>
                        <div className="col-span-2 text-right">
                          <div className="text-[#969696] text-xs font-mono">{formatDate(order.OpenedDateTime)}</div>
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


