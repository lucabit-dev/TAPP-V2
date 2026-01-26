import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { useAuth } from './auth/AuthContext';
import { Virtuoso } from 'react-virtuoso';
import { formatTimestampRelative } from './utils/timeFormat';
import './App.css';

// Import FloatRawListsSection directly to avoid lazy loading issues
import FloatRawListsSection from './components/FloatRawListsSection';
// Import ManualSection directly
import ManualSection from './components/ManualSection';

// Lazy load all heavy components with code splitting
const TradingDashboard = lazy(() => import('./components/TradingDashboard'));
const FloatListsSection = lazy(() => import('./components/FloatListsSection'));
const FloatConfigPanel = lazy(() => import('./components/FloatConfigPanel'));
const ManualConfigPanel = lazy(() => import('./components/ManualConfigPanel'));
const BuyListSection = lazy(() => import('./components/BuyListSection'));
// const FloatRawListsSection = lazy(() => import('./components/FloatRawListsSection'));
const PositionsWithStopLimitSection = lazy(() => import('./components/PositionsSection'));
const OrdersSection = lazy(() => import('./components/OrdersSection'));
const L2Section = lazy(() => import('./components/L2Section'));
const ChartsSection = lazy(() => import('./components/ChartsSection'));
const Login = lazy(() => import('./components/Login'));

// Loading fallback component - Minimalistic design
const LoadingFallback = () => (
  <div className="h-screen w-screen flex items-center justify-center text-[#eae9e9] bg-[#14130e]">
    <div className="flex flex-col items-center space-y-4">
      {/* Minimal spinner */}
      <div className="w-8 h-8 border-2 border-[#2a2820] border-t-[#808080] rounded-full animate-spin"></div>
      <p className="text-xs text-[#808080] uppercase tracking-wider">Loading</p>
    </div>
  </div>
);

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';

interface Alert {
  ticker: string;
  timestamp: string;
  price?: number;
  volume?: number;
  change?: number;
  changePercent?: number;
  indicators: {
    ema1m12: number | null;
    ema1m18: number | null;
    ema1m20: number | null;
    ema1m26: number | null;
    ema1m200: number | null;
    ema5m12: number | null;
    ema5m18: number | null;
    ema5m20: number | null;
    ema5m26: number | null;
    ema5m200: number | null;
    macd1m: {
      macd: number;
      signal: number;
      histogram: number;
    } | null;
    macd5m: {
      macd: number;
      signal: number;
      histogram: number;
    } | null;
    vwap1m: number | null;
    lod: number | null;
    hod: number | null;
  };
  evaluation: {
    score: string;
    allConditionsMet: boolean;
    failedConditions?: Array<{
      name: string;
      expected: string;
      actual: string;
    }>;
  };
  lastCandle: {
    close: number;
    volume: number;
  } | null;
  companyInfo?: {
    symbol: string;
    name: string;
    market: string;
    primaryExchange: string;
    currency: string;
    description: string;
  };
  currentPrice?: number;
  chartswatcherData?: {
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    change: number | null;
    changePercent: number | null;
    rawColumns: Array<{ key: string; value: any }> | null;
    alertType: string | null;
    color: string | null;
    textColor: string | null;
  };
}

interface ChartsWatcherStatus {
  isConnected: boolean;
  reconnectAttempts: number;
  alertCount: number;
  configID: string;
}

function App() {
  const { isAuthenticated, logout } = useAuth();
  const [allAlerts, setAllAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [chartsWatcherStatus, setChartsWatcherStatus] = useState<ChartsWatcherStatus | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [newValidAlertsCount, setNewValidAlertsCount] = useState(0);
  const [conditionStats, setConditionStats] = useState<any>(null);
  const [showStats, setShowStats] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'all' | 'valid' | 'filtered' | 'dashboard' | 'config-float' | 'listas-float-raw' | 'manual' | 'manual-non-qualified' | 'buy-list' | 'positions' | 'orders' | 'stoplimit' | 'l2' | 'charts'>('manual');
  const [alertsCollapsed, setAlertsCollapsed] = useState(true); // Start collapsed
  const [listsCollapsed, setListsCollapsed] = useState(false); // Start expanded by default for Lists
  const [manualCollapsed, setManualCollapsed] = useState(false); // Start expanded by default for Manual
  const [manualSymbol, setManualSymbol] = useState('');
  const [manualAnalysis, setManualAnalysis] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const [isHeaderAnimating, setIsHeaderAnimating] = useState(false);
  const [isHidingHeader, setIsHidingHeader] = useState(false);
  const [showStockInfoModal, setShowStockInfoModal] = useState(false);
  const [selectedStockInfo, setSelectedStockInfo] = useState<any>(null);
  const [additionalFilters, setAdditionalFilters] = useState({
    vwapAboveEma200: false,
    vwapAboveEma18: false
  });
  const alertsEndRef = useRef<HTMLDivElement>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Keep scroll position at top when new alerts arrive
  const scrollToTop = () => {
    const alertsContainer = document.querySelector('.alerts-container');
    if (alertsContainer) {
      alertsContainer.scrollTop = 0;
    }
  };

  useEffect(() => {
    if (newValidAlertsCount > 0) {
      scrollToTop();
    }
  }, [newValidAlertsCount]);

  const fetchAlerts = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('Fetching live alerts...');
      
      const response = await fetch(`${API_BASE_URL}/alerts/processed`);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(`API error: ${data.error}`);
      }

      // Combine valid and filtered alerts, sorted by timestamp (newest first)
      const combinedAlerts = [
        ...(data.data.valid || []),
        ...(data.data.filtered || [])
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Check for new valid alerts only
      const previousValidCount = allAlerts.filter(alert => alert.evaluation.allConditionsMet).length;
      setAllAlerts(combinedAlerts);
      
      const currentValidCount = combinedAlerts.filter(alert => alert.evaluation.allConditionsMet).length;
      if (currentValidCount > previousValidCount) {
        setNewValidAlertsCount(currentValidCount - previousValidCount);
        setTimeout(() => setNewValidAlertsCount(0), 3000);
      }
      
      setLastUpdated(new Date());
      console.log(`Fetched ${combinedAlerts.length} total alerts`);
      
    } catch (err) {
      console.error('Error fetching alerts:', err);
      setError(err instanceof Error ? err.message : 'An error occurred while fetching alerts');
    } finally {
      setLoading(false);
    }
  };

  // Fetch ChartsWatcher status
  const fetchChartsWatcherStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/chartswatcher/status`);
      const data = await response.json();
      if (data.success) {
        setChartsWatcherStatus(data.data);
      }
    } catch (error) {
      console.error('Error fetching ChartsWatcher status:', error);
    }
  };

  // Fetch condition statistics
  const fetchConditionStats = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/statistics/conditions`);
      const data = await response.json();
      if (data.success) {
        setConditionStats(data.data);
      }
    } catch (error) {
      console.error('Error fetching condition statistics:', error);
    }
  };

  // Analyze manual symbol
  const analyzeSymbol = async () => {
    if (!manualSymbol.trim()) return;
    
    setIsAnalyzing(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/analyze/${manualSymbol.trim().toUpperCase()}`);
      const data = await response.json();
      
      if (data.success) {
        setManualAnalysis(data.data);
      } else {
        setError(data.message || 'Failed to analyze symbol');
      }
    } catch (err) {
      console.error('Error analyzing symbol:', err);
      setError('Failed to analyze symbol. Please check if the backend is running.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Close analysis modal and reset state
  const closeAnalysisModal = () => {
    setShowAnalysisModal(false);
    setManualSymbol('');
    setManualAnalysis(null);
    setError(null);
  };

  // Fetch detailed stock information
  const fetchStockInfo = useCallback(async (symbol: string) => {
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/stock/${symbol}`);
      const data = await response.json();
      
      if (data.success) {
        setSelectedStockInfo((prev: any) => {
          // Preserve original chartswatcherData from the alert
          const originalChartswatcherData = prev.chartswatcherData;
          
          console.log('🔄 Merging stock info - preserving chartswatcherData:', originalChartswatcherData);
          
          return {
            ...prev,
            ...data.data,
            // Override chartswatcherData only if original has more data
            chartswatcherData: originalChartswatcherData?.rawColumns 
              ? originalChartswatcherData 
              : data.data.chartswatcherData,
            isLoading: false
          };
        });
      } else {
        setSelectedStockInfo((prev: any) => ({
          ...prev,
          isLoading: false,
          error: data.error || 'Failed to fetch stock information'
        }));
      }
    } catch (err) {
      console.error('Error fetching stock info:', err);
      setSelectedStockInfo((prev: any) => ({
        ...prev,
        isLoading: false,
        error: 'Failed to fetch stock information. Please check if the backend is running.'
      }));
    }
  }, [API_BASE_URL]);

  // Handle alert click to show stock info
  const handleAlertClick = useCallback((alert: Alert) => {
    console.log('🖱️ Alert clicked:', alert.ticker);
    console.log('📊 Alert data:', alert);
    console.log('📋 ChartsWatcher data:', alert.chartswatcherData);
    
    // Open modal immediately with basic alert data including chartswatcherData
    setSelectedStockInfo({
      ticker: alert.ticker,
      timestamp: alert.timestamp,
      price: alert.price,
      volume: alert.volume,
      change: alert.change,
      changePercent: alert.changePercent,
      indicators: alert.indicators,
      evaluation: alert.evaluation,
      lastCandle: alert.lastCandle,
      companyInfo: alert.companyInfo,
      currentPrice: alert.currentPrice,
      chartswatcherData: alert.chartswatcherData,
      alert: alert,
      isLoading: true
    });
    setShowStockInfoModal(true);
    
    // Then fetch detailed information (only if we need company info)
    if (!alert.companyInfo) {
      fetchStockInfo(alert.ticker);
    } else {
      // Already have all data, just mark as loaded
      setSelectedStockInfo((prev: any) => ({
        ...prev,
        isLoading: false
      }));
    }
  }, [fetchStockInfo]);

  

  // Close stock info modal
  const closeStockInfoModal = () => {
    setShowStockInfoModal(false);
    setSelectedStockInfo(null);
    setError(null);
  };

  // WebSocket connection for real-time alerts
  useEffect(() => {
    if (isLiveMode) {
      const connectWebSocket = () => {
        try {
          wsRef.current = new WebSocket(WS_BASE_URL);
          
          wsRef.current.onopen = () => {
            console.log('🔌 Connected to backend WebSocket');
          };
          
          wsRef.current.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              if (message.type === 'NEW_ALERT') {
                console.log('🚨 Received real-time alert:', message.data.ticker);
                
                setAllAlerts(prev => {
                  const newAlert = message.data;
                  const exists = prev.some(alert => 
                    alert.ticker === newAlert.ticker && 
                    alert.timestamp === newAlert.timestamp
                  );
                  
                  if (!exists) {
                    // Only show notification for valid signals
                    if (newAlert.evaluation.allConditionsMet) {
                      setNewValidAlertsCount(prev => prev + 1);
                      setTimeout(() => setNewValidAlertsCount(0), 3000);
                    }
                    return [newAlert, ...prev];
                  }
                  return prev;
                });
                
                setLastUpdated(new Date());
                fetchConditionStats();
              }
            } catch (error) {
              console.error('Error parsing WebSocket message:', error);
            }
          };
          
          wsRef.current.onclose = () => {
            console.log('🔌 WebSocket connection closed');
            setTimeout(connectWebSocket, 3000);
          };
          
          wsRef.current.onerror = (error) => {
            console.error('WebSocket error:', error);
          };
        } catch (error) {
          console.error('Error connecting to WebSocket:', error);
        }
      };
      
      connectWebSocket();
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isLiveMode]);

  // Set up live updates
  useEffect(() => {
    fetchAlerts();
    fetchChartsWatcherStatus();
    fetchConditionStats();
    
    if (isLiveMode && !wsRef.current) {
      refreshIntervalRef.current = setInterval(() => {
        fetchAlerts();
        fetchConditionStats();
      }, 5000);
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [isLiveMode]);

  // Status check every 10 seconds
  useEffect(() => {
    const statusInterval = setInterval(fetchChartsWatcherStatus, 10000);
    return () => clearInterval(statusInterval);
  }, []);

  const handleRefresh = useCallback(() => {
    fetchAlerts();
    fetchConditionStats();
  }, []);

  const toggleLiveMode = useCallback(() => {
    setIsLiveMode(prev => !prev);
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  }, []);

  const handleHideHeader = () => {
    setIsHidingHeader(true);
    setIsHeaderAnimating(true);
    setTimeout(() => {
      setIsHeaderHidden(true);
      setIsHeaderAnimating(false);
      setIsHidingHeader(false);
    }, 300);
  };

  const handleShowHeader = () => {
    setIsHidingHeader(false);
    setIsHeaderAnimating(true);
    setIsHeaderHidden(false);
    setTimeout(() => {
      setIsHeaderAnimating(false);
    }, 300);
  };

  const handleToggleHeader = () => {
    if (isHeaderHidden) {
      handleShowHeader();
    } else {
      handleHideHeader();
    }
  };

  const formatTimestamp = (timestamp: string) => {
    // Use the relative formatter which shows UTC-4 for times older than 1 hour
    const relative = formatTimestampRelative(timestamp);
    return relative.endsWith('m') || relative.endsWith('s') ? `${relative} ago` : relative;
  };

  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  const formatPriceFull = (price: number) => {
    return price.toFixed(6);
  };

  const formatIndicator = (value: number | null, decimals = 4) => {
    if (value === null) return 'N/A';
    return value.toFixed(decimals);
  };

  // Apply additional filters to valid alerts
  const applyAdditionalFilters = (alerts: Alert[]) => {
    if (!additionalFilters.vwapAboveEma200 && !additionalFilters.vwapAboveEma18) {
      return alerts;
    }

    return alerts.filter(alert => {
      let passesFilters = true;

      // Check VWAP > EMA 200 (1m)
      if (additionalFilters.vwapAboveEma200) {
        const vwap = alert.indicators.vwap1m;
        const ema200 = alert.indicators.ema1m200;
        if (!vwap || !ema200 || vwap <= ema200) {
          passesFilters = false;
        }
      }

      // Check VWAP > EMA 18 (1m)
      if (additionalFilters.vwapAboveEma18) {
        const vwap = alert.indicators.vwap1m;
        const ema18 = alert.indicators.ema1m18;
        if (!vwap || !ema18 || vwap <= ema18) {
          passesFilters = false;
        }
      }

      return passesFilters;
    });
  };

  const baseValidAlerts = useMemo(() => {
    return allAlerts.filter(alert => alert.evaluation.allConditionsMet);
  }, [allAlerts]);

  const validAlerts = useMemo(() => {
    return applyAdditionalFilters(baseValidAlerts);
  }, [baseValidAlerts, additionalFilters]);

  const filteredAlerts = useMemo(() => {
    return allAlerts.filter(alert => !alert.evaluation.allConditionsMet);
  }, [allAlerts]);

  const visibleAlerts = useMemo(() => {
    switch (selectedTab) {
      case 'valid':
        return validAlerts;
      case 'filtered':
        return filteredAlerts;
      case 'all':
      default:
        return allAlerts;
    }
  }, [selectedTab, allAlerts, validAlerts, filteredAlerts]);

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <Login />
      </Suspense>
    );
  }

  return (
    <div className="h-screen bg-[#14130e] text-[#eae9e9] flex flex-col overflow-hidden">
      {/* Clean Minimalist Header */}
      {(!isHeaderHidden || isHeaderAnimating) && (
        <header className={`bg-gradient-to-r from-[#14130e] to-[#0f0e0a] border-b border-[#2a2820]/50 backdrop-blur-sm ${isHidingHeader ? 'header-exit' : 'header-enter'}`}>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <img src="/images/logo.png" alt="ASTOR" className="h-8 w-auto" />
              </div>
              
              {/* Navigation Sections - Right */}
              <div className="flex items-center space-x-6">
                {/* Logout button */}
                <button
                  onClick={logout}
                  className="flex items-center space-x-2 px-3 py-1.5 text-xs font-medium text-[#969696] 
                           hover:text-[#f87171] transition-colors duration-200 border border-[#2a2820] 
                           rounded-lg hover:border-[#f87171]/30 hover:bg-[#f87171]/5"
                  title="Logout"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span>Logout</span>
                </button>
                {/* Alerts group - Collapsible */}
                {/* <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setAlertsCollapsed(!alertsCollapsed)}
                    className="flex items-center space-x-1 px-2 py-1 text-xs opacity-60 hover:opacity-100 transition-colors"
                    title={alertsCollapsed ? 'Expand Alerts' : 'Collapse Alerts'}
                  >
                    <span>Alerts</span>
                    <svg 
                      className={`w-3 h-3 transition-transform ${alertsCollapsed ? 'rotate-0' : 'rotate-180'}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {!alertsCollapsed && [
                    { key: 'dashboard', label: 'Dashboard', count: validAlerts.length },
                    { key: 'all', label: 'All', count: allAlerts.length },
                    { key: 'valid', label: 'Valid', count: validAlerts.length },
                    { key: 'filtered', label: 'Filtered', count: filteredAlerts.length }
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setSelectedTab(tab.key as any)}
                      className={`relative px-4 py-2 text-sm font-medium transition-all duration-200 ${
                        selectedTab === tab.key
                          ? 'text-[#eae9e9]'
                          : 'text-[#969696] hover:text-[#cccccc]'
                      }`}
                    >
                      {selectedTab === tab.key && (
                        <span className="absolute inset-0 bg-gradient-to-r from-[#22c55e]/20 to-[#14b8a6]/20 border-b-2 border-[#22c55e]"></span>
                      )}
                      <span className="relative z-10 flex items-center">
                        {tab.label} {tab.count > 0 && <span className="ml-1.5 text-xs opacity-60">({tab.count})</span>}
                      </span>
                    </button>
                  ))}
                </div> */}

                {/* Lists group - Hidden */}
                {/* <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setListsCollapsed(!listsCollapsed)}
                    className="flex items-center space-x-1 px-2 py-1 text-xs opacity-60 hover:opacity-100 transition-colors"
                    title={listsCollapsed ? 'Expand Lists' : 'Collapse Lists'}
                  >
                    <span>Lists</span>
                    <svg 
                      className={`w-3 h-3 transition-transform ${listsCollapsed ? 'rotate-0' : 'rotate-180'}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {!listsCollapsed && [ 
                    { key: 'listas-float-raw', label: 'Listas FLOAT (RAW)', count: 0 },
                    { key: 'buy-list', label: 'Buy List', count: 0 },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setSelectedTab(tab.key as any)}
                      className={`relative px-4 py-2 text-sm font-medium transition-all duration-200 ${
                        selectedTab === tab.key
                          ? 'text-[#eae9e9]'
                          : 'text-[#969696] hover:text-[#cccccc]'
                      }`}
                    >
                      {selectedTab === tab.key && (
                        <span className="absolute inset-0 bg-gradient-to-r from-[#22c55e]/20 to-[#14b8a6]/20 border-b-2 border-[#22c55e]"></span>
                      )}
                      <span className="relative z-10">{tab.label}</span>
                    </button>
                  ))}
                </div> */}

                {/* Manual group */}
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setManualCollapsed(!manualCollapsed)}
                    className="flex items-center space-x-1 px-2 py-1 text-xs opacity-60 hover:opacity-100 transition-colors"
                    title={manualCollapsed ? 'Expand Manual' : 'Collapse Manual'}
                  >
                    <span>Manual</span>
                    <svg 
                      className={`w-3 h-3 transition-transform ${manualCollapsed ? 'rotate-0' : 'rotate-180'}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {!manualCollapsed && [ 
                    { key: 'manual', label: 'MANUAL', count: 0 },
                    { key: 'manual-non-qualified', label: 'NON-QUALIFIED', count: 0 },
                    { key: 'positions', label: 'Positions', count: 0 },
                    { key: 'orders', label: 'Orders', count: 0 },
                    { key: 'stoplimit', label: 'Stop Limit', count: 0 },
                    { key: 'l2', label: 'L2', count: 0 },
                    { key: 'charts', label: 'Charts', count: 0 },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setSelectedTab(tab.key as any)}
                      className={`relative px-4 py-2 text-sm font-medium transition-all duration-200 ${
                        selectedTab === tab.key
                          ? 'text-[#eae9e9]'
                          : 'text-[#969696] hover:text-[#cccccc]'
                      }`}
                    >
                      {selectedTab === tab.key && (
                        <span className="absolute inset-0 bg-gradient-to-r from-[#22c55e]/20 to-[#14b8a6]/20 border-b-2 border-[#22c55e]"></span>
                      )}
                      <span className="relative z-10">{tab.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </header>
      )}

      {/* Analytics Modal */}
      {showStats && conditionStats && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4"
          onClick={() => setShowStats(false)}
        >
          <div 
            className="bg-gray-900 rounded-3xl shadow-2xl border border-gray-800 w-full max-w-5xl max-h-[95vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Clean Modal Header */}
            <div className="flex items-center justify-between p-8 border-b border-gray-800">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-white">Trading Analytics</h2>
                  <p className="text-gray-400 mt-1">Performance metrics and condition analysis</p>
                </div>
              </div>
              <button
                onClick={() => setShowStats(false)}
                className="p-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-xl transition-all duration-200"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Clean Modal Content */}
            <div className="p-8 overflow-y-auto max-h-[calc(95vh-120px)]">
              {/* Key Metrics Row */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
                  <div className="text-center">
                    <div className="text-4xl font-bold text-green-400 mb-2">{conditionStats.overall.totalPassed}</div>
                    <div className="text-sm text-gray-400">Valid Signals</div>
                  </div>
                </div>
                <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
                  <div className="text-center">
                    <div className="text-4xl font-bold text-red-400 mb-2">{conditionStats.overall.totalFailed}</div>
                    <div className="text-sm text-gray-400">Filtered Out</div>
                  </div>
                </div>
                <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
                  <div className="text-center">
                    <div className="text-4xl font-bold text-blue-400 mb-2">{conditionStats.overall?.passRate || 0}%</div>
                    <div className="text-sm text-gray-400">Success Rate</div>
                  </div>
                </div>
                <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
                  <div className="text-center">
                    <div className="text-4xl font-bold text-purple-400 mb-2">{conditionStats.overall.totalEvaluations}</div>
                    <div className="text-sm text-gray-400">Total Evaluations</div>
                  </div>
                </div>
              </div>

              {/* Top Failing Conditions */}
              <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 mb-8">
                <h3 className="text-xl font-bold text-white mb-6 flex items-center">
                  <svg className="w-6 h-6 text-red-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  Top Failing Conditions
                </h3>
                <div className="space-y-4">
                  {conditionStats.topFailing?.slice(0, 5).map((condition: any, index: number) => (
                    <div key={index} className="flex items-center justify-between p-4 bg-gray-700/50 rounded-xl">
                      <div className="flex-1">
                        <div className="text-gray-200 font-medium">{condition.name}</div>
                        <div className="text-sm text-gray-400 mt-1">
                          {condition.failed} failed out of {condition.total} total
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-red-400">{condition.failureRate}%</div>
                        <div className="text-xs text-gray-400">failure rate</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* All Conditions Breakdown */}
              <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
                <h3 className="text-xl font-bold text-white mb-6 flex items-center">
                  <svg className="w-6 h-6 text-blue-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                  All Trading Conditions
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(conditionStats.conditions).map(([key, condition]: [string, any]) => (
                    <div key={key} className="p-5 bg-gray-700/30 rounded-xl">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-gray-200 font-medium text-sm">{condition.name}</div>
                        <div className={`text-lg font-bold ${condition.passRate >= 70 ? 'text-green-400' : condition.passRate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {condition.passRate}%
                        </div>
                      </div>
                      <div className="w-full bg-gray-600 rounded-full h-3 mb-2">
                        <div 
                          className={`h-3 rounded-full ${condition.passRate >= 70 ? 'bg-green-400' : condition.passRate >= 50 ? 'bg-yellow-400' : 'bg-red-400'}`}
                          style={{ width: `${condition.passRate}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>✓ {condition.passed} passed</span>
                        <span>✗ {condition.failed} failed</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mx-6 mt-4 bg-[#5a1d1d] border border-[#f44747] rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <svg className="w-4 h-4 text-[#f44747]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm text-[#f44747]">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Clean Notification */}
      {newValidAlertsCount > 0 && (
        <div className="fixed top-4 right-4 z-50 bg-[#252526] border border-[#3e3e42] rounded-lg shadow-lg p-3">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-[#4ec9b0] rounded-full animate-pulse"></div>
            <div>
              <div className="text-sm font-medium text-[#cccccc]">
                {newValidAlertsCount} new signal{newValidAlertsCount > 1 ? 's' : ''}
              </div>
            </div>
            <button 
              onClick={() => setNewValidAlertsCount(0)}
              className="ml-2 text-[#969696] hover:text-[#cccccc] transition-colors p-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Symbol Analysis Modal */}
      {showAnalysisModal && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-backdrop-fade-in"
          onClick={closeAnalysisModal}
        >
          <div 
            className="bg-gray-900 rounded-3xl shadow-2xl border border-gray-800 w-full max-w-6xl max-h-[95vh] overflow-hidden animate-modal-slide-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-8 border-b border-gray-800">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-white">Symbol Analysis</h2>
                         <p className="text-gray-400 mt-1">Analyze NASDAQ-listed stocks with trading conditions</p>
                </div>
              </div>
              <button
                onClick={closeAnalysisModal}
                className="p-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-xl transition-all duration-200"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-8 overflow-y-auto max-h-[calc(95vh-120px)]">
              {/* Input Form */}
              <div className="mb-8">
                <div className="flex items-center space-x-4">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={manualSymbol}
                      onChange={(e) => setManualSymbol(e.target.value.toUpperCase())}
                            placeholder="Enter NASDAQ symbol (e.g., AAPL, TSLA, NVDA)"
                      className="w-full px-6 py-4 bg-gray-700 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                      onKeyPress={(e) => e.key === 'Enter' && analyzeSymbol()}
                      autoFocus
                    />
                  </div>
                  <button
                    onClick={analyzeSymbol}
                    disabled={!manualSymbol.trim() || isAnalyzing}
                    className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-3 text-lg"
                  >
                    {isAnalyzing ? (
                      <>
                        <svg className="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>Analyzing...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>Analyze Symbol</span>
                      </>
                    )}
                  </button>
                </div>
                
                {/* Error Display */}
                {error && (
                  <div className="mt-4 bg-red-900/20 border border-red-500/30 rounded-xl p-4">
                    <div className="flex items-center space-x-3">
                      <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-red-300">{error}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Analysis Results */}
              {manualAnalysis && (
                <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Analysis Summary */}
                    <div className="space-y-6">
                      <div className="flex items-center space-x-4">
                        <div className="text-4xl font-bold text-white">{manualAnalysis.ticker}</div>
                        <div className={`px-4 py-2 rounded-full text-sm font-bold ${
                          manualAnalysis.evaluation.allConditionsMet 
                            ? 'bg-green-500 text-white' 
                            : 'bg-red-500 text-white'
                        }`}>
                          {manualAnalysis.evaluation.allConditionsMet ? 'BUY SIGNAL' : 'NO SIGNAL'}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-700 rounded-xl p-4">
                          <div className="text-3xl font-bold text-white">{manualAnalysis.evaluation.score}</div>
                          <div className="text-sm text-gray-400 mt-1">Conditions Passed</div>
                        </div>
                        <div className="bg-gray-700 rounded-xl p-4">
                          <div className="text-3xl font-bold text-green-400">
                            {manualAnalysis.lastCandle?.close ? formatPrice(manualAnalysis.lastCandle.close) : 'N/A'}
                          </div>
                          <div className="text-sm text-gray-400 mt-1">Current Price</div>
                        </div>
                      </div>
                    </div>

                    {/* Technical Indicators */}
                    <div className="space-y-4">
                      <h5 className="text-lg font-bold text-white">Technical Indicators</h5>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-yellow-900/30 rounded-xl p-4 border border-yellow-500/30">
                          <div className="text-yellow-300 text-sm font-mono font-bold">
                            {manualAnalysis.indicators.ema1m18 ? formatPriceFull(manualAnalysis.indicators.ema1m18) : 'N/A'}
                          </div>
                          <div className="text-yellow-400/60 text-xs mt-1">EMA18 1m</div>
                        </div>
                        <div className="bg-orange-900/30 rounded-xl p-4 border border-orange-500/30">
                          <div className="text-orange-300 text-sm font-mono font-bold">
                            {manualAnalysis.indicators.ema1m200 ? formatPriceFull(manualAnalysis.indicators.ema1m200) : 'N/A'}
                          </div>
                          <div className="text-orange-400/60 text-xs mt-1">EMA200 1m</div>
                        </div>
                        <div className="bg-cyan-900/30 rounded-xl p-4 border border-cyan-500/30">
                          <div className="text-cyan-300 text-sm font-mono font-bold">
                            {manualAnalysis.indicators.ema5m18 ? formatPriceFull(manualAnalysis.indicators.ema5m18) : 'N/A'}
                          </div>
                          <div className="text-cyan-400/60 text-xs mt-1">EMA18 5m</div>
                        </div>
                        <div className="bg-pink-900/30 rounded-xl p-4 border border-pink-500/30">
                          <div className="text-pink-300 text-sm font-mono font-bold">
                            {manualAnalysis.indicators.ema5m200 ? formatPriceFull(manualAnalysis.indicators.ema5m200) : 'N/A'}
                          </div>
                          <div className="text-pink-400/60 text-xs mt-1">EMA200 5m</div>
                        </div>
                        <div className="bg-indigo-900/30 rounded-xl p-4 border border-indigo-500/30">
                          <div className={`text-sm font-mono font-bold ${
                            manualAnalysis.indicators.macd1m && manualAnalysis.indicators.macd1m.macd >= 0 
                              ? 'text-green-300' : 'text-red-300'
                          }`}>
                            {manualAnalysis.indicators.macd1m ? formatIndicator(manualAnalysis.indicators.macd1m.macd) : 'N/A'}
                          </div>
                          <div className="text-indigo-400/60 text-xs mt-1">MACD 1m</div>
                        </div>
                        <div className="bg-teal-900/30 rounded-xl p-4 border border-teal-500/30">
                          <div className={`text-sm font-mono font-bold ${
                            manualAnalysis.indicators.macd5m && manualAnalysis.indicators.macd5m.macd >= 0 
                              ? 'text-green-300' : 'text-red-300'
                          }`}>
                            {manualAnalysis.indicators.macd5m ? formatIndicator(manualAnalysis.indicators.macd5m.macd) : 'N/A'}
                          </div>
                          <div className="text-teal-400/60 text-xs mt-1">MACD 5m</div>
                        </div>
                        <div className="bg-emerald-900/30 rounded-xl p-4 border border-emerald-500/30 col-span-2">
                          <div className="text-emerald-300 text-sm font-mono font-bold">
                            {manualAnalysis.indicators.vwap1m ? formatPriceFull(manualAnalysis.indicators.vwap1m) : 'N/A'}
                          </div>
                          <div className="text-emerald-400/60 text-xs mt-1">VWAP 1m</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Failed Conditions */}
                  {manualAnalysis.evaluation.failedConditions && manualAnalysis.evaluation.failedConditions.length > 0 && (
                    <div className="mt-8 bg-red-900/20 rounded-xl p-6 border border-red-500/30">
                      <h5 className="text-lg font-bold text-red-400 mb-4 flex items-center space-x-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <span>Failed Conditions</span>
                      </h5>
                      <div className="space-y-3">
                        {manualAnalysis.evaluation.failedConditions.map((condition: any, index: number) => (
                          <div key={index} className="flex items-center justify-between bg-red-900/30 rounded-lg p-3">
                            <span className="text-red-300 text-sm font-medium">{condition.name}</span>
                            <span className="text-red-400 text-xs font-mono">{condition.actual}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={
          <div className="flex items-center justify-center h-full text-[#808080] bg-[#14130e]">
            <div className="flex flex-col items-center space-y-3">
              <div className="w-6 h-6 border-2 border-[#2a2820] border-t-[#808080] rounded-full animate-spin"></div>
              <p className="text-xs uppercase tracking-wider">Loading</p>
            </div>
          </div>
        }>
          {selectedTab === 'dashboard' && (
            <TradingDashboard 
              alerts={allAlerts} 
              loading={loading}
            />
          )}
          {selectedTab === 'config-float' && <FloatConfigPanel />}
          {selectedTab === 'listas-float-raw' && (
            <FloatRawListsSection onSymbolClick={(symbol) => {
              if (!symbol) return;
              const sym = symbol.toUpperCase();
              setError(null);
              setSelectedStockInfo({ ticker: sym, isLoading: true });
              setShowStockInfoModal(true);
              fetchStockInfo(sym);
            }} />
          )}
          {selectedTab === 'manual' && <ManualSection viewMode="qualified" />}
          {selectedTab === 'manual-non-qualified' && <ManualSection viewMode="non-qualified" />}
          {selectedTab === 'buy-list' && <BuyListSection />}
          {selectedTab === 'positions' && <PositionsWithStopLimitSection />}
          {selectedTab === 'orders' && <OrdersSection />}
          {selectedTab === 'l2' && <L2Section />}
          {selectedTab === 'charts' && <ChartsSection />}
          {!['dashboard', 'config-float', 'listas-float-raw', 'buy-list', 'positions', 'orders', 'stoplimit', 'l2', 'charts', 'sold', 'manual', 'manual-non-qualified'].includes(selectedTab) && (
            <div className="h-full flex">
            {/* Main Alerts Content */}
            <div className="flex-1 flex flex-col">
              {/* Clean Table Header */}
              <div className="bg-[#252526] border-b border-[#3e3e42] px-6 py-3 sticky top-0 z-10">
                <div className="grid grid-cols-12 gap-4 text-xs font-medium text-[#969696] uppercase tracking-wide">
                <div className="col-span-2 flex items-center space-x-2">
                  <span>Symbol</span>
                </div>
                <div className="col-span-1 flex items-center space-x-2">
                  <span>Time</span>
                </div>
                <div className="col-span-1 flex items-center space-x-2">
                  <span>Price</span>
                </div>
                <div className="col-span-1 flex items-center space-x-2">
                  <span>EMA18</span>
                </div>
                <div className="col-span-1 flex items-center space-x-2">
                  <span>EMA200</span>
                </div>
                <div className="col-span-1 flex items-center space-x-2">
                  <span>MACD 1m</span>
                </div>
                <div className="col-span-1 flex items-center space-x-2">
                  <span>MACD 5m</span>
                </div>
                <div className="col-span-1 flex items-center space-x-2">
                  <span>VWAP</span>
                </div>
                <div className="col-span-1 flex items-center space-x-2">
                  <span>Score</span>
                </div>
                <div className="col-span-1 flex items-center space-x-2">
                  <span>Status</span>
                </div>
              </div>
            </div>

            {/* Clean Alerts List (virtualized) */}
            <div className="flex-1 bg-[#1e1e1e] alerts-container">
              {visibleAlerts.length === 0 && !loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-12 h-12 bg-[#2d2d30] rounded-lg flex items-center justify-center mx-auto mb-4">
                      <svg className="w-6 h-6 text-[#808080]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-medium text-[#cccccc] mb-2">No alerts yet</h3>
                    <p className="text-[#969696]">Alerts will appear here when received from ChartsWatcher</p>
                  </div>
                </div>
              ) : (
                <Virtuoso
                  style={{ height: '100%' }}
                  data={visibleAlerts}
                  overscan={200}
                  itemContent={(index, alert) => (
                    <div
                      key={`${alert.ticker}-${alert.timestamp}-${index}`}
                      onClick={() => handleAlertClick(alert)}
                      className={`px-6 py-2`}
                    >
                      <div
                        className={`p-4 rounded-lg border transition-all duration-200 hover:shadow-sm cursor-pointer ${
                          alert.evaluation.allConditionsMet
                            ? 'border-[#4ec9b0]/30 bg-[#0d3a2e] hover:bg-[#0d3a2e]/80'
                            : 'border-[#3e3e42] bg-[#2d2d30] hover:bg-[#3e3e42]'
                        }`}
                      >
                        <div className="grid grid-cols-12 gap-4 items-center text-sm">
                          <div className="col-span-2">
                            <div className="flex items-center space-x-2">
                              <div className={`w-2 h-2 rounded-full ${
                                alert.evaluation.allConditionsMet ? 'bg-[#4ec9b0]' : 'bg-[#808080]'
                              }`}></div>
                              <div className="font-semibold text-[#cccccc]">{alert.ticker}</div>
                            </div>
                          </div>
                          <div className="col-span-1">
                            <div className="text-[#969696] text-xs font-mono">{formatTimestamp(alert.timestamp)}</div>
                          </div>
                          <div className="col-span-1">
                            <div className="font-semibold text-[#cccccc] text-sm">
                              {alert.price ? formatPrice(alert.price) : alert.lastCandle?.close ? formatPrice(alert.lastCandle.close) : 'N/A'}
                            </div>
                            {alert.changePercent !== undefined && (
                              <div className={`text-xs font-mono mt-0.5 ${alert.changePercent >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                                {alert.changePercent >= 0 ? '+' : ''}{alert.changePercent.toFixed(2)}%
                              </div>
                            )}
                          </div>
                          <div className="col-span-1">
                            <div className="text-[#cccccc] text-xs font-mono">
                              {alert.indicators.ema1m18 ? formatPriceFull(alert.indicators.ema1m18) : 'N/A'}
                            </div>
                          </div>
                          <div className="col-span-1">
                            <div className="text-[#cccccc] text-xs font-mono">
                              {alert.indicators.ema1m200 ? formatPriceFull(alert.indicators.ema1m200) : 'N/A'}
                            </div>
                          </div>
                          <div className="col-span-1">
                            <div className={`text-xs font-mono ${
                              alert.indicators.macd1m && alert.indicators.macd1m.macd >= 0 
                                ? 'text-[#4ec9b0]' : 'text-[#f44747]'
                            }`}>
                              {alert.indicators.macd1m ? formatIndicator(alert.indicators.macd1m.macd) : 'N/A'}
                            </div>
                          </div>
                          <div className="col-span-1">
                            <div className={`text-xs font-mono ${
                              alert.indicators.macd5m && alert.indicators.macd5m.macd >= 0 
                                ? 'text-[#4ec9b0]' : 'text-[#f44747]'
                            }`}>
                              {alert.indicators.macd5m ? formatIndicator(alert.indicators.macd5m.macd) : 'N/A'}
                            </div>
                          </div>
                          <div className="col-span-1">
                            <div className="text-[#cccccc] text-xs font-mono">
                              {alert.indicators.vwap1m ? formatPriceFull(alert.indicators.vwap1m) : 'N/A'}
                            </div>
                          </div>
                          <div className="col-span-1">
                            <div className="text-[#cccccc] text-sm font-medium text-center">{alert.evaluation.score}</div>
                          </div>
                          <div className="col-span-1">
                            <div className="flex items-center justify-center">
                              <div className={`px-2 py-1 rounded-md text-xs font-medium ${
                                alert.evaluation.allConditionsMet 
                                  ? 'bg-[#0d3a2e] text-[#4ec9b0]' 
                                  : 'bg-[#2d2d30] text-[#969696]'
                              }`}>
                                {alert.evaluation.allConditionsMet ? 'Valid' : 'Filtered'}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                />
              )}
            </div>
            </div>

            {/* Filters Sidebar */}
            <div className="w-64 bg-[#252526] border-l border-[#3e3e42] p-4 overflow-y-auto">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[#cccccc] mb-3 uppercase tracking-wide flex items-center">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    Filtros Adicionales
                  </h3>
                  <div className="text-xs text-[#969696] mb-4">
                    Aplicar condiciones extra a las alertas válidas
                  </div>
                </div>

                {/* Filter Options */}
                <div className="space-y-3">
                  {/* VWAP > EMA 200 Filter */}
                  <label className="flex items-start space-x-3 p-3 rounded-lg bg-[#2d2d30] hover:bg-[#3e3e42] cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={additionalFilters.vwapAboveEma200}
                      onChange={(e) => setAdditionalFilters({
                        ...additionalFilters,
                        vwapAboveEma200: e.target.checked
                      })}
                      className="mt-0.5 w-4 h-4 rounded border-[#3e3e42] text-[#007acc] focus:ring-[#007acc] focus:ring-offset-0 bg-[#3e3e42]"
                    />
                    <div className="flex-1">
                      <div className="text-sm text-[#cccccc] font-medium">VWAP {'>'} EMA 200</div>
                      <div className="text-xs text-[#969696] mt-1">VWAP por sobre EMA 200 (1m)</div>
                    </div>
                  </label>

                  {/* VWAP > EMA 18 Filter */}
                  <label className="flex items-start space-x-3 p-3 rounded-lg bg-[#2d2d30] hover:bg-[#3e3e42] cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={additionalFilters.vwapAboveEma18}
                      onChange={(e) => setAdditionalFilters({
                        ...additionalFilters,
                        vwapAboveEma18: e.target.checked
                      })}
                      className="mt-0.5 w-4 h-4 rounded border-[#3e3e42] text-[#007acc] focus:ring-[#007acc] focus:ring-offset-0 bg-[#3e3e42]"
                    />
                    <div className="flex-1">
                      <div className="text-sm text-[#cccccc] font-medium">VWAP {'>'} EMA 18</div>
                      <div className="text-xs text-[#969696] mt-1">VWAP por sobre EMA 18 (1m)</div>
                    </div>
                  </label>
                </div>

                {/* Filter Summary */}
                <div className="mt-6 p-3 bg-[#1e1e1e] rounded-lg border border-[#3e3e42]">
                  <div className="text-xs font-medium text-[#969696] mb-2">Resumen</div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#969696]">Alertas base:</span>
                      <span className="text-[#cccccc] font-mono">{baseValidAlerts.length}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[#969696]">Filtros activos:</span>
                      <span className="text-[#cccccc] font-mono">
                        {(additionalFilters.vwapAboveEma200 ? 1 : 0) + (additionalFilters.vwapAboveEma18 ? 1 : 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs pt-2 border-t border-[#3e3e42]">
                      <span className="text-[#4ec9b0] font-medium">Alertas finales:</span>
                      <span className="text-[#4ec9b0] font-mono font-bold">{validAlerts.length}</span>
                    </div>
                  </div>
                </div>

                {/* Active Filters Info */}
                {(additionalFilters.vwapAboveEma200 || additionalFilters.vwapAboveEma18) && (
                  <div className="p-3 bg-[#1a3a47] border border-[#007acc]/30 rounded-lg">
                    <div className="flex items-start space-x-2">
                      <svg className="w-4 h-4 text-[#007acc] mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <div className="text-xs text-[#79b8ff]">
                        Filtros activos. Solo se muestran alertas que cumplan todas las condiciones seleccionadas.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stock Info Modal */}
        {showStockInfoModal && selectedStockInfo && (
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn"
            onClick={closeStockInfoModal}
          >
            <div 
              className="bg-gradient-to-br from-[#14130e] via-[#0f0e0a] to-[#14130e] border border-[#2a2820] shadow-[0_0_30px_rgba(0,0,0,0.8)] w-full max-w-7xl max-h-[90vh] overflow-hidden relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Sci-fi corner accents */}
              <div className="absolute top-0 left-0 w-20 h-20 border-t-2 border-l-2 border-[#22c55e]/30 pointer-events-none"></div>
              <div className="absolute top-0 right-0 w-20 h-20 border-t-2 border-r-2 border-[#22c55e]/30 pointer-events-none"></div>
              <div className="absolute bottom-0 left-0 w-20 h-20 border-b-2 border-l-2 border-[#22c55e]/30 pointer-events-none"></div>
              <div className="absolute bottom-0 right-0 w-20 h-20 border-b-2 border-r-2 border-[#22c55e]/30 pointer-events-none"></div>

              {/* Modal Header - Futuristic Style */}
              <div className="bg-gradient-to-r from-[#14130e] via-[#0f0e0a] to-[#14130e] border-b border-[#2a2820]/60 px-6 py-3 backdrop-blur-sm relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <div className={`w-3 h-3 rounded-full ${selectedStockInfo.evaluation?.allConditionsMet ? 'bg-[#22c55e] shadow-[0_0_12px_rgba(34,197,94,0.6)] animate-pulse' : 'bg-[#808080]'}`}></div>
                        {selectedStockInfo.evaluation?.allConditionsMet && (
                          <div className="absolute inset-0 w-3 h-3 rounded-full bg-[#22c55e] opacity-50 animate-ping"></div>
                        )}
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-[#eae9e9] tracking-wider font-mono">{selectedStockInfo.ticker}</h2>
                        <p className="text-xs text-[#eae9e9]/60 mt-0.5 font-light">
                          {selectedStockInfo.companyInfo?.name || 'Loading company info...'}
                        </p>
                      </div>
                    </div>
                    {selectedStockInfo.isLoading && (
                      <div className="flex items-center space-x-2 text-[#eae9e9]/70">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#22c55e]"></div>
                        <span className="text-xs font-mono">LOADING...</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={closeStockInfoModal}
                    className="p-2.5 text-[#eae9e9]/60 hover:text-[#eae9e9] hover:bg-[#0f0e0a] transition-all duration-200 border border-transparent hover:border-[#2a2820]/70 hover:shadow-[0_0_8px_rgba(34,197,94,0.2)]"
                    title="Close"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Modal Content */}
              <div className="p-4 overflow-y-auto max-h-[calc(90vh-120px)] custom-scrollbar">
                {selectedStockInfo.error ? (
                  <div className="text-center py-8">
                    <div className="text-[#f87171] mb-2 text-base font-semibold">⚠️ Error loading data</div>
                    <div className="text-[#eae9e9]/70 text-xs">{selectedStockInfo.error}</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Left Column - Basic Info */}
                    <div className="space-y-3">
                      {/* Price Information */}
                      <div className="bg-[#0f0e0a] border border-[#2a2820]/60 p-3 hover:border-[#2a2820]/80 transition-all duration-300 relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#22c55e]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        <h3 className="text-xs font-bold text-[#eae9e9] mb-2 uppercase tracking-[0.15em] font-mono">PRECIO</h3>
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">Alerta</span>
                            <span className="text-[#eae9e9] font-mono text-sm font-semibold">
                              {selectedStockInfo.price ? `$${selectedStockInfo.price.toFixed(2)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">Último</span>
                            <span className="text-[#eae9e9] font-mono text-sm">
                              {selectedStockInfo.lastCandle?.close ? `$${selectedStockInfo.lastCandle.close.toFixed(2)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">VWAP</span>
                            <span className="text-[#eae9e9] font-mono text-sm">
                              {selectedStockInfo.indicators?.vwap1m ? `$${selectedStockInfo.indicators.vwap1m.toFixed(2)}` : 'N/A'}
                            </span>
                          </div>
                          {selectedStockInfo.changePercent !== undefined && (
                            <div className="flex justify-between items-center py-1">
                              <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">Cambio</span>
                              <span className={`font-mono text-sm font-bold ${selectedStockInfo.changePercent >= 0 ? 'text-[#22c55e]' : 'text-[#f87171]'}`}>
                                {selectedStockInfo.changePercent >= 0 ? '+' : ''}{selectedStockInfo.changePercent.toFixed(2)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Extreme Prices */}
                      <div className="bg-[#0f0e0a] border border-[#2a2820]/60 p-3 hover:border-[#2a2820]/80 transition-all duration-300 relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#22c55e]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        <h3 className="text-xs font-bold text-[#eae9e9] mb-2 uppercase tracking-[0.15em] font-mono">RANGO DEL DÍA</h3>
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">LOD</span>
                            <span className="text-[#f87171] font-mono text-sm font-bold">
                              {selectedStockInfo.indicators?.lod ? `$${selectedStockInfo.indicators.lod.toFixed(2)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">HOD</span>
                            <span className="text-[#22c55e] font-mono text-sm font-bold">
                              {selectedStockInfo.indicators?.hod ? `$${selectedStockInfo.indicators.hod.toFixed(2)}` : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Technical Conditions */}
                      <div className="bg-[#0f0e0a] border border-[#2a2820]/60 p-3 hover:border-[#2a2820]/80 transition-all duration-300 relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#22c55e]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        <h3 className="text-xs font-bold text-[#eae9e9] mb-2 uppercase tracking-[0.15em] font-mono">CONDICIONES TÉCNICAS</h3>
                        <div className="space-y-1.5">
                          {(() => {
                            // Use the same evaluation logic as the server
                            const evaluation = selectedStockInfo.evaluation;
                            const allConditionsMet = evaluation?.allConditionsMet || false;
                            const failedConditions = evaluation?.failedConditions || [];
                            
                            // Get indicator values for display
                            const macd5m = selectedStockInfo.indicators?.macd5m;
                            const macd1m = selectedStockInfo.indicators?.macd1m;
                            const lastClose = selectedStockInfo.chartswatcherData?.close || selectedStockInfo.price || selectedStockInfo.lastCandle?.close;
                            const ema1m18 = selectedStockInfo.indicators?.ema1m18;
                            const ema5m18 = selectedStockInfo.indicators?.ema5m18;
                            const ema5m200 = selectedStockInfo.indicators?.ema5m200;
                            
                            // Create a map of failed conditions for easy lookup
                            const failedConditionsMap = new Map(failedConditions.map((fc: any) => [fc.condition, fc]));
                            
                            return (
                              <>
                                <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                                  <span className="text-[#eae9e9]/60 text-xs font-light">MACD 5m Histogram {'>'} 0</span>
                                  <span className={`text-xs px-2 py-0.5 font-mono font-semibold ${!failedConditionsMap.has('macd5mHistogramPositive') ? 'text-[#22c55e] bg-[#22c55e]/15 border border-[#22c55e]/30' : 'text-[#f87171] bg-[#f87171]/15 border border-[#f87171]/30'}`}>
                                    {!failedConditionsMap.has('macd5mHistogramPositive') ? '✓' : '✗'} {macd5m?.histogram?.toFixed(4) || 'N/A'}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                                  <span className="text-[#eae9e9]/60 text-xs font-light">MACD 5m {'>'} 0</span>
                                  <span className={`text-xs px-2 py-0.5 font-mono font-semibold ${!failedConditionsMap.has('macd5mPositive') ? 'text-[#22c55e] bg-[#22c55e]/15 border border-[#22c55e]/30' : 'text-[#f87171] bg-[#f87171]/15 border border-[#f87171]/30'}`}>
                                    {!failedConditionsMap.has('macd5mPositive') ? '✓' : '✗'} {macd5m?.macd?.toFixed(4) || 'N/A'}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                                  <span className="text-[#eae9e9]/60 text-xs font-light">MACD 1m {'>'} 0</span>
                                  <span className={`text-xs px-2 py-0.5 font-mono font-semibold ${!failedConditionsMap.has('macd1mPositive') ? 'text-[#22c55e] bg-[#22c55e]/15 border border-[#22c55e]/30' : 'text-[#f87171] bg-[#f87171]/15 border border-[#f87171]/30'}`}>
                                    {!failedConditionsMap.has('macd1mPositive') ? '✓' : '✗'} {macd1m?.macd?.toFixed(4) || 'N/A'}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                                  <span className="text-[#eae9e9]/60 text-xs font-light">Close {'>'} EMA 18 1m</span>
                                  <span className={`text-xs px-2 py-0.5 font-mono font-semibold ${!failedConditionsMap.has('closeAboveEma18_1m') ? 'text-[#22c55e] bg-[#22c55e]/15 border border-[#22c55e]/30' : 'text-[#f87171] bg-[#f87171]/15 border border-[#f87171]/30'}`}>
                                    {!failedConditionsMap.has('closeAboveEma18_1m') ? '✓' : '✗'}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                                  <span className="text-[#eae9e9]/60 text-xs font-light">EMA 18 5m {'>'} EMA 200 5m</span>
                                  <span className={`text-xs px-2 py-0.5 font-mono font-semibold ${!failedConditionsMap.has('ema18Above200_5m') ? 'text-[#22c55e] bg-[#22c55e]/15 border border-[#22c55e]/30' : 'text-[#f87171] bg-[#f87171]/15 border border-[#f87171]/30'}`}>
                                    {!failedConditionsMap.has('ema18Above200_5m') ? '✓' : '✗'}
                                  </span>
                                </div>
                                <div className="mt-2 pt-2 border-t border-[#2a2820]/60">
                                  <div className="flex justify-between items-center">
                                    <span className="text-[#eae9e9]/70 text-xs font-bold uppercase tracking-[0.15em] font-mono">ALL TECH MET</span>
                                    <span className={`text-xs px-2 py-1 font-bold font-mono ${allConditionsMet ? 'text-[#22c55e] bg-[#22c55e]/20 border border-[#22c55e]/50 shadow-[0_0_8px_rgba(34,197,94,0.3)]' : 'text-[#f87171] bg-[#f87171]/20 border border-[#f87171]/50'}`}>
                                      {allConditionsMet ? '✓ YES' : '✗ NO'}
                                    </span>
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>

                    {/* Middle Column - MACD 1m */}
                    <div className="space-y-3">
                      <div className="bg-[#0f0e0a] border border-[#2a2820]/60 p-3 hover:border-[#2a2820]/80 transition-all duration-300 relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#22c55e]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        <h3 className="text-xs font-bold text-[#eae9e9] mb-2 uppercase tracking-[0.15em] font-mono">MACD 1M</h3>
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">Histogram</span>
                            <span className={`font-mono text-xs font-semibold ${selectedStockInfo.indicators?.macd1m?.histogram >= 0 ? 'text-[#22c55e]' : 'text-[#f87171]'}`}>
                              {selectedStockInfo.indicators?.macd1m?.histogram ? selectedStockInfo.indicators.macd1m.histogram.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">MACD</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.macd1m?.macd ? selectedStockInfo.indicators.macd1m.macd.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">Signal</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.macd1m?.signal ? selectedStockInfo.indicators.macd1m.signal.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* EMA 1m */}
                      <div className="bg-[#0f0e0a] border border-[#2a2820]/60 p-3 hover:border-[#2a2820]/80 transition-all duration-300 relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#22c55e]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        <h3 className="text-xs font-bold text-[#eae9e9] mb-2 uppercase tracking-[0.15em] font-mono">EMA 1M</h3>
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">EMA 12</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema1m12 ? `$${selectedStockInfo.indicators.ema1m12.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">EMA 20</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema1m20 ? `$${selectedStockInfo.indicators.ema1m20.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">EMA 26</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema1m26 ? `$${selectedStockInfo.indicators.ema1m26.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">EMA 200</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema1m200 ? `$${selectedStockInfo.indicators.ema1m200.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Column - MACD 5m & EMA 5m */}
                    <div className="space-y-3">
                      <div className="bg-[#0f0e0a] border border-[#2a2820]/60 p-3 hover:border-[#2a2820]/80 transition-all duration-300 relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#22c55e]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        <h3 className="text-xs font-bold text-[#eae9e9] mb-2 uppercase tracking-[0.15em] font-mono">MACD 5M</h3>
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">Histogram</span>
                            <span className={`font-mono text-xs font-semibold ${selectedStockInfo.indicators?.macd5m?.histogram >= 0 ? 'text-[#22c55e]' : 'text-[#f87171]'}`}>
                              {selectedStockInfo.indicators?.macd5m?.histogram ? selectedStockInfo.indicators.macd5m.histogram.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">MACD</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.macd5m?.macd ? selectedStockInfo.indicators.macd5m.macd.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">Signal</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.macd5m?.signal ? selectedStockInfo.indicators.macd5m.signal.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* EMA 5m */}
                      <div className="bg-[#0f0e0a] border border-[#2a2820]/60 p-3 hover:border-[#2a2820]/80 transition-all duration-300 relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#22c55e]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        <h3 className="text-xs font-bold text-[#eae9e9] mb-2 uppercase tracking-[0.15em] font-mono">EMA 5M</h3>
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">EMA 12</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema5m12 ? `$${selectedStockInfo.indicators.ema5m12.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">EMA 20</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema5m20 ? `$${selectedStockInfo.indicators.ema5m20.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">EMA 26</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema5m26 ? `$${selectedStockInfo.indicators.ema5m26.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">EMA 200</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema5m200 ? `$${selectedStockInfo.indicators.ema5m200.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Volume Info */}
                      <div className="bg-[#0f0e0a] border border-[#2a2820]/60 p-3 hover:border-[#2a2820]/80 transition-all duration-300 relative group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#22c55e]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        <h3 className="text-xs font-bold text-[#eae9e9] mb-2 uppercase tracking-[0.15em] font-mono">VOLUMEN</h3>
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center py-1 border-b border-[#2a2820]/40">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">Último</span>
                            <span className="text-[#eae9e9] font-mono text-xs">
                              {selectedStockInfo.lastCandle?.volume ? selectedStockInfo.lastCandle.volume.toLocaleString() : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-1">
                            <span className="text-[#eae9e9]/60 text-xs font-light uppercase tracking-wider">Timestamp</span>
                            <span className="text-[#eae9e9]/60 font-mono text-xs">
                              {selectedStockInfo.timestamp ? new Date(selectedStockInfo.timestamp).toLocaleTimeString() : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ChartsWatcher Alert Data Section - Always show if data exists */}
                    {selectedStockInfo.chartswatcherData && (selectedStockInfo.chartswatcherData.rawColumns || selectedStockInfo.chartswatcherData.alertType === 'websocket_alert') && (
                      <div className="col-span-1 lg:col-span-3 space-y-3">
                        {/* Parsed Data - Only show if we have parsed values */}
                        {(selectedStockInfo.chartswatcherData.open !== null || 
                          selectedStockInfo.chartswatcherData.high !== null || 
                          selectedStockInfo.chartswatcherData.low !== null || 
                          selectedStockInfo.chartswatcherData.close !== null ||
                          selectedStockInfo.chartswatcherData.volume !== null ||
                          selectedStockInfo.chartswatcherData.change !== null ||
                          selectedStockInfo.chartswatcherData.changePercent !== null) && (
                        <div className="bg-[#0f0e0a] border border-[#2a2820]/60 p-3 hover:border-[#2a2820]/80 transition-all duration-300 relative group">
                          <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#22c55e]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                          <h3 className="text-xs font-bold text-[#eae9e9] mb-2 uppercase tracking-[0.15em] font-mono flex items-center">
                            <svg className="w-3 h-3 mr-1.5 text-[#22c55e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            CHARTSWATCHER ALERT DATA (PARSED)
                          </h3>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {selectedStockInfo.chartswatcherData.open !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#eae9e9]/60 text-xs mb-1 font-light uppercase tracking-wider">Open</span>
                                <span className="text-[#eae9e9] font-mono text-sm font-semibold">
                                  ${selectedStockInfo.chartswatcherData.open.toFixed(2)}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.high !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#eae9e9]/60 text-xs mb-1 font-light uppercase tracking-wider">High</span>
                                <span className="text-[#22c55e] font-mono text-sm font-bold">
                                  ${selectedStockInfo.chartswatcherData.high.toFixed(2)}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.low !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#eae9e9]/60 text-xs mb-1 font-light uppercase tracking-wider">Low</span>
                                <span className="text-[#f87171] font-mono text-sm font-bold">
                                  ${selectedStockInfo.chartswatcherData.low.toFixed(2)}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.close !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#eae9e9]/60 text-xs mb-1 font-light uppercase tracking-wider">Close</span>
                                <span className="text-[#eae9e9] font-mono text-sm font-semibold">
                                  ${selectedStockInfo.chartswatcherData.close.toFixed(2)}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.volume !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#eae9e9]/60 text-xs mb-1 font-light uppercase tracking-wider">Volume</span>
                                <span className="text-[#eae9e9] font-mono text-sm font-semibold">
                                  {selectedStockInfo.chartswatcherData.volume.toLocaleString()}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.change !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#eae9e9]/60 text-xs mb-1 font-light uppercase tracking-wider">Change</span>
                                <span className={`font-mono text-sm font-bold ${selectedStockInfo.chartswatcherData.change >= 0 ? 'text-[#22c55e]' : 'text-[#f87171]'}`}>
                                  {selectedStockInfo.chartswatcherData.change >= 0 ? '+' : ''}${selectedStockInfo.chartswatcherData.change.toFixed(2)}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.changePercent !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#eae9e9]/60 text-xs mb-1 font-light uppercase tracking-wider">Change %</span>
                                <span className={`font-mono text-sm font-bold ${selectedStockInfo.chartswatcherData.changePercent >= 0 ? 'text-[#22c55e]' : 'text-[#f87171]'}`}>
                                  {selectedStockInfo.chartswatcherData.changePercent >= 0 ? '+' : ''}{selectedStockInfo.chartswatcherData.changePercent.toFixed(2)}%
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.alertType === 'websocket_alert' && (
                              <div className="flex flex-col">
                                <span className="text-[#eae9e9]/60 text-xs mb-1 font-light uppercase tracking-wider">Alert Type</span>
                                <span className="text-[#22c55e] font-mono text-xs font-semibold">
                                  LIVE ALERT
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        )}

                        {/* Raw Columns Received */}
                        {selectedStockInfo.chartswatcherData.rawColumns && selectedStockInfo.chartswatcherData.rawColumns.length > 0 && (
                          <div className="bg-[#0f0e0a] border border-[#2a2820]/60 p-3 hover:border-[#2a2820]/80 transition-all duration-300 relative group">
                            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#22c55e]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                            <h3 className="text-xs font-bold text-[#eae9e9] mb-2 uppercase tracking-[0.15em] font-mono flex items-center">
                              <svg className="w-3 h-3 mr-1.5 text-[#eae9e9]/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                              </svg>
                              ALERT COLUMNS RECEIVED
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                              {selectedStockInfo.chartswatcherData.rawColumns.map((column: any, idx: number) => (
                                <div key={idx} className="bg-[#14130e] border border-[#2a2820]/60 p-2 hover:border-[#2a2820]/80 transition-all duration-200">
                                  <div className="text-[#eae9e9]/60 text-xs mb-1 font-mono font-light uppercase tracking-wider">{column.key}</div>
                                  <div className="text-[#eae9e9] font-mono text-xs break-all font-semibold">
                                    {column.value !== null && column.value !== undefined ? String(column.value) : 'null'}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          )}
        </Suspense>
      </div>
    </div>
  );
}

export default App;