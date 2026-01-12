import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';

interface StopLimitV2Position {
  symbol: string;
  avgPrice: number;
  quantity: number;
  currentPrice: number;
  pnl: number;
  group: string;
  stage: string;
  nextStage: string;
  stopPrice: string;
  limitPrice: string;
  status: string;
  updatedAt: number;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const StopLimitV2Section: React.FC = () => {
  const { fetchWithAuth } = useAuth();
  const [positions, setPositions] = useState<StopLimitV2Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshIntervalRef = useRef<number | null>(null);

  const fetchSnapshot = async () => {
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/stoplimit/v2/snapshot`);
      const data = await response.json();
      
      if (data.success) {
        setPositions(data.data);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch snapshot');
      }
    } catch (err: any) {
      setError(err.message || 'Error fetching snapshot');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSnapshot();
    
    // Refresh every 1s for realtime feel
    refreshIntervalRef.current = window.setInterval(fetchSnapshot, 1000);
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  const formatCurrency = (val: number | string) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return isNaN(num) ? 'N/A' : `$${num.toFixed(2)}`;
  };

  const formatPnL = (val: number) => {
    return (
      <span className={val >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}>
        {val >= 0 ? '+' : ''}{formatCurrency(val)}
      </span>
    );
  };

  return (
    <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9]">
      <div className="p-4 border-b border-[#2a2820] bg-[#1e1e1e]">
        <h2 className="text-lg font-bold text-[#eae9e9]">StopLimit V2</h2>
        <p className="text-xs text-[#969696]">Real-time Position Analysis & Tracking</p>
      </div>

      {error && (
        <div className="p-4 bg-[#3a1e1e] text-[#f87171] border-b border-[#f87171]/30">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {loading && positions.length === 0 ? (
          <div className="text-center text-[#969696] mt-10">Loading positions...</div>
        ) : positions.length === 0 ? (
          <div className="text-center text-[#969696] mt-10">No active positions tracked.</div>
        ) : (
          <div className="grid gap-4">
            {positions.map((pos) => (
              <div key={pos.symbol} className={`p-4 rounded-lg border ${pos.status === 'Closed' ? 'border-[#2a2820] bg-[#1a1a1a] opacity-60' : 'border-[#4ade80]/30 bg-[#1e3a2e]/10'}`}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-xl font-bold text-[#eae9e9]">{pos.symbol}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded ${pos.status === 'Active' ? 'bg-[#4ade80]/20 text-[#4ade80]' : 'bg-[#969696]/20 text-[#969696]'}`}>
                      {pos.status}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold font-mono">{formatPnL(pos.pnl)}</div>
                    <div className="text-xs text-[#969696]">Unrealized P&L</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-[#969696] text-xs uppercase">Avg Price</div>
                    <div className="font-mono">{formatCurrency(pos.avgPrice)}</div>
                  </div>
                  <div>
                    <div className="text-[#969696] text-xs uppercase">Quantity</div>
                    <div className="font-mono">{pos.quantity}</div>
                  </div>
                  <div>
                    <div className="text-[#969696] text-xs uppercase">Stop Price</div>
                    <div className="font-mono text-[#facc15]">{formatCurrency(pos.stopPrice)}</div>
                  </div>
                  <div>
                    <div className="text-[#969696] text-xs uppercase">Limit Price</div>
                    <div className="font-mono text-[#facc15]">{formatCurrency(pos.limitPrice)}</div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#2a2820] grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[#969696] text-xs uppercase">Group</div>
                    <div>{pos.group}</div>
                  </div>
                  <div>
                    <div className="text-[#969696] text-xs uppercase">Stage</div>
                    <div className="text-[#4ade80]">{pos.stage}</div>
                    <div className="text-xs text-[#969696] mt-1">Next: {pos.nextStage}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StopLimitV2Section;

