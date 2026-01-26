import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import NotificationContainer from './NotificationContainer';
import ConfirmationModal from './ConfirmationModal';
import type { NotificationProps } from './Notification';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

interface StopLimitPosition {
  symbol: string;
  positionId: string | null;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  unrealizedPL: number;
  hasStopLimit: boolean;
  stopLimitOrderId: string | null;
  stopLimitQuantity: number;
  stopLimitStatus: string | null;
  stopPrice: number | null;
  limitPrice: number | null;
}

const StopLimitTrackingSection: React.FC = () => {
  const { fetchWithAuth } = useAuth();
  const [positions, setPositions] = useState<StopLimitPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingSymbols, setRemovingSymbols] = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<NotificationProps[]>([]);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
  } | null>(null);
  const refreshIntervalRef = useRef<number | null>(null);

  const fetchStopLimitPositions = async () => {
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/stoplimit/positions`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setPositions(Array.isArray(data.data) ? data.data : []);
        setError(null);
      } else {
        throw new Error(data.error || 'Failed to load StopLimit positions');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load StopLimit positions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchStopLimitPositions();
    
    // Refresh every 2 seconds
    refreshIntervalRef.current = window.setInterval(() => {
      fetchStopLimitPositions();
    }, 2000);
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  const addNotification = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration?: number) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, { id, message, type, duration, onClose: () => {} }]);
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleRemoveStopLimit = (symbol: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Remove StopLimit',
      message: `Are you sure you want to cancel the StopLimit order for ${symbol}? This will remove the stop-loss protection.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      type: 'warning',
      onConfirm: async () => {
        setConfirmModal(null);
        setRemovingSymbols(prev => new Set(prev).add(symbol));
        
        try {
          const response = await fetchWithAuth(`${API_BASE_URL}/stoplimit/positions/${encodeURIComponent(symbol)}`, {
            method: 'DELETE'
          });
          
          const data = await response.json();
          
          if (response.ok && data.success) {
            addNotification(`StopLimit removed for ${symbol}`, 'success');
            // Refresh positions
            await fetchStopLimitPositions();
          } else {
            addNotification(`Failed to remove StopLimit for ${symbol}: ${data.error || 'Unknown error'}`, 'error');
          }
        } catch (err: any) {
          addNotification(`Error removing StopLimit for ${symbol}: ${err.message || 'Unknown error'}`, 'error');
        } finally {
          setRemovingSymbols(prev => {
            const next = new Set(prev);
            next.delete(symbol);
            return next;
          });
        }
      }
    });
  };

  const formatPrice = (price: number): string => {
    if (isNaN(price) || price === 0) return '—';
    return `$${price.toFixed(2)}`;
  };

  const formatQuantity = (qty: number): string => {
    if (isNaN(qty) || qty === 0) return '—';
    return qty.toLocaleString();
  };

  const getStatusColor = (status: string | null): string => {
    if (!status) return 'text-[#808080]';
    const upper = status.toUpperCase();
    if (upper === 'ACK' || upper === 'DON' || upper === 'REC' || upper === 'QUE' || upper === 'QUEUED') {
      return 'text-[#facc15]'; // Yellow for active
    }
    if (upper === 'FLL' || upper === 'FIL') {
      return 'text-[#4ade80]'; // Green for filled
    }
    if (upper === 'REJ' || upper === 'CAN') {
      return 'text-[#f87171]'; // Red for rejected/cancelled
    }
    return 'text-[#808080]';
  };

  const getStatusLabel = (status: string | null): string => {
    if (!status) return '—';
    const upper = status.toUpperCase();
    if (upper === 'ACK') return 'Received';
    if (upper === 'DON') return 'Queued';
    if (upper === 'REC') return 'Received';
    if (upper === 'QUE' || upper === 'QUEUED') return 'Queued';
    if (upper === 'FLL' || upper === 'FIL') return 'Filled';
    if (upper === 'REJ') return 'Rejected';
    if (upper === 'CAN') return 'Cancelled';
    return status;
  };

  if (loading && positions.length === 0) {
    return (
      <div className="h-full flex flex-col bg-[#14130e]">
        <div className="h-full flex items-center justify-center">
          <div className="flex flex-col items-center space-y-3">
            <div className="w-6 h-6 border-2 border-[#2a2820] border-t-[#808080] rounded-full animate-spin"></div>
            <p className="text-xs text-[#808080] uppercase tracking-wider">Loading StopLimit positions...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#14130e]">
      <NotificationContainer notifications={notifications} onRemove={removeNotification} />
      
      {confirmModal && (
        <ConfirmationModal
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          cancelText={confirmModal.cancelText}
          type={confirmModal.type}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* Header */}
      <div className="p-4 border-b border-[#2a2820]/50 bg-gradient-to-r from-[#14130e] to-[#0f0e0a] backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#eae9e9] tracking-wider uppercase">StopLimit Tracking</h2>
            <p className="text-xs text-[#808080] mt-1">Monitor and manage StopLimit orders for your positions</p>
          </div>
          <div className="flex items-center space-x-3">
            <div className="text-xs text-[#808080]">
              Positions: {positions.length} | With StopLimit: {positions.filter(p => p.hasStopLimit).length}
            </div>
            <button
              onClick={fetchStopLimitPositions}
              className="px-3 py-1 text-xs font-semibold rounded transition-colors bg-[#2a2820] text-[#eae9e9] hover:bg-[#3a3830] border border-[#404040]"
              title="Refresh"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mt-3 bg-[#3a1e1e] border border-[#f87171] rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <svg className="w-4 h-4 text-[#f87171]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-[#f87171]">{error}</p>
          </div>
        </div>
      )}

      {/* Positions Table */}
      <div className="flex-1 overflow-auto">
        {positions.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#2a2820] rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-[#eae9e9] mb-2">No positions found</h3>
              <p className="opacity-60 text-sm">You don't have any open positions</p>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Table Header */}
            <div className="bg-[#14130e] border-b border-[#2a2820] px-4 py-2 sticky top-0 z-10">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium opacity-60 uppercase tracking-wide">
                <div className="col-span-2">Symbol</div>
                <div className="col-span-1 text-right">Qty</div>
                <div className="col-span-1 text-right">Avg Price</div>
                <div className="col-span-1 text-right">Last</div>
                <div className="col-span-1 text-right">P&L</div>
                <div className="col-span-1 text-center">StopLimit</div>
                <div className="col-span-1 text-right">Stop Price</div>
                <div className="col-span-1 text-right">Limit Price</div>
                <div className="col-span-1 text-center">Status</div>
                <div className="col-span-1 text-right">Order ID</div>
                <div className="col-span-1 text-center">Action</div>
              </div>
            </div>

            {/* Table Body */}
            <div className="flex-1 overflow-auto">
              {positions.map((position, index) => (
                <div
                  key={position.symbol}
                  className={`px-4 py-3 border-b border-[#2a2820] hover:bg-[#1e1d17] transition-colors ${
                    index % 2 === 0 ? 'bg-[#0f0e0a]' : 'bg-[#14130e]'
                  }`}
                >
                  <div className="grid grid-cols-12 gap-2 items-center text-sm">
                    {/* Symbol */}
                    <div className="col-span-2">
                      <div className="font-semibold text-[#eae9e9]">{position.symbol}</div>
                    </div>

                    {/* Quantity */}
                    <div className="col-span-1 text-right">
                      <div className="text-[#eae9e9] font-mono">{formatQuantity(position.quantity)}</div>
                    </div>

                    {/* Average Price */}
                    <div className="col-span-1 text-right">
                      <div className="text-[#eae9e9] font-mono text-xs">{formatPrice(position.averagePrice)}</div>
                    </div>

                    {/* Last Price */}
                    <div className="col-span-1 text-right">
                      <div className="text-[#eae9e9] font-mono text-xs">{formatPrice(position.lastPrice)}</div>
                    </div>

                    {/* P&L */}
                    <div className="col-span-1 text-right">
                      <div className={`font-semibold font-mono text-xs ${position.unrealizedPL >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                        {formatPrice(position.unrealizedPL)}
                      </div>
                    </div>

                    {/* StopLimit Indicator */}
                    <div className="col-span-1 text-center">
                      {position.hasStopLimit ? (
                        <div className="w-2 h-2 rounded-full bg-[#4ade80] mx-auto" title="StopLimit Active"></div>
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-[#808080] opacity-30 mx-auto" title="No StopLimit"></div>
                      )}
                    </div>

                    {/* Stop Price */}
                    <div className="col-span-1 text-right">
                      {position.stopPrice ? (
                        <div className="text-[#facc15] font-mono text-xs">{formatPrice(position.stopPrice)}</div>
                      ) : (
                        <div className="text-[#808080] text-xs">—</div>
                      )}
                    </div>

                    {/* Limit Price */}
                    <div className="col-span-1 text-right">
                      {position.limitPrice ? (
                        <div className="text-[#facc15] font-mono text-xs">{formatPrice(position.limitPrice)}</div>
                      ) : (
                        <div className="text-[#808080] text-xs">—</div>
                      )}
                    </div>

                    {/* Status */}
                    <div className="col-span-1 text-center">
                      {position.stopLimitStatus ? (
                        <div className={`text-xs font-medium ${getStatusColor(position.stopLimitStatus)}`}>
                          {getStatusLabel(position.stopLimitStatus)}
                        </div>
                      ) : (
                        <div className="text-[#808080] text-xs">—</div>
                      )}
                    </div>

                    {/* Order ID */}
                    <div className="col-span-1 text-right">
                      {position.stopLimitOrderId ? (
                        <div className="text-[#808080] font-mono text-[10px] break-all" title={position.stopLimitOrderId}>
                          {position.stopLimitOrderId.slice(0, 8)}...
                        </div>
                      ) : (
                        <div className="text-[#808080] text-xs">—</div>
                      )}
                    </div>

                    {/* Action */}
                    <div className="col-span-1 text-center">
                      {position.hasStopLimit ? (
                        <button
                          onClick={() => handleRemoveStopLimit(position.symbol)}
                          disabled={removingSymbols.has(position.symbol)}
                          className={`px-2 py-1 text-xs font-semibold rounded transition-colors ${
                            removingSymbols.has(position.symbol)
                              ? 'bg-[#2a2820] text-[#eae9e9] opacity-50 cursor-not-allowed'
                              : 'bg-[#f87171] hover:bg-[#ef4444] text-[#14130e]'
                          }`}
                          title="Remove StopLimit"
                        >
                          {removingSymbols.has(position.symbol) ? '...' : 'Remove'}
                        </button>
                      ) : (
                        <span className="text-xs text-[#808080] opacity-50">—</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StopLimitTrackingSection;
