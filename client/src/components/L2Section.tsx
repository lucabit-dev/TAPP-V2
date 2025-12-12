import React from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';

interface L2Data {
  symbol: string;
  timestamp: string;
  bids: Array<{
    price: number;
    quantity: number;
    earliestTime?: string;
    latestTime?: string;
    side?: string;
    biggestSize?: number;
    smallestSize?: number;
    numParticipants?: number;
    totalOrderCount?: number;
    raw?: any;
  }>;
  asks: Array<{
    price: number;
    quantity: number;
    earliestTime?: string;
    latestTime?: string;
    side?: string;
    biggestSize?: number;
    smallestSize?: number;
    numParticipants?: number;
    totalOrderCount?: number;
    raw?: any;
  }>;
  spread: number | null;
  midPrice: number | null;
  raw?: any;
}

interface L2Status {
  isConnected: boolean;
  symbol: string | null;
  error: string | null;
}

const L2Section: React.FC = () => {
  const [symbol, setSymbol] = React.useState<string>('MSFT');
  const [inputSymbol, setInputSymbol] = React.useState<string>('MSFT');
  const [l2Data, setL2Data] = React.useState<L2Data | null>(null);
  const [status, setStatus] = React.useState<L2Status>({ isConnected: false, symbol: null, error: null });
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [showRawData, setShowRawData] = React.useState(false); // Hide raw data by default now that we know the structure
  const wsRef = React.useRef<WebSocket | null>(null);

  // Load initial status
  React.useEffect(() => {
    const loadStatus = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/l2/status`);
        const data = await res.json();
        if (data.success && data.data) {
          setStatus({
            isConnected: data.data.isConnected || false,
            symbol: data.data.symbol || null,
            error: null
          });
          if (data.data.symbol) {
            setSymbol(data.data.symbol);
            setInputSymbol(data.data.symbol);
          }
        }
      } catch (e) {
        console.error('Failed to load L2 status', e);
      }
    };
    loadStatus();
  }, []);

  // WebSocket connection for real-time updates
  React.useEffect(() => {
    try {
      wsRef.current = new WebSocket(WS_BASE_URL);
      wsRef.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'L2_DATA' && msg.data) {
            console.log('[L2 Frontend] Received L2_DATA:', msg.data);
            console.log('[L2 Frontend] Raw message structure:', {
              hasBids: !!msg.data.bids,
              hasAsks: !!msg.data.asks,
              bidsCount: msg.data.bids?.length || 0,
              asksCount: msg.data.asks?.length || 0,
              rawKeys: msg.data.raw ? Object.keys(msg.data.raw) : []
            });
            setL2Data(msg.data as L2Data);
          } else if (msg.type === 'L2_STATUS' && msg.data) {
            setStatus(msg.data as L2Status);
            setIsConnecting(false);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      wsRef.current.onclose = () => {
        console.log('WebSocket closed, attempting to reconnect...');
        // Attempt to reconnect after a delay
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.CLOSED) {
            try {
              wsRef.current = new WebSocket(WS_BASE_URL);
            } catch (e) {
              console.error('Failed to reconnect WebSocket:', e);
            }
          }
        }, 3000);
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleConnect = async () => {
    const cleanSymbol = inputSymbol.trim().toUpperCase();
    if (!cleanSymbol) {
      alert('Please enter a symbol');
      return;
    }

    setIsConnecting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/l2/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: cleanSymbol })
      });
      const data = await res.json();
      if (data.success) {
        setSymbol(cleanSymbol);
        setStatus({
          isConnected: data.data.isConnected || false,
          symbol: cleanSymbol,
          error: data.data.error || null
        });
      } else {
        alert(`Failed to connect: ${data.error || 'Unknown error'}`);
        setIsConnecting(false);
      }
    } catch (error) {
      console.error('Failed to connect to L2 stream:', error);
      alert('Failed to connect to L2 stream');
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/l2/disconnect`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        setStatus({ isConnected: false, symbol: null, error: null });
        setL2Data(null);
      }
    } catch (error) {
      console.error('Failed to disconnect L2 stream:', error);
    }
  };

  const formatNumber = (num: number | null | undefined, decimals: number = 2): string => {
    if (num === null || num === undefined) return 'N/A';
    return num.toFixed(decimals);
  };

  const formatQuantity = (qty: number | null | undefined): string => {
    if (qty === null || qty === undefined) return 'N/A';
    if (qty >= 1000000) return `${(qty / 1000000).toFixed(2)}M`;
    if (qty >= 1000) return `${(qty / 1000).toFixed(2)}K`;
    return qty.toFixed(0);
  };

  // Get top N levels for display (default 20 for better visibility)
  const displayLevels = 20;
  const topBids = l2Data?.bids.slice(0, displayLevels) || [];
  const topAsks = l2Data?.asks.slice(0, displayLevels) || [];
  
  // Show all levels if there are fewer than displayLevels
  const allBids = l2Data?.bids || [];
  const allAsks = l2Data?.asks || [];

  return (
    <div className="h-full flex flex-col bg-[#14130e]">
      {/* Header */}
      <div className="p-4 border-b border-[#2a2820]/50 bg-gradient-to-r from-[#14130e] to-[#0f0e0a] flex items-center justify-between backdrop-blur-sm">
        <div className="flex items-center space-x-4">
          <h2 className="text-sm font-bold text-[#eae9e9] tracking-wider uppercase">L2 Market Depth</h2>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={inputSymbol}
              onChange={(e) => setInputSymbol(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && handleConnect()}
              placeholder="Symbol"
              className="px-3 py-1 text-xs bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#22c55e]/50 w-24"
              disabled={isConnecting || status.isConnected}
            />
            {!status.isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className={`px-3 py-1 text-xs rounded font-bold transition-all ${
                  isConnecting
                    ? 'bg-[#2a2820] text-[#808080] cursor-not-allowed'
                    : 'bg-[#22c55e] text-[#14130e] hover:bg-[#16a34a] shadow-[0_0_8px_rgba(34,197,94,0.3)]'
                }`}
              >
                {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="px-3 py-1 text-xs rounded font-bold bg-[#f87171] text-[#14130e] hover:bg-[#ef4444] shadow-[0_0_8px_rgba(248,113,113,0.3)] transition-all"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <div className={`flex items-center space-x-2 text-xs ${status.isConnected ? 'text-[#22c55e]' : 'text-[#808080]'}`}>
            <div className={`w-2 h-2 rounded-full ${status.isConnected ? 'bg-[#22c55e] animate-pulse' : 'bg-[#808080]'}`}></div>
            <span>{status.isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          {status.symbol && (
            <div className="text-xs text-[#eae9e9]/80">
              Symbol: <span className="font-bold text-[#4ade80]">{status.symbol}</span>
            </div>
          )}
        </div>
      </div>

      {/* Error message */}
      {status.error && (
        <div className="p-3 bg-[#f87171]/20 border-b border-[#f87171]/50 text-[#f87171] text-xs">
          Error: {status.error}
        </div>
      )}

      {/* Market Depth Display */}
      <div className="flex-1 overflow-y-auto p-4">
        {!status.isConnected ? (
          <div className="h-full flex items-center justify-center text-[#808080] text-sm">
            {status.error ? `Connection error: ${status.error}` : 'Not connected. Enter a symbol and click Connect to start.'}
          </div>
        ) : !l2Data ? (
          <div className="h-full flex items-center justify-center text-[#808080] text-sm">
            Waiting for market depth data...
          </div>
        ) : (
          <div className="max-w-6xl mx-auto">
            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-[#0f0e0a] border border-[#2a2820] rounded p-3">
                <div className="text-xs text-[#808080] mb-1">Mid Price</div>
                <div className="text-lg font-bold text-[#eae9e9] font-mono">
                  {l2Data.midPrice !== null ? `$${formatNumber(l2Data.midPrice)}` : 'N/A'}
                </div>
              </div>
              <div className="bg-[#0f0e0a] border border-[#2a2820] rounded p-3">
                <div className="text-xs text-[#808080] mb-1">Spread</div>
                <div className="text-lg font-bold text-[#facc15] font-mono">
                  {l2Data.spread !== null ? `$${formatNumber(l2Data.spread)}` : 'N/A'}
                </div>
              </div>
              <div className="bg-[#0f0e0a] border border-[#2a2820] rounded p-3">
                <div className="text-xs text-[#808080] mb-1">Last Update</div>
                <div className="text-sm font-mono text-[#eae9e9]">
                  {new Date(l2Data.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>

            {/* Market Depth Table */}
            <div className="grid grid-cols-2 gap-4">
              {/* Asks (Sell Side) */}
              <div>
                <div className="bg-[#0f0e0a] border border-[#2a2820] rounded">
                  <div className="p-3 border-b border-[#2a2820] bg-[#f87171]/10 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[#f87171] uppercase tracking-wider">Asks (Sell)</h3>
                    <span className="text-xs text-[#808080]">{allAsks.length} levels</span>
                  </div>
                  <div className="overflow-y-auto max-h-[600px]">
                    <table className="w-full text-xs">
                      <thead className="bg-[#14130e] sticky top-0">
                        <tr>
                          <th className="p-2 text-left text-[#808080] font-medium">Price</th>
                          <th className="p-2 text-right text-[#808080] font-medium">Size</th>
                          <th className="p-2 text-right text-[#808080] font-medium">Orders</th>
                          <th className="p-2 text-right text-[#808080] font-medium">Participants</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topAsks.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="p-4 text-center text-[#808080]">
                              No ask data available
                            </td>
                          </tr>
                        ) : (
                          topAsks.map((ask, idx) => (
                            <tr
                              key={idx}
                              className="border-b border-[#2a2820]/50 hover:bg-[#1a1915]/50 transition-colors"
                            >
                              <td className="p-2 font-mono font-bold text-[#f87171]">
                                ${formatNumber(ask.price)}
                              </td>
                              <td className="p-2 text-right font-mono text-[#eae9e9]">
                                {formatQuantity(ask.quantity)}
                              </td>
                              <td className="p-2 text-right font-mono text-[#808080] text-[10px]" title={`Total Orders: ${ask.totalOrderCount}`}>
                                {ask.totalOrderCount !== undefined ? ask.totalOrderCount : '-'}
                              </td>
                              <td className="p-2 text-right font-mono text-[#808080] text-[10px]" title={`Participants: ${ask.numParticipants}`}>
                                {ask.numParticipants !== undefined ? ask.numParticipants : '-'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Bids (Buy Side) */}
              <div>
                <div className="bg-[#0f0e0a] border border-[#2a2820] rounded">
                  <div className="p-3 border-b border-[#2a2820] bg-[#22c55e]/10 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[#22c55e] uppercase tracking-wider">Bids (Buy)</h3>
                    <span className="text-xs text-[#808080]">{allBids.length} levels</span>
                  </div>
                  <div className="overflow-y-auto max-h-[600px]">
                    <table className="w-full text-xs">
                      <thead className="bg-[#14130e] sticky top-0">
                        <tr>
                          <th className="p-2 text-left text-[#808080] font-medium">Price</th>
                          <th className="p-2 text-right text-[#808080] font-medium">Size</th>
                          <th className="p-2 text-right text-[#808080] font-medium">Orders</th>
                          <th className="p-2 text-right text-[#808080] font-medium">Participants</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topBids.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="p-4 text-center text-[#808080]">
                              No bid data available
                            </td>
                          </tr>
                        ) : (
                          topBids.map((bid, idx) => (
                            <tr
                              key={idx}
                              className="border-b border-[#2a2820]/50 hover:bg-[#1a1915]/50 transition-colors"
                            >
                              <td className="p-2 font-mono font-bold text-[#22c55e]">
                                ${formatNumber(bid.price)}
                              </td>
                              <td className="p-2 text-right font-mono text-[#eae9e9]">
                                {formatQuantity(bid.quantity)}
                              </td>
                              <td className="p-2 text-right font-mono text-[#808080] text-[10px]" title={`Total Orders: ${bid.totalOrderCount}`}>
                                {bid.totalOrderCount !== undefined ? bid.totalOrderCount : '-'}
                              </td>
                              <td className="p-2 text-right font-mono text-[#808080] text-[10px]" title={`Participants: ${bid.numParticipants}`}>
                                {bid.numParticipants !== undefined ? bid.numParticipants : '-'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Data Statistics */}
            <div className="mt-4 grid grid-cols-2 gap-4 mb-4">
              <div className="bg-[#0f0e0a] border border-[#2a2820] rounded p-3">
                <div className="text-xs text-[#808080] mb-1">Bids Count</div>
                <div className="text-lg font-bold text-[#22c55e] font-mono">
                  {l2Data.bids.length}
                </div>
              </div>
              <div className="bg-[#0f0e0a] border border-[#2a2820] rounded p-3">
                <div className="text-xs text-[#808080] mb-1">Asks Count</div>
                <div className="text-lg font-bold text-[#f87171] font-mono">
                  {l2Data.asks.length}
                </div>
              </div>
            </div>

            {/* Raw Data Display (prominent for debugging) */}
            {l2Data.raw && (
              <div className="mt-4 bg-[#0f0e0a] border border-[#2a2820] rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-[#eae9e9] uppercase tracking-wider">Raw Data Structure</h4>
                  <button
                    onClick={() => setShowRawData(!showRawData)}
                    className="text-xs text-[#808080] hover:text-[#eae9e9] transition-colors"
                  >
                    {showRawData ? 'Hide' : 'Show'}
                  </button>
                </div>
                {showRawData && (
                  <div className="mt-2">
                    <div className="mb-2 text-xs text-[#808080]">
                      <strong>Raw Message Keys:</strong> {Object.keys(l2Data.raw).join(', ')}
                    </div>
                    <pre className="text-xs text-[#eae9e9] overflow-x-auto bg-[#14130e] p-3 rounded border border-[#2a2820] max-h-96 overflow-y-auto">
                      {JSON.stringify(l2Data.raw, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default L2Section;
