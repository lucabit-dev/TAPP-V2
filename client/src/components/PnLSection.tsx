import React from 'react';
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

const PnLSection: React.FC = () => {
  const { fetchWithAuth } = useAuth();
  const [positions, setPositions] = React.useState<Map<string, Position>>(new Map());
  const [isConnected, setIsConnected] = React.useState(false);
  // Get auth token from localStorage and Railway URL from env
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
  const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';
  const token = localStorage.getItem('auth_token');
  const [loading, setLoading] = React.useState(true); // Start with loading true
  const [initialLoad, setInitialLoad] = React.useState(true); // Track initial connection attempt
  const [error, setError] = React.useState<string | null>(null);
  const [sellingAll, setSellingAll] = React.useState(false);
  const [sellAllStatus, setSellAllStatus] = React.useState<{ success: boolean; message: string } | null>(null);
  const [sellingPositions, setSellingPositions] = React.useState<Set<string>>(new Set());
  const [notifications, setNotifications] = React.useState<NotificationProps[]>([]);
  const [confirmModal, setConfirmModal] = React.useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
  } | null>(null);
  const [progressModal, setProgressModal] = React.useState<{
    isOpen: boolean;
    title: string;
    steps: Array<{ id: string; label: string; status: 'pending' | 'active' | 'completed' | 'error' }>;
    message?: string;
    type?: 'danger' | 'warning' | 'info' | 'success';
  } | null>(null);
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

    if (!token) {
      setError('Authentication required. Please log in.');
      setLoading(false);
      setInitialLoad(false);
      return;
    }

    // Connect to backend proxy which will handle the external API key
    const url = `${WS_BASE_URL}/ws/positions?token=${encodeURIComponent(token)}`;
    console.log('🔌 Connecting to positions WebSocket proxy:', url.replace(token, '***'));
    
    try {
      setLoading(true);
      
      // Only clear error if not initial load (to avoid flashing errors)
      if (!initialLoad) {
        setError(null);
      }
      
      const ws = new WebSocket(url);
      ws.binaryType = 'blob'; // Ensure we can handle blob data
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
          console.log('📨 Received positions WebSocket message:', data);
          
          // Skip heartbeat messages
          if (data.Heartbeat) {
            return;
          }

          // Handle position updates
          if (data.PositionID) {
            const position: Position = data;
            const quantity = parseFloat(position.Quantity || '0');
            console.log('✅ Position update received:', position.Symbol, position.PositionID, 'Quantity:', quantity);
            
            setPositions(prev => {
              const newMap = new Map(prev);
              
              // If quantity is 0 or negative, remove the position (it's been closed)
              if (quantity <= 0) {
                console.log('🗑️ Removing position (quantity <= 0):', position.PositionID, position.Symbol);
                newMap.delete(position.PositionID);
              } else {
                // Update or add the position
                newMap.set(position.PositionID, position);
              }
              
              // Force a new Map instance to ensure React detects the change
              return new Map(newMap);
            });
          } 
          // Handle array of positions (batch update)
          else if (Array.isArray(data)) {
            console.log('✅ Batch position update received:', data.length, 'positions');
            setPositions(prev => {
              const newMap = new Map();
              
              // Process all positions in the array
              data.forEach((position: Position) => {
                if (position.PositionID) {
                  const quantity = parseFloat(position.Quantity || '0');
                  if (quantity > 0) {
                    newMap.set(position.PositionID, position);
                  }
                }
              });
              
              // Force a new Map instance
              return new Map(newMap);
            });
          }
          // Handle position deletion (when a position is closed)
          else if (data.action === 'delete' || data.action === 'remove' || data.action === 'close') {
            const positionId = data.PositionID || data.positionId || data.position_id;
            if (positionId) {
              console.log('🗑️ Position deletion received:', positionId);
              setPositions(prev => {
                const newMap = new Map(prev);
                newMap.delete(positionId);
                return new Map(newMap);
              });
            }
          }
          else {
            console.log('⚠️ Unknown message format:', data);
          }
        } catch (err) {
          console.error('❌ Error parsing WebSocket message:', err, 'Raw data type:', typeof event.data, 'Is Blob:', event.data instanceof Blob);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ Positions WebSocket error:', error);
        console.error('Attempted connection URL:', url.replace(token || '', '***'));
        // Show error even during initial load after timeout
        setError('Connection error. Please check your connection and authentication.');
        setIsConnected(false);
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

  // Auto-connect on mount
  React.useEffect(() => {
    connectWebSocket();
    return () => {
      disconnectWebSocket();
    };
  }, [connectWebSocket, disconnectWebSocket]);

  // Memoize positions array to ensure it updates when positions Map changes
  const positionsArray = React.useMemo(() => {
    return Array.from(positions.values()).sort((a, b) => {
      // Sort by Symbol alphabetically, handle undefined/null values
      const symbolA = a.Symbol || '';
      const symbolB = b.Symbol || '';
      return symbolA.localeCompare(symbolB);
    });
  }, [positions]);

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

  // Memoize totals to ensure they update when positions change
  const totalUnrealizedPL = React.useMemo(() => positionsArray.reduce((sum, pos) => {
    const pl = parseFloat(pos.UnrealizedProfitLoss);
    return sum + (isNaN(pl) ? 0 : pl);
  }, 0), [positionsArray]);

  const totalTodaysPL = React.useMemo(() => positionsArray.reduce((sum, pos) => {
    const pl = parseFloat(pos.TodaysProfitLoss);
    return sum + (isNaN(pl) ? 0 : pl);
  }, 0), [positionsArray]);

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
      // Send sell order using POST /order endpoint format
      // https://inbitme.gitbook.io/sections-bot/xKy06Pb8j01LsqEnmSik/rest-api/ordenes
      const response = await fetchWithAuth(`${API_BASE_URL}/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          symbol,
          quantity,
          order_type: 'Limit', // Use Limit order type
          long_short: position.LongShort // Include position side for proper handling
        })
      });
      
      if (!response.ok) {
        // HTTP error (500, etc) - try to get error message
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
        addNotification(`Failed to ${action} ${symbol}: ${errorData.error || `HTTP ${response.status}`}`, 'error');
        return;
      }
      
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ Sell order sent for ${quantity} ${symbol}:`, data.data?.notifyStatus);
        addNotification(`Sell order sent successfully for ${quantity} ${symbol}`, 'success');
        // Position will be removed from the list via WebSocket update
      } else {
        // API returned error response
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
    if (positionsArray.length === 0 || sellingAll) return;
    
    // Confirm action - warn user this is a panic sell
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
        
        // Initialize progress steps
        type Step = { id: string; label: string; status: 'pending' | 'active' | 'completed' | 'error' };
        const initialSteps: Step[] = [
          { id: 'analyze', label: 'Analyzing orders websocket', status: 'pending' },
          { id: 'delete', label: 'Deleting active sell orders', status: 'pending' },
          { id: 'execute', label: 'Executing sell all', status: 'pending' },
          { id: 'complete', label: 'Sell all completed', status: 'pending' }
        ];
        
        // Helper function to update progress modal
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
          // Update step: Analyzing orders
          await new Promise(resolve => setTimeout(resolve, 100));
          updateProgress((steps) => {
            const updated = [...steps];
            updated[0] = { ...updated[0], status: 'active' };
            return updated;
          }, 'Analyzing orders websocket for active sell orders...');
          
          // Small delay to show analyzing step
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Update step: Analyzing completed, Deleting started
          updateProgress((steps) => {
            const updated = [...steps];
            updated[0] = { ...updated[0], status: 'completed' };
            updated[1] = { ...updated[1], status: 'active' };
            return updated;
          }, 'Finding and deleting active sell orders...');
          
          // Small delay to show deleting step
          await new Promise(resolve => setTimeout(resolve, 800));
          
          // Update step: Deleting completed, Executing started
          updateProgress((steps) => {
            const updated = [...steps];
            updated[1] = { ...updated[1], status: 'completed' };
            updated[2] = { ...updated[2], status: 'active' };
            return updated;
          }, 'Sending sell all command...');
          
          // According to API documentation: POST /sell_all with no body
          // Returns 200 with no content on success
          // https://inbitme.gitbook.io/sections-bot/xKy06Pb8j01LsqEnmSik/rest-api/ordenes
          const response = await fetchWithAuth(`${API_BASE_URL}/sell_all`, {
            method: 'POST',
            headers: { 'Accept': '*/*' }
          });
          
          if (!response.ok) {
            // HTTP error - try to get error message
            const errorData = await response.json().catch(() => ({ 
              error: `HTTP ${response.status}: ${response.statusText}` 
            }));
            const errorMsg = errorData.error || `HTTP ${response.status}`;
            
            // Update steps with error
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
            
            // Close progress modal after 5 seconds on error
            setTimeout(() => {
              setProgressModal(null);
              setSellingAll(false);
            }, 5000);
            return;
          }
          
          const data = await response.json();
          
          if (data.success) {
            // Update steps: All completed
            const successMsg = data.data?.message || 'Sell All executed successfully - all orders cancelled and positions sold';
            updateProgress((steps) => {
              const updated = [...steps];
              updated[2] = { ...updated[2], status: 'completed' };
              updated[3] = { ...updated[3], status: 'completed' };
              return updated;
            }, successMsg, 'success');
            
            setSellAllStatus({
              success: true,
              message: successMsg
            });
            addNotification(successMsg, 'success', 8000);
            
            // Close progress modal after 3 seconds on success
            setTimeout(() => {
              setProgressModal(null);
              setSellingAll(false);
            }, 3000);
          } else {
            const errorMsg = data.error || data.data?.message || 'Failed to execute Sell All';
            
            // Update steps with error
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
            
            // Close progress modal after 5 seconds on error
            setTimeout(() => {
              setProgressModal(null);
              setSellingAll(false);
            }, 5000);
          }
        } catch (err: any) {
          const errorMsg = err.message || 'Error executing Sell All';
          
          // Update steps with error
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
          
          // Close progress modal after 5 seconds on error
          setTimeout(() => {
            setProgressModal(null);
            setSellingAll(false);
          }, 5000);
        }
      }
    });
  };

  return (
    <div className="h-full flex flex-col bg-[#14130e]">
      {/* Notification Container */}
      <NotificationContainer notifications={notifications} onRemove={removeNotification} />
      
      {/* Confirmation Modal */}
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
      
      {/* Progress Modal */}
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
      <div className="p-4 border-b border-[#2a2820]/50 bg-gradient-to-r from-[#14130e] to-[#0f0e0a] backdrop-blur-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[#eae9e9] tracking-wider uppercase">P&L - Active Positions</h2>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-[#22c55e] shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-[#f87171] shadow-[0_0_6px_rgba(248,113,113,0.5)]'}`}></div>
              <span className="text-xs text-[#eae9e9]/80 font-medium">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {positionsArray.length > 0 && (
              <span className="text-xs text-[#eae9e9]/70 ml-2">
                ({positionsArray.length} positions)
              </span>
            )}
            {positionsArray.length > 0 && (
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
        
        {/* Sell All Status Message */}
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
        {positionsArray.length > 0 && (
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
        ) : positionsArray.length === 0 ? (
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
            <div className="bg-[#14130e] border-b border-[#2a2820] px-4 py-2 sticky top-0 z-10">
              <div className="grid grid-cols-13 gap-2 text-xs font-medium opacity-60 uppercase tracking-wide">
                <div className="col-span-2">Symbol</div>
                <div className="col-span-1 text-center">Side</div>
                <div className="col-span-1 text-right">Qty</div>
                <div className="col-span-1 text-right">Avg Price</div>
                <div className="col-span-1 text-right">Last</div>
                <div className="col-span-1 text-right">Market Value</div>
                <div className="col-span-1 text-right">Unrealized P&L</div>
                <div className="col-span-1 text-right">P&L per share</div>
                <div className="col-span-1 text-right">P&L %</div>
                <div className="col-span-1 text-right">Today's P&L</div>
                <div className="col-span-1 text-right">Time</div>
                <div className="col-span-1 text-center">Action</div>
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
                      className={`px-4 py-2 border-b border-[#2a2820] hover:bg-[#1e1d17] transition-colors ${
                        index % 2 === 0 ? 'bg-[#0f0e0a]' : 'bg-[#14130e]'
                      }`}
                    >
                      <div className="grid grid-cols-13 gap-2 items-center text-sm">
                        {/* Symbol */}
                        <div className="col-span-2">
                          <div className="font-semibold text-[#eae9e9]">{position.Symbol}</div>
                          <div className="text-xs opacity-60">{position.AssetType}</div>
                        </div>

                        {/* Side */}
                        <div className="col-span-1 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            isLong ? 'bg-[#1e3a2e] text-[#4ade80]' : 'bg-[#3a1e1e] text-[#f87171]'
                          }`}>
                            {position.LongShort}
                          </span>
                        </div>

                        {/* Quantity */}
                        <div className="col-span-1 text-right">
                          <div className="text-[#eae9e9] font-mono">{formatQuantity(position.Quantity)}</div>
                        </div>

                        {/* Average Price */}
                        <div className="col-span-1 text-right">
                          <div className="text-[#eae9e9] font-mono text-xs">{formatPrice(position.AveragePrice)}</div>
                        </div>

                        {/* Last */}
                        <div className="col-span-1 text-right">
                          <div className="text-[#eae9e9] font-mono text-xs">{formatPrice(position.Last)}</div>
                        </div>

                        {/* Market Value */}
                        <div className="col-span-1 text-right">
                          <div className="text-[#eae9e9] font-mono text-xs">{formatPrice(position.MarketValue)}</div>
                        </div>

                        {/* Unrealized P&L */}
                        <div className="col-span-1 text-right">
                          <div className={`font-semibold font-mono text-xs ${unrealizedPL >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                            {formatPrice(position.UnrealizedProfitLoss)}
                          </div>
                        </div>

                        {/* P&L per share */}
                        <div className="col-span-1 text-right">
                          <div className={`font-semibold font-mono text-xs ${parseFloat(position.UnrealizedProfitLossQty || '0') >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                            {formatPrice(position.UnrealizedProfitLossQty)}
                          </div>
                        </div>

                        {/* P&L % */}
                        <div className="col-span-1 text-right">
                          <div className={`font-semibold font-mono ${unrealizedPLPercent >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                            {formatPercent(position.UnrealizedProfitLossPercent)}
                          </div>
                        </div>

                        {/* Today's P&L */}
                        <div className="col-span-1 text-right">
                          <div className={`font-semibold font-mono text-xs ${todaysPL >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                            {formatPrice(position.TodaysProfitLoss)}
                          </div>
                        </div>

                        {/* Time */}
                        <div className="col-span-1 text-right">
                          <div className="text-xs opacity-60 font-mono">{formatTimestamp(position.Timestamp)}</div>
                        </div>

                        {/* Sell Button */}
                        <div className="col-span-1 text-center">
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

