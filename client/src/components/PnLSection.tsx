import React from 'react';
import { Virtuoso } from 'react-virtuoso';

interface Position {
  PositionID: string;
  AccountID: string;
  Symbol: string;
  LongShort: string;
  AssetType: string;
  Quantity: string;
  ConversionRate: string;
  AveragePrice: string;
  Bid: string;
  Last: string;
  Ask: string;
  MarketValue: string;
  Timestamp: string;
  InitialRequirement: string;
  DayTradeRequirement: string;
  MaintenanceMargin: string;
  TotalCost: string;
  UnrealizedProfitLoss: string;
  UnrealizedProfitLossQty: string;
  UnrealizedProfitLossPercent: string;
  TodaysProfitLoss: string;
  MarkToMarketPrice: string;
}

const PnLSection: React.FC = () => {
  const [positions, setPositions] = React.useState<Map<string, Position>>(new Map());
  const [isConnected, setIsConnected] = React.useState(false);
  // Connect to Railway backend proxy (API key is handled server-side)
  const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';
  const [loading, setLoading] = React.useState(true); // Start with loading true
  const [initialLoad, setInitialLoad] = React.useState(true); // Track initial connection attempt
  const [error, setError] = React.useState<string | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const connectionTimeoutRef = React.useRef<number | null>(null);

  const connectWebSocket = React.useCallback(() => {
    // Clear any existing connection timeout
    if (connectionTimeoutRef.current) {
      window.clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    // Connect to Railway backend proxy (no API key needed - handled server-side)
    const url = `${WS_BASE_URL}/ws/positions`;
    console.log('🔌 Connecting to positions WebSocket proxy:', url);
    
    try {
      setLoading(true);
      
      // Only clear error if not initial load (to avoid flashing errors)
      if (!initialLoad) {
        setError(null);
      }
      
      const ws = new WebSocket(url);
      wsRef.current = ws;

      // Set a timeout for initial connection attempt (10 seconds)
      if (initialLoad) {
        connectionTimeoutRef.current = window.setTimeout(() => {
          // Check if still not connected after timeout
          if (wsRef.current?.readyState !== WebSocket.OPEN) {
            setInitialLoad(false);
            setLoading(false);
            setError('Connection timeout. Please check your connection and try again.');
          }
        }, 10000);
      }

      ws.onopen = () => {
        console.log('✅ Connected to positions WebSocket');
        setIsConnected(true);
        setLoading(false);
        setInitialLoad(false);
        setError(null);
        reconnectAttemptsRef.current = 0;
        
        // Clear connection timeout
        if (connectionTimeoutRef.current) {
          window.clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Skip heartbeat messages
          if (data.Heartbeat) {
            return;
          }

          // Handle position updates
          if (data.PositionID) {
            const position: Position = data;
            setPositions(prev => {
              const newMap = new Map(prev);
              newMap.set(position.PositionID, position);
              return newMap;
            });
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        console.error('Attempted connection URL:', url);
        // Only show error after initial load is complete
        if (!initialLoad) {
          setError('Connection error. Reconnecting...');
        }
        setIsConnected(false);
        
        // Don't set loading to false during initial load
        if (!initialLoad) {
          setLoading(false);
        }
      };

      ws.onclose = (event) => {
        console.log('🔌 WebSocket connection closed', event.code, event.reason || '');
        setIsConnected(false);
        
        // Clear connection timeout
        if (connectionTimeoutRef.current) {
          window.clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        
        // Only set loading to false and show error if not initial load
        if (!initialLoad) {
          setLoading(false);
          if (event.code !== 1000) {
            setError('Connection closed. Reconnecting...');
          }
        }
        
        // Only reconnect if it wasn't a manual close
        if (event.code !== 1000) {
          const attempts = reconnectAttemptsRef.current + 1;
          reconnectAttemptsRef.current = attempts;
          const delay = Math.min(15000, 1000 * Math.pow(2, attempts - 1));
          
          if (reconnectTimerRef.current) {
            window.clearTimeout(reconnectTimerRef.current);
          }
          reconnectTimerRef.current = window.setTimeout(() => {
            connectWebSocket();
          }, delay);
        }
      };
    } catch (err) {
      console.error('Failed to connect to WebSocket:', err);
      setInitialLoad(false);
      setLoading(false);
      setError('Failed to connect. Please try again.');
    }
  }, [WS_BASE_URL, initialLoad]);

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

  // Auto-connect on mount
  React.useEffect(() => {
    connectWebSocket();
    return () => {
      disconnectWebSocket();
    };
  }, [connectWebSocket, disconnectWebSocket]);

  const positionsArray = Array.from(positions.values()).sort((a, b) => {
    // Sort by Symbol alphabetically
    return a.Symbol.localeCompare(b.Symbol);
  });

  const formatPrice = (price: string): string => {
    const num = parseFloat(price);
    if (isNaN(num)) return 'N/A';
    return `$${num.toFixed(2)}`;
  };

  const formatQuantity = (qty: string): string => {
    const num = parseFloat(qty);
    if (isNaN(num)) return 'N/A';
    return num.toLocaleString();
  };

  const formatPercent = (percent: string): string => {
    const num = parseFloat(percent);
    if (isNaN(num)) return 'N/A';
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString();
    } catch {
      return timestamp;
    }
  };

  const totalUnrealizedPL = positionsArray.reduce((sum, pos) => {
    const pl = parseFloat(pos.UnrealizedProfitLoss);
    return sum + (isNaN(pl) ? 0 : pl);
  }, 0);

  const totalTodaysPL = positionsArray.reduce((sum, pos) => {
    const pl = parseFloat(pos.TodaysProfitLoss);
    return sum + (isNaN(pl) ? 0 : pl);
  }, 0);

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      {/* Header */}
      <div className="p-3 border-b border-[#3e3e42] bg-[#252526]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#cccccc] tracking-wide">P&L - Active Positions</h2>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#4ec9b0]' : 'bg-[#f44747]'}`}></div>
            <span className="text-xs text-[#969696]">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            {positionsArray.length > 0 && (
              <span className="text-xs text-[#969696] ml-2">
                ({positionsArray.length} positions)
              </span>
            )}
          </div>
        </div>
        

        {/* Summary Stats */}
        {positionsArray.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#3e3e42] grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-[#969696] mb-1">Total Unrealized P&L</div>
              <div className={`text-sm font-semibold ${totalUnrealizedPL >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                {formatPrice(totalUnrealizedPL.toString())}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#969696] mb-1">Today's P&L</div>
              <div className={`text-sm font-semibold ${totalTodaysPL >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                {formatPrice(totalTodaysPL.toString())}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#969696] mb-1">Market Value</div>
              <div className="text-sm font-semibold text-[#cccccc]">
                {formatPrice(positionsArray.reduce((sum, pos) => {
                  const mv = parseFloat(pos.MarketValue);
                  return sum + (isNaN(mv) ? 0 : mv);
                }, 0).toString())}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error Message - Only show if not loading */}
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

      {/* Positions Table */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#2d2d30] rounded-lg flex items-center justify-center mx-auto mb-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4ec9b0]"></div>
              </div>
              <h3 className="text-lg font-medium text-[#cccccc] mb-2">Connecting...</h3>
              <p className="text-[#969696] text-sm">
                Establishing WebSocket connection...
              </p>
            </div>
          </div>
        ) : positionsArray.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#2d2d30] rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-[#808080]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-[#cccccc] mb-2">No positions yet</h3>
              <p className="text-[#969696] text-sm">
                {isConnected 
                  ? 'Waiting for position data from WebSocket...'
                  : 'Connection established. Waiting for position updates...'
                }
              </p>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Table Header */}
            <div className="bg-[#252526] border-b border-[#3e3e42] px-4 py-2 sticky top-0 z-10">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-[#969696] uppercase tracking-wide">
                <div className="col-span-2">Symbol</div>
                <div className="col-span-1 text-center">Side</div>
                <div className="col-span-1 text-right">Qty</div>
                <div className="col-span-1 text-right">Avg Price</div>
                <div className="col-span-1 text-right">Last</div>
                <div className="col-span-1 text-right">Market Value</div>
                <div className="col-span-2 text-right">Unrealized P&L</div>
                <div className="col-span-1 text-right">P&L %</div>
                <div className="col-span-1 text-right">Today's P&L</div>
                <div className="col-span-1 text-right">Time</div>
              </div>
            </div>

            {/* Table Body - Virtualized */}
            <div className="flex-1">
              <Virtuoso
                style={{ height: '100%' }}
                data={positionsArray}
                overscan={200}
                itemContent={(index, position) => {
                  const unrealizedPL = parseFloat(position.UnrealizedProfitLoss);
                  const unrealizedPLPercent = parseFloat(position.UnrealizedProfitLossPercent);
                  const todaysPL = parseFloat(position.TodaysProfitLoss);
                  const isLong = position.LongShort === 'Long';
                  
                  return (
                    <div
                      key={position.PositionID}
                      className={`px-4 py-2 border-b border-[#3e3e42] hover:bg-[#252526] transition-colors ${
                        index % 2 === 0 ? 'bg-[#1e1e1e]' : 'bg-[#252526]'
                      }`}
                    >
                      <div className="grid grid-cols-12 gap-2 items-center text-sm">
                        {/* Symbol */}
                        <div className="col-span-2">
                          <div className="font-semibold text-[#cccccc]">{position.Symbol}</div>
                          <div className="text-xs text-[#808080]">{position.AssetType}</div>
                        </div>

                        {/* Side */}
                        <div className="col-span-1 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            isLong ? 'bg-[#0d3a2e] text-[#4ec9b0]' : 'bg-[#5a1d1d] text-[#f44747]'
                          }`}>
                            {position.LongShort}
                          </span>
                        </div>

                        {/* Quantity */}
                        <div className="col-span-1 text-right">
                          <div className="text-[#cccccc] font-mono">{formatQuantity(position.Quantity)}</div>
                        </div>

                        {/* Average Price */}
                        <div className="col-span-1 text-right">
                          <div className="text-[#cccccc] font-mono text-xs">{formatPrice(position.AveragePrice)}</div>
                        </div>

                        {/* Last */}
                        <div className="col-span-1 text-right">
                          <div className="text-[#cccccc] font-mono text-xs">{formatPrice(position.Last)}</div>
                        </div>

                        {/* Market Value */}
                        <div className="col-span-1 text-right">
                          <div className="text-[#cccccc] font-mono text-xs">{formatPrice(position.MarketValue)}</div>
                        </div>

                        {/* Unrealized P&L */}
                        <div className="col-span-2 text-right">
                          <div className={`font-semibold font-mono ${unrealizedPL >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                            {formatPrice(position.UnrealizedProfitLoss)}
                          </div>
                          <div className={`text-xs font-mono ${unrealizedPL >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                            {formatPrice(position.UnrealizedProfitLossQty)}
                          </div>
                        </div>

                        {/* P&L % */}
                        <div className="col-span-1 text-right">
                          <div className={`font-semibold font-mono ${unrealizedPLPercent >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                            {formatPercent(position.UnrealizedProfitLossPercent)}
                          </div>
                        </div>

                        {/* Today's P&L */}
                        <div className="col-span-1 text-right">
                          <div className={`font-semibold font-mono text-xs ${todaysPL >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                            {formatPrice(position.TodaysProfitLoss)}
                          </div>
                        </div>

                        {/* Time */}
                        <div className="col-span-1 text-right">
                          <div className="text-xs text-[#969696] font-mono">{formatTimestamp(position.Timestamp)}</div>
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

export default PnLSection;

