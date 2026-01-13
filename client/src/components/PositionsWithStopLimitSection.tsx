import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAuth } from '../auth/AuthContext';
import NotificationContainer from './NotificationContainer';
import ConfirmationModal from './ConfirmationModal';
import ProgressModal from './ProgressModal';
import type { NotificationProps } from './Notification';

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
  status: string;
  statusLabel: string;
  createdAt: number | null;
  updatedAt: number | null;
}

interface MergedPosition extends Position {
  stopLimit?: StopLimitV2Snapshot;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';

const PositionsWithStopLimitSection: React.FC = () => {
  const { fetchWithAuth } = useAuth();
  const [positions, setPositions] = useState<Map<string, Position>>(new Map());
  const [stopLimitData, setStopLimitData] = useState<Map<string, StopLimitV2Snapshot>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sellingAll, setSellingAll] = useState(false);
  const [sellAllStatus, setSellAllStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [sellingPositions, setSellingPositions] = useState<Set<string>>(new Set());
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
  const [progressModal, setProgressModal] = useState<{
    isOpen: boolean;
    title: string;
    steps: Array<{ id: string; label: string; status: 'pending' | 'active' | 'completed' | 'error' }>;
    message?: string;
    type?: 'danger' | 'warning' | 'info' | 'success';
  } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectionTimeoutRef = useRef<number | null>(null);
  const stopLimitIntervalRef = useRef<number | null>(null);

  // Fetch StopLimit V2 snapshot
  const fetchStopLimitSnapshot = useCallback(async () => {
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/stoplimit/v2/snapshot`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.success && data.data) {
        const snapshotMap = new Map<string, StopLimitV2Snapshot>();
        for (const item of data.data) {
          snapshotMap.set(item.symbol.toUpperCase(), item);
        }
        setStopLimitData(snapshotMap);
      }
    } catch (err: any) {
      console.error('Error fetching StopLimit V2 snapshot:', err);
    }
  }, [fetchWithAuth]);

  // WebSocket connection for positions
  const connectWebSocket = useCallback(() => {
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

    const url = `${WS_BASE_URL}/ws/positions?token=${encodeURIComponent(token)}`;
    console.log('🔌 Connecting to positions WebSocket proxy:', url.replace(token, '***'));
    
    try {
      setLoading(true);
      
      if (!initialLoad) {
        setError(null);
      }
      
      const ws = new WebSocket(url);
      ws.binaryType = 'blob';
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
        console.log('✅ Connected to positions WebSocket');
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
          let dataStr: string;
          if (event.data instanceof Blob) {
            dataStr = await event.data.text();
          } else if (typeof event.data === 'string') {
            dataStr = event.data;
          } else {
            dataStr = new TextDecoder().decode(event.data as ArrayBuffer);
          }
          
          const data = JSON.parse(dataStr);
          
          if (data.Heartbeat) {
            return;
          }

          if (data.PositionID) {
            const position: Position = data;
            const quantity = parseFloat(position.Quantity || '0');
            
            setPositions(prev => {
              const newMap = new Map(prev);
              
              if (quantity <= 0) {
                newMap.delete(position.PositionID);
              } else {
                newMap.set(position.PositionID, position);
              }
              
              return new Map(newMap);
            });
          } 
          else if (Array.isArray(data)) {
            setPositions(prev => {
              const newMap = new Map();
              
              data.forEach((position: Position) => {
                if (position.PositionID) {
                  const quantity = parseFloat(position.Quantity || '0');
                  if (quantity > 0) {
                    newMap.set(position.PositionID, position);
                  }
                }
              });
              
              return new Map(newMap);
            });
          }
          else if (data.action === 'delete' || data.action === 'remove' || data.action === 'close') {
            const positionId = data.PositionID || data.positionId || data.position_id;
            if (positionId) {
              setPositions(prev => {
                const newMap = new Map(prev);
                newMap.delete(positionId);
                return new Map(newMap);
              });
            }
          }
        } catch (err: any) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (initialLoad) {
          setInitialLoad(false);
          setLoading(false);
          setError('WebSocket connection error. Please check your connection.');
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setIsConnected(false);
        
        if (connectionTimeoutRef.current) {
          window.clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }

        if (event.code !== 1000) {
          const maxAttempts = 10;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          
          if (reconnectAttemptsRef.current < maxAttempts) {
            reconnectAttemptsRef.current++;
            reconnectTimerRef.current = window.setTimeout(() => {
              connectWebSocket();
            }, delay);
          } else {
            setLoading(false);
            setInitialLoad(false);
            setError('Failed to reconnect. Please refresh the page.');
          }
        }
      };
    } catch (err) {
      console.error('Failed to connect to WebSocket:', err);
      setInitialLoad(false);
      setLoading(false);
      setError('Failed to connect. Please try again.');
    }
  }, [token, WS_BASE_URL, initialLoad]);

  const disconnectWebSocket = useCallback(() => {
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

  // Merge positions with StopLimit data
  const mergedPositions = useMemo(() => {
    const merged: MergedPosition[] = [];
    
    for (const position of positions.values()) {
      const symbol = position.Symbol.toUpperCase();
      const stopLimit = stopLimitData.get(symbol);
      
      merged.push({
        ...position,
        stopLimit
      });
    }
    
    // Sort by symbol
    return merged.sort((a, b) => a.Symbol.localeCompare(b.Symbol));
  }, [positions, stopLimitData]);

  // Auto-connect on mount
  useEffect(() => {
    connectWebSocket();
    fetchStopLimitSnapshot();
    
    // Start polling StopLimit snapshot every second
    stopLimitIntervalRef.current = window.setInterval(() => {
      fetchStopLimitSnapshot();
    }, 1000);
    
    return () => {
      disconnectWebSocket();
      if (stopLimitIntervalRef.current) {
        clearInterval(stopLimitIntervalRef.current);
      }
    };
  }, [connectWebSocket, disconnectWebSocket, fetchStopLimitSnapshot]);

  const addNotification = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration?: number) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, { id, message, type, duration, onClose: () => {} }]);
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const formatPrice = (price: string): string => {
    const num = parseFloat(price);
    if (isNaN(num)) return 'N/A';
    return `$${num.toFixed(2)}`;
  };

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '-';
    return `$${val.toFixed(2)}`;
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

  const totalUnrealizedPL = useMemo(() => mergedPositions.reduce((sum, pos) => {
    const pl = parseFloat(pos.UnrealizedProfitLoss);
    return sum + (isNaN(pl) ? 0 : pl);
  }, 0), [mergedPositions]);

  const totalTodaysPL = useMemo(() => mergedPositions.reduce((sum, pos) => {
    const pl = parseFloat(pos.TodaysProfitLoss);
    return sum + (isNaN(pl) ? 0 : pl);
  }, 0), [mergedPositions]);

  const handleSell = async (position: Position) => {
    const positionId = position.PositionID;
    const symbol = position.Symbol?.trim().toUpperCase();
    const quantity = parseInt(position.Quantity || '0', 10);
    
    if (!symbol || sellingPositions.has(positionId)) return;
    
    if (!quantity || quantity <= 0) {
      addNotification(`Invalid quantity for ${symbol}`, 'error');
      return;
    }
    
    const action = position.LongShort === 'Long' ? 'sell' : 'close';
    setSellingPositions(prev => new Set(prev).add(positionId));
    
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          symbol,
          quantity,
          order_type: 'Limit',
          long_short: position.LongShort
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
        addNotification(`Failed to ${action} ${symbol}: ${errorData.error || `HTTP ${response.status}`}`, 'error');
        return;
      }
      
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ Sell order sent for ${quantity} ${symbol}:`, data.data?.notifyStatus);
        addNotification(`Sell order sent successfully for ${quantity} ${symbol}`, 'success');
      } else {
        addNotification(`Failed to ${action} ${symbol}: ${data.error || data.data?.notifyStatus || 'Unknown error'}`, 'error');
      }
    } catch (err: any) {
      addNotification(`Error ${action === 'sell' ? 'selling' : 'closing'} ${symbol}: ${err.message || 'Unknown error'}`, 'error');
    } finally {
      setSellingPositions(prev => {
        const newSet = new Set(prev);
        newSet.delete(positionId);
        return newSet;
      });
    }
  };

  const handleSellAll = async () => {
    if (mergedPositions.length === 0 || sellingAll) return;
    
    setConfirmModal({
      isOpen: true,
      title: 'PANIC SELL',
      message: '⚠️ This will cancel all pending orders and sell ALL positions.\n\nAre you sure you want to proceed?',
      confirmText: 'Sell All',
      cancelText: 'Cancel',
      type: 'danger',
      onConfirm: async () => {
        setConfirmModal(null);
        setSellingAll(true);
        setSellAllStatus(null);
        
        type Step = { id: string; label: string; status: 'pending' | 'active' | 'completed' | 'error' };
        const initialSteps: Step[] = [
          { id: 'analyze', label: 'Analyzing orders websocket', status: 'pending' },
          { id: 'delete', label: 'Deleting active sell orders', status: 'pending' },
          { id: 'execute', label: 'Executing sell all', status: 'pending' },
          { id: 'complete', label: 'Sell all completed', status: 'pending' }
        ];
        
        const updateProgress = (updater: (steps: Step[]) => Step[], message?: string, type?: 'danger' | 'success') => {
          setProgressModal(prev => {
            if (!prev) return null;
            const updatedSteps = updater([...prev.steps]);
            return {
              ...prev,
              steps: updatedSteps,
              message: message !== undefined ? message : prev.message,
              type: type !== undefined ? type : prev.type
            };
          });
        };
        
        setProgressModal({
          isOpen: true,
          title: 'SELL ALL IN PROGRESS',
          steps: initialSteps,
          type: 'danger'
        });
        
        try {
          await new Promise(resolve => setTimeout(resolve, 100));
          updateProgress((steps) => {
            const updated = [...steps];
            updated[0] = { ...updated[0], status: 'active' };
            return updated;
          }, 'Analyzing orders websocket for active sell orders...');
          
          await new Promise(resolve => setTimeout(resolve, 500));
          
          updateProgress((steps) => {
            const updated = [...steps];
            updated[0] = { ...updated[0], status: 'completed' };
            updated[1] = { ...updated[1], status: 'active' };
            return updated;
          }, 'Finding and deleting active sell orders...');
          
          await new Promise(resolve => setTimeout(resolve, 800));
          
          updateProgress((steps) => {
            const updated = [...steps];
            updated[1] = { ...updated[1], status: 'completed' };
            updated[2] = { ...updated[2], status: 'active' };
            return updated;
          }, 'Sending sell all command...');
          
          const response = await fetchWithAuth(`${API_BASE_URL}/sell_all`, {
            method: 'POST',
            headers: { 'Accept': '*/*' }
          });
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ 
              error: `HTTP ${response.status}: ${response.statusText}` 
            }));
            const errorMsg = errorData.error || `HTTP ${response.status}`;
            
            updateProgress((steps) => {
              const updated = [...steps];
              updated[2] = { ...updated[2], status: 'error' };
              updated[3] = { ...updated[3], status: 'error' };
              return updated;
            }, `Error: ${errorMsg}`, 'danger');
            
            setSellAllStatus({
              success: false,
              message: errorMsg
            });
            addNotification(`Sell All failed: ${errorMsg}`, 'error');
            
            setTimeout(() => {
              setProgressModal(null);
              setSellingAll(false);
            }, 5000);
          } else {
            updateProgress((steps) => {
              const updated = [...steps];
              updated[2] = { ...updated[2], status: 'completed' };
              updated[3] = { ...updated[3], status: 'completed' };
              return updated;
            }, 'Sell All executed successfully', 'success');
            
            setSellAllStatus({
              success: true,
              message: 'Sell All executed successfully'
            });
            addNotification('Sell All executed successfully', 'success');
            
            setTimeout(() => {
              setProgressModal(null);
              setSellingAll(false);
              setSellAllStatus(null);
            }, 3000);
          }
        } catch (err: any) {
          const errorMsg = err.message || 'Error executing Sell All';
          
          updateProgress((steps) => {
            const updated = [...steps];
            updated[2] = { ...updated[2], status: 'error' };
            updated[3] = { ...updated[3], status: 'error' };
            return updated;
          }, `Error: ${errorMsg}`, 'danger');
          
          setSellAllStatus({
            success: false,
            message: errorMsg
          });
          addNotification(`Sell All error: ${errorMsg}`, 'error');
          
          setTimeout(() => {
            setProgressModal(null);
            setSellingAll(false);
          }, 5000);
        }
      }
    });
  };

  const activeWithStopLimit = useMemo(() => {
    return mergedPositions.filter(p => p.stopLimit && p.stopLimit.status === 'active').length;
  }, [mergedPositions]);

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
      
      {progressModal && (
        <ProgressModal
          isOpen={progressModal.isOpen}
          title={progressModal.title}
          steps={progressModal.steps}
          message={progressModal.message}
          type={progressModal.type}
          onClose={() => {
            setProgressModal(null);
            setSellingAll(false);
          }}
        />
      )}
      
      {/* Header */}
      <div className="p-5 border-b border-[#2a2820]/60 bg-gradient-to-r from-[#14130e] to-[#0f0e0a]">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center space-x-4">
            <div className="p-2 bg-[#2a2820]/40 rounded-lg border border-[#2a2820]">
              <svg className="w-5 h-5 text-[#4ade80]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#eae9e9] tracking-wider uppercase">Positions & StopLimit</h2>
              <p className="text-xs text-[#808080] mt-0.5 font-light tracking-wide">Active Positions with Automated StopLimit Tracking</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="px-3 py-1 bg-[#1a1915] border border-[#2a2820] rounded-md flex items-center space-x-2">
              <span className="text-[10px] text-[#808080] uppercase tracking-wider">Positions</span>
              <span className="text-xs font-mono font-bold text-[#eae9e9]">{mergedPositions.length}</span>
            </div>
            <div className="px-3 py-1 bg-[#1a1915] border border-[#2a2820] rounded-md flex items-center space-x-2">
              <span className="text-[10px] text-[#808080] uppercase tracking-wider">With StopLimit</span>
              <span className="text-xs font-mono font-bold text-[#4ade80]">{activeWithStopLimit}</span>
            </div>
            <div className="w-px h-6 bg-[#2a2820] mx-2"></div>
            <div className="flex items-center space-x-2">
              <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-[#22c55e] shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-[#f87171] shadow-[0_0_6px_rgba(248,113,113,0.5)]'}`}></div>
              <span className="text-xs text-[#eae9e9]/80 font-medium">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {mergedPositions.length > 0 && (
              <button
                onClick={handleSellAll}
                disabled={sellingAll}
                className={`ml-3 px-3 py-1.5 rounded-sm text-xs font-bold transition-all ${
                  sellingAll
                    ? 'bg-[#2a2820] text-[#eae9e9] opacity-50 cursor-not-allowed'
                    : 'bg-[#f87171] hover:bg-[#ef4444] text-[#14130e] shadow-[0_0_8px_rgba(248,113,113,0.3)]'
                }`}
              >
                {sellingAll ? (
                  <span className="flex items-center space-x-1">
                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Selling...</span>
                  </span>
                ) : (
                  'Sell All'
                )}
              </button>
            )}
          </div>
        </div>
        
        {sellAllStatus && (
          <div className={`mb-3 p-2 rounded text-xs ${
            sellAllStatus.success 
              ? 'bg-[#1e3a2e] border border-[#4ade80] text-[#4ade80]' 
              : 'bg-[#3a1e1e] border border-[#f87171] text-[#f87171]'
          }`}>
            {sellAllStatus.message}
          </div>
        )}

        {/* Summary Stats */}
        {mergedPositions.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#2a2820] grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs opacity-60 mb-1">Total Unrealized P&L</div>
              <div className={`text-sm font-semibold ${totalUnrealizedPL >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                {formatPrice(totalUnrealizedPL.toString())}
              </div>
            </div>
            <div>
              <div className="text-xs opacity-60 mb-1">Today's P&L</div>
              <div className={`text-sm font-semibold ${totalTodaysPL >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                {formatPrice(totalTodaysPL.toString())}
              </div>
            </div>
            <div>
              <div className="text-xs opacity-60 mb-1">Market Value</div>
              <div className="text-sm font-semibold text-[#eae9e9]">
                {formatPrice(mergedPositions.reduce((sum, pos) => {
                  const mv = parseFloat(pos.MarketValue);
                  return sum + (isNaN(mv) ? 0 : mv);
                }, 0).toString())}
              </div>
            </div>
          </div>
        )}
      </div>

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

      {/* Positions Table */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#2a2820] rounded-lg flex items-center justify-center mx-auto mb-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4ade80]"></div>
              </div>
              <h3 className="text-lg font-medium text-[#eae9e9] mb-2">Connecting...</h3>
              <p className="opacity-60 text-sm">
                Establishing WebSocket connection...
              </p>
            </div>
          </div>
        ) : mergedPositions.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#2a2820] rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-[#eae9e9] mb-2">No positions yet</h3>
              <p className="opacity-60 text-sm">
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
            <div className="bg-[#14130e] border-b border-[#2a2820] px-4 py-3 sticky top-0 z-10">
              <div className="grid grid-cols-10 gap-4 text-xs font-medium opacity-60 uppercase tracking-wide">
                <div>Symbol</div>
                <div className="text-right">Qty</div>
                <div className="text-right">Avg Price</div>
                <div className="text-right">Last</div>
                <div className="text-right">Limit</div>
                <div className="text-right">P&L</div>
                <div className="text-right">Unrealized P&L</div>
                <div className="text-center">Action</div>
                <div className="text-center">Stage & Progress</div>
                <div className="text-right">Time</div>
              </div>
            </div>

            {/* Table Body - Virtualized */}
            <div className="flex-1">
              <Virtuoso
                style={{ height: '100%' }}
                data={mergedPositions}
                overscan={200}
                itemContent={(index, position) => {
                  const unrealizedPL = parseFloat(position.UnrealizedProfitLoss);
                  const unrealizedPLQty = parseFloat(position.UnrealizedProfitLossQty || '0');
                  const todaysPL = parseFloat(position.TodaysProfitLoss);
                  const stopLimit = position.stopLimit;
                  
                  return (
                    <div
                      key={position.PositionID}
                      className={`px-4 py-3 border-b border-[#2a2820] hover:bg-[#1e1d17] transition-colors ${
                        index % 2 === 0 ? 'bg-[#0f0e0a]' : 'bg-[#14130e]'
                      }`}
                    >
                      <div className="grid grid-cols-10 gap-4 items-center text-sm">
                        {/* Symbol */}
                        <div>
                          <div className="flex items-center space-x-2">
                            {stopLimit && stopLimit.status === 'active' && (
                              <div className="w-1 h-6 rounded-full bg-[#4ade80]"></div>
                            )}
                            <div>
                              <div className="font-semibold text-[#eae9e9]">{position.Symbol}</div>
                              {stopLimit && (
                                <div className="text-[10px] text-[#808080] uppercase tracking-wider">{stopLimit.groupLabel}</div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Quantity */}
                        <div className="text-right">
                          <div className="text-[#eae9e9] font-mono">{formatQuantity(position.Quantity)}</div>
                        </div>

                        {/* Average Price */}
                        <div className="text-right">
                          <div className="text-[#eae9e9] font-mono text-xs">{formatPrice(position.AveragePrice)}</div>
                        </div>

                        {/* Last */}
                        <div className="text-right">
                          <div className="text-[#eae9e9] font-mono text-xs">{formatPrice(position.Last)}</div>
                        </div>

                        {/* Limit Price */}
                        <div className="text-right">
                          {stopLimit && stopLimit.limitPrice !== null ? (
                            <div className="font-mono text-[#facc15]/80 text-xs">{formatCurrency(stopLimit.limitPrice)}</div>
                          ) : (
                            <div className="text-[#2a2820] text-xs">-</div>
                          )}
                        </div>

                        {/* P&L (Quantity) */}
                        <div className="text-right">
                          <div className={`font-semibold font-mono text-xs ${unrealizedPLQty >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                            {formatPrice(position.UnrealizedProfitLossQty)}
                          </div>
                        </div>

                        {/* Unrealized P&L */}
                        <div className="text-right">
                          <div className={`font-semibold font-mono text-xs ${unrealizedPL >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                            {formatPrice(position.UnrealizedProfitLoss)}
                          </div>
                        </div>

                        {/* Sell Button */}
                        <div className="text-center">
                          <button
                            onClick={() => handleSell(position)}
                            disabled={sellingPositions.has(position.PositionID)}
                            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                              sellingPositions.has(position.PositionID)
                                ? 'bg-[#2a2820] text-[#eae9e9] opacity-50 cursor-not-allowed'
                                : 'bg-[#f87171] hover:bg-[#ef4444] text-[#14130e]'
                            }`}
                          >
                            {sellingPositions.has(position.PositionID) ? (
                              <svg className="animate-spin h-3 w-3 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            ) : (
                              'Sell'
                            )}
                          </button>
                        </div>

                        {/* Stage & Progress */}
                        <div className="text-center">
                          {stopLimit && stopLimit.status === 'active' ? (
                            <div className="flex flex-row items-center justify-center gap-2 bg-[#1a1915] border border-[#2a2820]/40 rounded px-2 py-1.5 mx-auto">
                              {/* Stage Info */}
                              <div className="flex flex-col items-start min-w-0">
                                <span className="font-bold text-[#eae9e9] text-xs leading-tight">{stopLimit.stageLabel}</span>
                                <span className="text-[9px] text-[#808080] leading-tight truncate max-w-[80px]">{stopLimit.stageDescription}</span>
                              </div>
                              
                              {/* Separator */}
                              <div className="w-px h-4 bg-[#2a2820]/40"></div>
                              
                              {/* Next Stage */}
                              {stopLimit.nextStageLabel ? (
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-[9px] text-[#808080] uppercase tracking-wide whitespace-nowrap">Next:</span>
                                  <span className="text-[10px] text-[#eae9e9] font-semibold leading-tight truncate max-w-[60px]">{stopLimit.nextStageLabel}</span>
                                  {stopLimit.nextTrigger !== null && (
                                    <span className="text-[9px] text-[#4ade80] bg-[#4ade80]/20 px-1 py-0.5 rounded font-medium whitespace-nowrap">
                                      +{(stopLimit.nextTrigger * 100).toFixed(0)}%
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center">
                                  <span className="text-[9px] text-[#4ade80] uppercase tracking-wider font-bold whitespace-nowrap">Max</span>
                                </div>
                              )}
                              
                              {/* Progress Bar */}
                              {stopLimit.progress !== null && (
                                <>
                                  <div className="w-px h-4 bg-[#2a2820]/40"></div>
                                  <div className="flex items-center gap-1.5 min-w-[60px]">
                                    <div className="flex-1 h-1.5 bg-[#2a2820] rounded-full overflow-hidden shadow-inner min-w-[40px]">
                                      <div 
                                        className="h-full bg-gradient-to-r from-[#4ade80] to-[#22c55e] shadow-[0_0_4px_rgba(74,222,128,0.4)] transition-all duration-500 ease-out" 
                                        style={{ width: `${Math.min(Math.max((stopLimit.progress || 0) * 100, 0), 100)}%` }}
                                      ></div>
                                    </div>
                                    <span className="text-[9px] text-[#eae9e9] font-mono font-semibold whitespace-nowrap">
                                      {Math.min(Math.max((stopLimit.progress || 0) * 100, 0), 100).toFixed(0)}%
                                    </span>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="text-[#2a2820] text-xs">-</div>
                          )}
                        </div>

                        {/* Time */}
                        <div className="text-right">
                          <div className="text-xs opacity-60 font-mono">{formatTimestamp(position.Timestamp)}</div>
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

export default PositionsWithStopLimitSection;
