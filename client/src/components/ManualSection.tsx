import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import NotificationContainer from './NotificationContainer';
import type { NotificationProps } from './Notification';
import ManualConfigPanel from './ManualConfigPanel';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';

interface IndicatorData {
  ema1m18: number | null;
  ema1m200: number | null;
  ema5m18: number | null;
  ema5m200: number | null;
  macd1m: { macd: number; signal: number; histogram: number } | null;
  macd5m: { macd: number; signal: number; histogram: number } | null;
  vwap1m: number | null;
}

interface ScoredStock {
  symbol: string;
  price: number;
  score: number;
  factors: {
    change2m: number;
    change5m: number;
    trades1m: number;
    trades2m: number;
    vol1m: number;
    vol2m: number;
    changeOpen: number;
    distVwap: number;
    cons1m: number;
    dailyVol: number;
  };
  indicators: IndicatorData | null;
  meetsExtra: {
    macd1mPos: boolean;
    closeOverEma1m: boolean;
    ema18Above200_5m: boolean;
  };
  rawRow: any;
}

interface NonQualifiedStock {
  symbol: string;
  price: number;
  reasons: string[];
  factors: {
    change2m: number;
    change5m: number;
    trades1m: number;
    trades2m: number;
    vol1m: number;
    vol2m: number;
    changeOpen: number;
    distVwap: number;
    cons1m: number;
    dailyVol: number;
  };
  rawRow: any;
}

interface AnalyzingStock {
  symbol: string;
  price: number;
  factors: any;
  rawRow: any;
}

interface Props {
  viewMode?: 'qualified' | 'non-qualified';
}

const ManualSection: React.FC<Props> = ({ viewMode = 'qualified' }) => {
  const { fetchWithAuth } = useAuth();
  const [manualList, setManualList] = useState<{
    qualified: ScoredStock[];
    nonQualified: NonQualifiedStock[];
    analyzing: AnalyzingStock[];
  }>({ qualified: [], nonQualified: [], analyzing: [] });

  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);

  // Buy functionality state
  const [buysEnabled, setBuysEnabled] = useState(false);
  const [isTogglingBuys, setIsTogglingBuys] = useState(false);
  const [buyingSymbols, setBuyingSymbols] = useState<Set<string>>(new Set());
  const [buyStatuses, setBuyStatuses] = useState<Record<string, 'success' | 'error' | null>>({});
  const [sellingSymbols, setSellingSymbols] = useState<Set<string>>(new Set());
  const [sellStatuses, setSellStatuses] = useState<Record<string, 'success' | 'error' | null>>({});
  const [notifications, setNotifications] = useState<NotificationProps[]>([]);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [buyQuantities, setBuyQuantities] = useState<Record<string, number>>({});
  const [editingQuantity, setEditingQuantity] = useState<string | null>(null);
  const [tempQuantity, setTempQuantity] = useState<Record<string, string>>({});
  const [buyCooldown, setBuyCooldown] = useState<number>(0); // Cooldown in seconds

  // Timeout for buy: allow 30s so broker API + retries can complete (avoids "timed out" on slow connections)
  const BUY_REQUEST_TIMEOUT_MS = 30000;
  const fetchWithTimeout = useCallback(
    (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = BUY_REQUEST_TIMEOUT_MS) => {
      const controller = new AbortController();
      const id = window.setTimeout(() => controller.abort(), timeoutMs);
      return fetchWithAuth(input, { ...init, signal: controller.signal })
        .finally(() => {
          window.clearTimeout(id);
        });
    },
    [fetchWithAuth]
  );

  useEffect(() => {
    // Initial load of buys enabled status
    const loadBuysStatus = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/buys/enabled`);
        const data = await res.json();
        if (data.success) setBuysEnabled(Boolean(data.data?.enabled));
      } catch (e) {
        console.error("Failed to load buys status", e);
      }
    };
    loadBuysStatus();
    
    // Load buy quantities
    const loadBuyQuantities = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/manual/buy-quantities`);
        const data = await res.json();
        if (data.success) setBuyQuantities(data.data || {});
      } catch (e) {
        console.error("Failed to load buy quantities", e);
      }
    };
    loadBuyQuantities();
  }, []);

  // Buy cooldown countdown effect
  useEffect(() => {
    if (buyCooldown <= 0) return;
    
    const interval = setInterval(() => {
      setBuyCooldown(prev => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [buyCooldown]);

  useEffect(() => {
    const connect = () => {
      setConnectionStatus('connecting');
      wsRef.current = new WebSocket(WS_BASE_URL);

      wsRef.current.onopen = () => {
        setConnectionStatus('connected');
      };

      wsRef.current.onclose = () => {
        setConnectionStatus('disconnected');
        setTimeout(connect, 3000);
      };

      wsRef.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          
          if (msg.type === 'MANUAL_LIST_UPDATE') {
            setManualList({
              qualified: msg.data.qualified || [],
              nonQualified: msg.data.nonQualified || [],
              analyzing: msg.data.analyzing || []
            });
            setIsInitialLoad(false);
          }
        } catch (err) {
          console.error(err);
        }
      };
    };

    connect();
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const formatNumber = (num: number, decimals = 2) => num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const addNotification = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration?: number) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, { id, message, type, duration, onClose: () => {} }]);
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const toggleBuys = async () => {
    if (isTogglingBuys) return;
    setIsTogglingBuys(true);
    try {
      const resp = await fetch(`${API_BASE_URL}/buys/enabled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !buysEnabled })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.success) {
        setBuysEnabled(Boolean(data.data?.enabled));
      }
    } catch {
    } finally {
      setIsTogglingBuys(false);
    }
  };

  const handleBuyClick = useCallback(async (symbol: string | null | undefined, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (!symbol) return;
    
    const cleanSymbol = String(symbol).trim().toUpperCase();
    
    // Early return check BEFORE setting state
    if (buyingSymbols.has(cleanSymbol)) return; // Prevent duplicate clicks
    
    // CRITICAL: Set loading state IMMEDIATELY and synchronously
    // Use multiple state updates in sequence to ensure React processes them
    setBuyingSymbols(prev => {
      if (prev.has(cleanSymbol)) return prev; // Already processing
      const newSet = new Set(prev);
      newSet.add(cleanSymbol);
      return newSet;
    });
    setBuyStatuses(prev => ({ ...prev, [cleanSymbol]: null }));
    
    // Force a microtask to ensure state is updated before async work
    // This ensures the button's disabled state is applied immediately
    await Promise.resolve();
    
    try {
      const resp = await fetchWithTimeout(
        `${API_BASE_URL}/buys/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: cleanSymbol })
        },
        BUY_REQUEST_TIMEOUT_MS
      );
      
      if (!resp.ok) {
        // HTTP error (500, etc) - try to get error message
        const errorData = await resp.json().catch(() => ({ error: `HTTP ${resp.status}: ${resp.statusText}` }));
        const errorMsg = errorData.error || `HTTP ${resp.status}`;
        addNotification(`Failed to buy ${cleanSymbol}: ${errorMsg}`, 'error');
        setBuyStatuses(prev => ({ ...prev, [cleanSymbol]: 'error' }));
        setTimeout(() => {
          setBuyStatuses(prev => {
            const next = { ...prev };
            delete next[cleanSymbol];
            return next;
          });
        }, 3000);
        return;
      }
      
      const data = await resp.json().catch(() => ({}));
      
      if (data?.success) {
        const quantity = data.data?.quantity || 'N/A';
        const limitPrice = data.data?.limitPrice ? `$${parseFloat(data.data.limitPrice).toFixed(2)}` : 'N/A';
        console.log(`✅ Buy signal sent for ${cleanSymbol}:`, data.data?.notifyStatus);
        addNotification(`Buy order sent successfully for ${quantity} ${cleanSymbol} at ${limitPrice}`, 'success');
        setBuyStatuses(prev => ({ ...prev, [cleanSymbol]: 'success' }));
        
        // Start 5-second cooldown for all BUY buttons
        setBuyCooldown(5);
        
        // Clear status after 3 seconds
        setTimeout(() => {
          setBuyStatuses(prev => {
            const next = { ...prev };
            delete next[cleanSymbol];
            return next;
          });
        }, 3000);
      } else {
        const errorMsg = data.error || data.data?.notifyStatus || 'Unknown error';
        console.error(`❌ Failed to send buy signal for ${cleanSymbol}:`, errorMsg);
        addNotification(`Failed to buy ${cleanSymbol}: ${errorMsg}`, 'error');
        setBuyStatuses(prev => ({ ...prev, [cleanSymbol]: 'error' }));
        setTimeout(() => {
          setBuyStatuses(prev => {
            const next = { ...prev };
            delete next[cleanSymbol];
            return next;
          });
        }, 3000);
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        console.error(`⏱️ Timeout sending buy signal for ${cleanSymbol}`, error);
        addNotification(`Buy request for ${cleanSymbol} timed out. Please check connection or try again.`, 'error');
      } else {
        const errorMsg = error.message || 'Unknown error';
        console.error(`❌ Error sending buy signal for ${cleanSymbol}:`, error);
        addNotification(`Error buying ${cleanSymbol}: ${errorMsg}`, 'error');
      }
      setBuyStatuses(prev => ({ ...prev, [cleanSymbol]: 'error' }));
      setTimeout(() => {
        setBuyStatuses(prev => {
          const next = { ...prev };
          delete next[cleanSymbol];
          return next;
        });
      }, 3000);
    } finally {
      // Always clean up loading state
      setBuyingSymbols(prev => {
        const next = new Set(prev);
        next.delete(cleanSymbol);
        return next;
      });
    }
  }, [buyingSymbols, fetchWithAuth]);

  // Helper function to get price group from price
  const getPriceGroup = (price: number): string | null => {
    if (price > 0 && price <= 5) return '0-5';
    if (price > 5 && price <= 10) return '5-10';
    if (price > 10 && price <= 12) return '10-12';
    if (price > 12 && price <= 20) return '12-20';
    if (price > 20 && price <= 30) return '20-30';
    return null;
  };

  const handleQuantityChange = async (priceGroup: string, quantity: string) => {
    const num = parseInt(quantity) || 0;
    if (num <= 0) return;
    
    // Close all editing states for this price group (all symbols in the same price group)
    // This ensures when one row saves, all other rows with the same price group exit edit mode
    setEditingQuantity(null);
    
    try {
      const resp = await fetch(`${API_BASE_URL}/manual/buy-quantities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyQuantities: { [priceGroup]: num } })
      });
      
      const data = await resp.json();
      if (data.success) {
        setBuyQuantities(prev => ({ ...prev, ...data.data }));
        addNotification(`Buy quantity for ${priceGroup} updated to ${num}`, 'success');
      } else {
        addNotification(`Failed to update buy quantity: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (error: any) {
      console.error('Error updating buy quantity:', error);
      addNotification(`Error updating buy quantity: ${error.message || 'Unknown error'}`, 'error');
    }
  };

  const getQuantityForPrice = (price: number): number => {
    const priceGroup = getPriceGroup(price);
    if (!priceGroup) return 0;
    return buyQuantities[priceGroup] || 0;
  };

  const { qualified: scoredStocks, nonQualified, analyzing } = manualList;
  const poolSize = scoredStocks.length + nonQualified.length + analyzing.length;
  
  const title = viewMode === 'qualified' ? 'MANUAL Live Ranking' : 'NON-QUALIFIED Stocks';
  
  // Initial Loading Screen
  if (isInitialLoad) {
    return (
      <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9] p-4 overflow-hidden">
        <div className="flex justify-between items-center mb-4 border-b border-[#2a2820] pb-4">
          <div>
            <h2 className="text-xl font-bold text-[#eae9e9]">{title}</h2>
            <p className="text-xs text-[#808080] mt-1">Loading data...</p>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-[#eab308] animate-pulse"></div>
            <span className="text-xs text-[#808080] uppercase">INITIALIZING</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center space-y-4 text-[#808080]">
          <div className="w-8 h-8 border-2 border-[#2a2820] border-t-[#808080] rounded-full animate-spin"></div>
          <p className="text-xs tracking-wider uppercase">Connecting to market data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9] p-4 overflow-hidden relative">
      <NotificationContainer notifications={notifications} onRemove={removeNotification} />

      <div className="flex justify-between items-center mb-4 border-b border-[#2a2820] pb-4">
        <div>
          <h2 className="text-xl font-bold text-[#eae9e9]">{title}</h2>
          <p className="text-xs text-[#808080] mt-1">
            {viewMode === 'qualified' 
              ? 'Top 10 Opportunities • Scoring Strategy: Momentum Intraday' 
              : 'Stocks failing technical criteria (MACD, Histogram, EMA)'}
          </p>
        </div>
        <div className="flex items-center space-x-4">
          {viewMode === 'qualified' && (
            <>
              <button
                className={`px-3 py-1 rounded-sm text-[11px] font-bold transition-all ${isTogglingBuys ? 'bg-[#2a2820] cursor-not-allowed opacity-50' : (buysEnabled ? 'bg-[#22c55e] text-[#14130e] hover:bg-[#16a34a] shadow-[0_0_8px_rgba(34,197,94,0.3)]' : 'bg-[#f87171] text-[#14130e] hover:bg-[#ef4444] shadow-[0_0_8px_rgba(248,113,113,0.3)]')}`}
                onClick={toggleBuys}
                disabled={isTogglingBuys}
                title={buysEnabled ? 'Disable automatic buys' : 'Enable automatic buys'}
              >{isTogglingBuys ? '...' : (buysEnabled ? 'Buys: ON' : 'Buys: OFF')}</button>
              <button
                className="px-3 py-1 rounded-sm text-[11px] font-bold transition-all bg-[#2a2820] text-[#eae9e9] hover:bg-[#3a3830] border border-[#404040]"
                onClick={() => setShowConfigModal(true)}
                title="Open scoring configuration"
              >
                Config
              </button>
            </>
          )}

          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-[#22c55e]' : 'bg-[#f87171]'}`}></div>
            <span className="text-xs text-[#808080] uppercase">{connectionStatus}</span>
          </div>
          <div className="text-xs text-[#808080]">
            Pool: {poolSize} | Qualified: {scoredStocks.length} | Non-Qualified: {nonQualified.length} | Analyzing: {analyzing.length}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-6">
        {/* QUALIFIED SECTION */}
        {viewMode === 'qualified' && (
          <div className="rounded-lg border border-[#2a2820] bg-[#0f0e0a]">
            <div className="p-2 border-b border-[#2a2820] bg-[#1a1915] sticky top-0">
              <h3 className="text-sm font-bold text-[#4ade80]">QUALIFIED STOCKS ({scoredStocks.length})</h3>
            </div>
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-[#1a1915]">
                <tr>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium">Rank</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium">Symbol</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">Score</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">Price</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-center">MACD 1m+</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-center">Close {'>'} EMA18</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-center">EMA 18 5m {'>'} EMA 200 5m</th>
                  {/* Factors */}
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="Distance VWAP (20%)">VWAP %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="2m Change (15%)">2m %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="5m Change (15%)">5m %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="1m Trades (8%)">1m Trd</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="2m Trades (8%)">2m Trd</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="1m Vol (8%)">1m Vol</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="2m Vol (8%)">2m Vol</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="Open Chg (8%)">Open %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="Cons 1m (5%)">Cons</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="Daily Vol (5%)">Day Vol</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {scoredStocks.map((stock, idx) => (
                  <React.Fragment key={stock.symbol}>
                    <tr className="hover:bg-[#1e1d17] transition-colors border-t border-[#2a2820]/50">
                      <td className="p-3 font-bold text-[#eae9e9] w-12 text-center bg-[#1a1915]/50">{idx + 1}</td>
                      <td className="p-3 font-bold text-[#4ade80]">{stock.symbol}</td>
                      <td className="p-3 text-right font-mono font-bold text-[#facc15]">{stock.score.toFixed(1)}</td>
                      <td className="p-3 text-right font-mono">${formatNumber(stock.price)}</td>
                      
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded ${stock.meetsExtra.macd1mPos ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#2a2820] text-[#808080]'}`}>
                          {stock.meetsExtra.macd1mPos ? 'YES' : 'NO'}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded ${stock.meetsExtra.closeOverEma1m ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#2a2820] text-[#808080]'}`}>
                          {stock.meetsExtra.closeOverEma1m ? 'YES' : 'NO'}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded ${stock.meetsExtra.ema18Above200_5m ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#2a2820] text-[#808080]'}`}>
                          {stock.meetsExtra.ema18Above200_5m ? 'YES' : 'NO'}
                        </span>
                      </td>

                      <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.distVwap)}%</td>
                      <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.change2m)}%</td>
                      <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.change5m)}%</td>
                      <td className="p-3 text-right font-mono text-[#eae9e9]/80">{Math.round(stock.factors.trades1m)}</td>
                      <td className="p-3 text-right font-mono text-[#eae9e9]/80">{Math.round(stock.factors.trades2m)}</td>
                      <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.vol1m / 1000, 0)}k</td>
                      <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.vol2m / 1000, 0)}k</td>
                      <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.changeOpen)}%</td>
                      <td className="p-3 text-right font-mono text-[#eae9e9]/80">{stock.factors.cons1m}</td>
                      <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.dailyVol / 1000000, 1)}M</td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          {(() => {
                            const symbolVal = stock.symbol;
                            const cleanSymbol = String(symbolVal).trim().toUpperCase();
                            const isBuying = buyingSymbols.has(cleanSymbol);
                            const status = buyStatuses[cleanSymbol];
                            const isCooldownActive = buyCooldown > 0;
                            const isDisabled = isBuying || isCooldownActive;
                            
                            let buttonClass = 'px-2 py-0.5 text-[11px] font-semibold rounded transition-colors';
                            let buttonText = 'BUY';
                            let buttonTitle = `Send buy signal for ${symbolVal}`;
                            
                            if (isBuying) {
                              buttonClass += ' bg-[#2a2820] cursor-not-allowed opacity-50';
                              buttonText = '...';
                              buttonTitle = `Sending buy signal for ${symbolVal}...`;
                            } else if (isCooldownActive) {
                              buttonClass += ' bg-[#2a2820] cursor-not-allowed opacity-50';
                              buttonText = `${buyCooldown}s`;
                              buttonTitle = `Buy cooldown active. Wait ${buyCooldown} second${buyCooldown !== 1 ? 's' : ''} before buying again.`;
                            } else if (status === 'success') {
                              buttonClass += ' bg-[#4ade80] text-[#14130e]';
                              buttonText = '✓';
                              buttonTitle = `Buy signal sent successfully for ${symbolVal}`;
                            } else if (status === 'error') {
                              buttonClass += ' bg-[#f87171] text-[#14130e]';
                              buttonText = '✗';
                              buttonTitle = `Failed to send buy signal for ${symbolVal}`;
                            } else {
                              // Default style for MANUAL section
                              buttonClass += ' bg-[#4ade80] text-[#14130e] hover:bg-[#22c55e]';
                            }
                            
                            return (
                              <button
                                onClick={(e) => {
                                  if (!isDisabled) {
                                    handleBuyClick(symbolVal, e);
                                  }
                                }}
                                disabled={isDisabled}
                                className={`${buttonClass} transition-all duration-75 ${!isDisabled ? 'active:scale-95' : 'pointer-events-none'}`}
                                title={buttonTitle}
                              >
                                {buttonText}
                              </button>
                            );
                          })()}
                          
                          {(() => {
                            const symbolVal = stock.symbol;
                            const cleanSymbol = String(symbolVal).trim().toUpperCase();
                            const priceGroup = getPriceGroup(stock.price);
                            const currentQuantity = priceGroup ? getQuantityForPrice(stock.price) : 0;
                            // Use symbol as the editing key so each row can edit independently
                            const isEditing = editingQuantity === cleanSymbol;
                            
                            if (!priceGroup) {
                              return (
                                <span className="text-[10px] text-[#808080] px-2">N/A</span>
                              );
                            }
                            
                            if (isEditing) {
                              return (
                                <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="number"
                                    min="1"
                                    value={tempQuantity[cleanSymbol] ?? currentQuantity}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      setTempQuantity(prev => ({ ...prev, [cleanSymbol]: e.target.value }));
                                    }}
                                    onBlur={(e) => {
                                      e.stopPropagation();
                                      const value = tempQuantity[cleanSymbol];
                                      const numValue = parseInt(value || '0');
                                      if (value && numValue > 0) {
                                        handleQuantityChange(priceGroup, value);
                                      } else {
                                        setEditingQuantity(null);
                                        setTempQuantity(prev => {
                                          const next = { ...prev };
                                          delete next[cleanSymbol];
                                          return next;
                                        });
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        const value = tempQuantity[cleanSymbol];
                                        const numValue = parseInt(value || '0');
                                        if (value && numValue > 0) {
                                          handleQuantityChange(priceGroup, value);
                                        } else {
                                          setEditingQuantity(null);
                                          setTempQuantity(prev => {
                                            const next = { ...prev };
                                            delete next[cleanSymbol];
                                            return next;
                                          });
                                        }
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setEditingQuantity(null);
                                        setTempQuantity(prev => {
                                          const next = { ...prev };
                                          delete next[cleanSymbol];
                                          return next;
                                        });
                                      }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    autoFocus
                                    className="w-16 px-1.5 py-0.5 text-[11px] bg-[#0f0e0a] border border-[#4ade80] rounded text-[#eae9e9] focus:outline-none focus:ring-1 focus:ring-[#4ade80]"
                                  />
                                  <span className="text-[10px] text-[#808080]">({priceGroup})</span>
                                </div>
                              );
                            }
                            
                            return (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setEditingQuantity(cleanSymbol);
                                  setTempQuantity(prev => ({ ...prev, [cleanSymbol]: String(currentQuantity) }));
                                }}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                className="px-2 py-0.5 text-[11px] font-semibold rounded transition-colors bg-[#2a2820] text-[#eae9e9] hover:bg-[#3a3830] border border-[#404040]"
                                title={`Click to edit buy quantity for ${priceGroup} price group (affects all stocks in this price range)`}
                              >
                                {currentQuantity > 0 ? currentQuantity : 'Set'} ({priceGroup})
                              </button>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
                {scoredStocks.length === 0 && (
                  <tr>
                    <td colSpan={18} className="p-8 text-center text-[#808080]">
                      {analyzing.length > 0 ? (
                        <div className="flex flex-col items-center justify-center py-4 space-y-3">
                          <div className="w-6 h-6 border-2 border-[#2a2820] border-t-[#4ade80] rounded-full animate-spin"></div>
                          <span className="text-[#4ade80]">Analyzing {analyzing.length} candidates...</span>
                          <span className="text-xs opacity-60">Waiting for technical indicators</span>
                        </div>
                      ) : (
                        <>
                          No stocks meeting strict technical criteria at the moment.
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* NON-QUALIFIED SECTION */}
        {viewMode === 'non-qualified' && (
          <div className="rounded-lg border border-[#2a2820] bg-[#0f0e0a]">
            <div className="p-2 border-b border-[#2a2820] bg-[#1a1915] sticky top-0">
              <h3 className="text-sm font-bold text-[#f87171]">NON-QUALIFIED ({nonQualified.length})</h3>
            </div>
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-[#1a1915]">
                <tr>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium">Symbol</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium">Disqualification Reasons</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">Price</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">2m %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">5m %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">Vol 1m</th>
                </tr>
              </thead>
              <tbody>
                {nonQualified.map((stock) => (
                  <tr key={stock.symbol} className="hover:bg-[#1e1d17] transition-colors border-b border-[#2a2820]/50 last:border-0 opacity-75 hover:opacity-100">
                    <td className="p-3 font-bold text-[#f87171]">{stock.symbol}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {stock.reasons.map((reason, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-[#f87171]/10 text-[#f87171] rounded text-[10px] border border-[#f87171]/20">
                            {reason}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono text-[#808080]">${formatNumber(stock.price)}</td>
                    <td className="p-3 text-right font-mono text-[#808080]">{formatNumber(stock.factors.change2m)}%</td>
                    <td className="p-3 text-right font-mono text-[#808080]">{formatNumber(stock.factors.change5m)}%</td>
                    <td className="p-3 text-right font-mono text-[#808080]">{formatNumber(stock.factors.vol1m / 1000, 0)}k</td>
                  </tr>
                ))}
                {nonQualified.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-[#808080]">
                      {analyzing.length > 0 ? (
                        <div className="flex flex-col items-center justify-center py-4 space-y-3">
                          <div className="w-6 h-6 border-2 border-[#2a2820] border-t-[#f87171] rounded-full animate-spin"></div>
                          <span className="text-[#f87171]">Analyzing {analyzing.length} potential failures...</span>
                        </div>
                      ) : (
                        "No non-qualified stocks (all pool stocks passed or pool is empty)."
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Config Modal */}
      {showConfigModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowConfigModal(false)}
        >
          <div 
            className="bg-[#14130e] border border-[#2a2820] rounded-lg shadow-2xl w-[90vw] h-[90vh] max-w-6xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#2a2820]">
              <h3 className="text-lg font-bold text-[#eae9e9]">Scoring Configuration</h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-[#808080] hover:text-[#eae9e9] transition-colors p-1"
                title="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="flex-1 overflow-hidden">
              <ManualConfigPanel />
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ManualSection;