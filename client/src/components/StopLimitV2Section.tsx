import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';

interface StopLimitV2Snapshot {
  symbol: string;
  groupKey: string;
  groupLabel: string;
  avgPrice: number;
  quantity: number;
  stageIndex: number;
  stageLabel: string;
  stageDescription: string;
  stopPrice: number | null;
  limitPrice: number | null;
  orderId: string | null;
  orderStatus: string | null;
  unrealizedQty: number | null;
  progress: number | null;
  status: string; // 'active' or 'sold'
  statusLabel: string;
  createdAt: number | null;
  updatedAt: number | null;
  // Sold fields
  sellPrice?: number;
  pnlPerShare?: number;
  totalPnL?: number;
  soldAt?: number;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const StopLimitV2Section: React.FC = () => {
  const { fetchWithAuth } = useAuth();
  const [rows, setRows] = useState<StopLimitV2Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshIntervalRef = useRef<number | null>(null);

  const fetchSnapshot = async () => {
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/stoplimit/v2/snapshot`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setRows(data.data || []);
        setError(null);
      } else {
        throw new Error(data.error || 'Failed to load data');
      }
    } catch (err: any) {
      console.error('Error fetching V2 snapshot:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSnapshot();
    refreshIntervalRef.current = window.setInterval(fetchSnapshot, 1000); // Realtime polling

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '-';
    return `$${val.toFixed(2)}`;
  };

  const formatNumber = (val: number | null | undefined, decimals = 2) => {
    if (val === null || val === undefined) return '-';
    return val.toFixed(decimals);
  };

  return (
    <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9]">
      <div className="p-4 border-b border-[#2a2820] bg-[#1e1e1e]">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-[#eae9e9]">POSITION STOPLIMIT STATUS (V2)</h2>
            <p className="text-xs text-[#808080]">Realtime automated StopLimit tracking</p>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-[#808080]">{rows.length} records</span>
            <div className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse"></div>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-2 bg-[#3a1e1e] text-[#f87171] text-xs text-center border-b border-[#f87171]/20">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs text-left border-collapse">
          <thead className="bg-[#1a1915] sticky top-0 z-10">
            <tr>
              <th className="p-3 border-b border-[#2a2820] font-medium text-[#808080]">Symbol</th>
              <th className="p-3 border-b border-[#2a2820] font-medium text-[#808080]">Status</th>
              <th className="p-3 border-b border-[#2a2820] font-medium text-[#808080] text-right">Qty</th>
              <th className="p-3 border-b border-[#2a2820] font-medium text-[#808080] text-right">Avg Price</th>
              <th className="p-3 border-b border-[#2a2820] font-medium text-[#808080] text-right">Stop</th>
              <th className="p-3 border-b border-[#2a2820] font-medium text-[#808080] text-right">Limit</th>
              <th className="p-3 border-b border-[#2a2820] font-medium text-[#808080] text-center">Stage</th>
              <th className="p-3 border-b border-[#2a2820] font-medium text-[#808080] text-right">Unrealized P&L</th>
              <th className="p-3 border-b border-[#2a2820] font-medium text-[#808080] text-right">Total P&L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2820]/30">
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-[#808080]">Loading...</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-[#808080]">No positions tracked.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.symbol} className="hover:bg-[#1e1d17] transition-colors">
                  <td className="p-3 font-bold text-[#eae9e9]">{row.symbol}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                      row.status === 'sold' 
                        ? 'bg-[#1e3a2e] text-[#4ade80] border border-[#4ade80]/20' 
                        : 'bg-[#1e313a] text-[#38bdf8] border border-[#38bdf8]/20'
                    }`}>
                      {row.status === 'sold' ? 'CLOSED' : 'ACTIVE'}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono">{row.quantity.toLocaleString()}</td>
                  <td className="p-3 text-right font-mono">{formatCurrency(row.avgPrice)}</td>
                  <td className="p-3 text-right font-mono text-[#facc15]">{formatCurrency(row.stopPrice)}</td>
                  <td className="p-3 text-right font-mono text-[#facc15]">{formatCurrency(row.limitPrice)}</td>
                  <td className="p-3 text-center">
                    <div className="flex flex-col items-center">
                      <span className="font-bold">{row.stageLabel}</span>
                      {row.progress !== null && row.status !== 'sold' && (
                        <div className="w-16 h-1 bg-[#2a2820] rounded-full mt-1 overflow-hidden">
                          <div 
                            className="h-full bg-[#4ade80]" 
                            style={{ width: `${Math.min(Math.max((row.progress || 0) * 100, 0), 100)}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono">
                    {row.status !== 'sold' ? (
                      <span className={((row.unrealizedQty || 0) >= 0) ? 'text-[#4ade80]' : 'text-[#f87171]'}>
                        {formatCurrency(row.unrealizedQty)}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="p-3 text-right font-mono font-bold">
                    {row.status === 'sold' ? (
                      <span className={((row.totalPnL || 0) >= 0) ? 'text-[#4ade80]' : 'text-[#f87171]'}>
                        {formatCurrency(row.totalPnL)}
                      </span>
                    ) : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StopLimitV2Section;

