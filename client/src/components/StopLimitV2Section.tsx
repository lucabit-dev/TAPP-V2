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
  nextStageLabel: string | null;
  nextTrigger: number | null;
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
    <div className="h-full flex flex-col bg-[#0f0e0a] text-[#eae9e9] font-sans selection:bg-[#4ade80] selection:text-[#0f0e0a]">
      <div className="p-5 border-b border-[#2a2820]/60 bg-gradient-to-r from-[#14130e] to-[#0f0e0a]">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <div className="p-2 bg-[#2a2820]/40 rounded-lg border border-[#2a2820]">
              <svg className="w-5 h-5 text-[#4ade80]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#eae9e9] tracking-wider uppercase">Position StopLimit V2</h2>
              <p className="text-xs text-[#808080] mt-0.5 font-light tracking-wide">Realtime Automated Tracking System</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="px-3 py-1 bg-[#1a1915] border border-[#2a2820] rounded-md flex items-center space-x-2">
              <span className="text-[10px] text-[#808080] uppercase tracking-wider">Active</span>
              <span className="text-xs font-mono font-bold text-[#eae9e9]">{rows.filter(r => r.status !== 'sold').length}</span>
            </div>
            <div className="px-3 py-1 bg-[#1a1915] border border-[#2a2820] rounded-md flex items-center space-x-2">
              <span className="text-[10px] text-[#808080] uppercase tracking-wider">Closed</span>
              <span className="text-xs font-mono font-bold text-[#808080]">{rows.filter(r => r.status === 'sold').length}</span>
            </div>
            <div className="w-px h-6 bg-[#2a2820] mx-2"></div>
            <div className="flex items-center space-x-2">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4ade80] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#4ade80]"></span>
              </div>
              <span className="text-[10px] text-[#4ade80] font-medium tracking-wider">LIVE</span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-2 bg-[#3a1e1e] text-[#f87171] text-xs text-center border-b border-[#f87171]/20">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto bg-[#0f0e0a]">
        <table className="w-full text-xs text-left border-collapse">
          <thead className="bg-[#14130e] sticky top-0 z-10 shadow-[0_1px_0_rgba(42,40,32,0.6)]">
            <tr>
              <th className="p-4 border-b border-[#2a2820]/60 font-semibold text-[#808080] uppercase tracking-wider text-[10px]">Symbol</th>
              <th className="p-4 border-b border-[#2a2820]/60 font-semibold text-[#808080] uppercase tracking-wider text-[10px]">Status</th>
              <th className="p-4 border-b border-[#2a2820]/60 font-semibold text-[#808080] uppercase tracking-wider text-[10px] text-right">Qty</th>
              <th className="p-4 border-b border-[#2a2820]/60 font-semibold text-[#808080] uppercase tracking-wider text-[10px] text-right">Avg Price</th>
              <th className="p-4 border-b border-[#2a2820]/60 font-semibold text-[#808080] uppercase tracking-wider text-[10px] text-right">Stop</th>
              <th className="p-4 border-b border-[#2a2820]/60 font-semibold text-[#808080] uppercase tracking-wider text-[10px] text-right">Limit</th>
              <th className="p-4 border-b border-[#2a2820]/60 font-semibold text-[#808080] uppercase tracking-wider text-[10px] text-center w-64">Stage & Progress</th>
              <th className="p-4 border-b border-[#2a2820]/60 font-semibold text-[#808080] uppercase tracking-wider text-[10px] text-right">Unrealized</th>
              <th className="p-4 border-b border-[#2a2820]/60 font-semibold text-[#808080] uppercase tracking-wider text-[10px] text-right">Total P&L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2820]/30">
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-12 text-center">
                  <div className="flex flex-col items-center space-y-3">
                    <div className="w-8 h-8 border-2 border-[#2a2820] border-t-[#4ade80] rounded-full animate-spin"></div>
                    <span className="text-[#808080] uppercase tracking-widest text-[10px]">Syncing Data...</span>
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-12 text-center">
                  <div className="flex flex-col items-center space-y-3 opacity-50">
                    <svg className="w-10 h-10 text-[#808080]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 12H4" />
                    </svg>
                    <span className="text-[#808080] uppercase tracking-widest text-[10px]">No Active Positions</span>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.symbol} className="group hover:bg-[#14130e] transition-all duration-200">
                  <td className="p-4">
                    <div className="flex items-center space-x-3">
                      <div className={`w-1 h-8 rounded-full ${row.status === 'sold' ? 'bg-[#2a2820]' : 'bg-[#4ade80]'}`}></div>
                      <div>
                        <div className="font-bold text-sm text-[#eae9e9] group-hover:text-[#4ade80] transition-colors">{row.symbol}</div>
                        <div className="text-[10px] text-[#808080] uppercase tracking-wider">{row.groupLabel}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded text-[10px] uppercase font-bold tracking-wide border ${
                      row.status === 'sold' 
                        ? 'bg-[#1a1915] text-[#808080] border-[#2a2820]' 
                        : 'bg-[#1e3a2e] text-[#4ade80] border-[#4ade80]/20 shadow-[0_0_10px_rgba(74,222,128,0.1)]'
                    }`}>
                      {row.status === 'sold' ? 'CLOSED' : 'ACTIVE'}
                    </span>
                  </td>
                  <td className="p-4 text-right font-mono text-[#eae9e9]/80">{row.quantity.toLocaleString()}</td>
                  <td className="p-4 text-right font-mono text-[#eae9e9]/80">{formatCurrency(row.avgPrice)}</td>
                  <td className="p-4 text-right font-mono text-[#facc15] font-medium">{formatCurrency(row.stopPrice)}</td>
                  <td className="p-4 text-right font-mono text-[#facc15]/80">{formatCurrency(row.limitPrice)}</td>
                  <td className="p-4 text-center">
                    <div className="flex flex-col items-center justify-center bg-[#1a1915] border border-[#2a2820]/40 rounded-lg p-2 mx-auto w-full max-w-[240px]">
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="font-bold text-[#eae9e9] text-xs">{row.stageLabel}</span>
                        <span className="text-[10px] text-[#808080] truncate ml-2 max-w-[100px]">{row.stageDescription}</span>
                      </div>
                      
                      {row.status !== 'sold' && row.nextStageLabel ? (
                        <div className="flex items-center justify-between w-full mt-1 pt-1 border-t border-[#2a2820]/40">
                          <span className="text-[9px] text-[#808080] uppercase tracking-wide">Next Target</span>
                          <div className="flex items-center space-x-1">
                            <span className="text-[10px] text-[#eae9e9] font-medium">{row.nextStageLabel}</span>
                            {row.nextTrigger !== null && (
                              <span className="text-[10px] text-[#4ade80] bg-[#4ade80]/10 px-1 rounded">
                                +{(row.nextTrigger * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </div>
                      ) : row.status !== 'sold' && (
                        <div className="mt-1 pt-1 border-t border-[#2a2820]/40 w-full text-center">
                          <span className="text-[9px] text-[#4ade80] uppercase tracking-widest font-bold">Max Stage Reached</span>
                        </div>
                      )}

                      {row.progress !== null && row.status !== 'sold' && (
                        <div className="w-full h-1.5 bg-[#2a2820] rounded-full mt-2 overflow-hidden shadow-inner">
                          <div 
                            className="h-full bg-gradient-to-r from-[#4ade80] to-[#22c55e] shadow-[0_0_8px_rgba(74,222,128,0.4)] transition-all duration-500 ease-out" 
                            style={{ width: `${Math.min(Math.max((row.progress || 0) * 100, 0), 100)}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-right font-mono text-sm">
                    {row.status !== 'sold' ? (
                      <span className={`font-semibold ${((row.unrealizedQty || 0) >= 0) ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                        {formatCurrency(row.unrealizedQty)}
                      </span>
                    ) : (
                      <span className="text-[#2a2820]">-</span>
                    )}
                  </td>
                  <td className="p-4 text-right font-mono text-sm">
                    {row.status === 'sold' ? (
                      <div className="flex flex-col items-end">
                        <span className={`font-bold ${((row.totalPnL || 0) >= 0) ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                          {formatCurrency(row.totalPnL)}
                        </span>
                        {row.pnlPerShare !== undefined && (
                          <span className={`text-[10px] ${((row.pnlPerShare || 0) >= 0) ? 'text-[#4ade80]/60' : 'text-[#f87171]/60'}`}>
                            {((row.pnlPerShare || 0) >= 0 ? '+' : '')}{formatCurrency(row.pnlPerShare)}/sh
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[#2a2820]">-</span>
                    )}
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

