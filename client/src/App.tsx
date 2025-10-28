import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Virtuoso } from 'react-virtuoso';
import './App.css';
const TradingDashboard = lazy(() => import('./components/TradingDashboard'));
const TestListSection = lazy(() => import('./components/TestListSection'));
const FloatListsSection = lazy(() => import('./components/FloatListsSection'));
const FloatConfigPanel = lazy(() => import('./components/FloatConfigPanel'));
const BuyListSection = lazy(() => import('./components/BuyListSection'));
const FloatRawListsSection = lazy(() => import('./components/FloatRawListsSection'));
const MACDEMAVerification = lazy(() => import('./components/MACDEMAVerification'));

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
  const [allAlerts, setAllAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [chartsWatcherStatus, setChartsWatcherStatus] = useState<ChartsWatcherStatus | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [newValidAlertsCount, setNewValidAlertsCount] = useState(0);
  const [conditionStats, setConditionStats] = useState<any>(null);
  const [showStats, setShowStats] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'all' | 'valid' | 'filtered' | 'dashboard' | 'testlist' | 'config-float' | 'listas-float-raw' | 'buy-list' | 'verification'>('dashboard');
  const [manualSymbol, setManualSymbol] = useState('');
  const [manualAnalysis, setManualAnalysis] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
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

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    
    if (diffSecs < 60) {
      return `${diffSecs}s ago`;
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else {
      return date.toLocaleTimeString();
    }
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

  return (
    <div className="h-screen bg-[#1e1e1e] text-[#cccccc] flex flex-col overflow-hidden">
      {/* Clean Minimalist Header */}
      {!isHeaderHidden && (
        <header className="bg-[#252526] border-b border-[#3e3e42]">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-[#007acc] rounded-md flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-[#cccccc]">Trading Dashboard</h1>
                  <p className="text-xs text-[#969696]">Real-time alerts & analysis</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                {/* Connection Status */}
                {chartsWatcherStatus && (
                  <div className="flex items-center space-x-2 px-2 py-1 bg-[#2d2d30] rounded-md">
                    <div className={`w-1.5 h-1.5 rounded-full ${chartsWatcherStatus.isConnected ? 'bg-[#4ec9b0]' : 'bg-[#f44747]'}`}></div>
                    <span className="text-xs text-[#cccccc]">
                      {chartsWatcherStatus.isConnected ? 'Live' : 'Offline'}
                    </span>
                  </div>
                )}

                {/* Live Mode Toggle */}
                <button
                  onClick={toggleLiveMode}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    isLiveMode
                      ? 'bg-[#0e639c] text-[#ffffff]'
                      : 'bg-[#2d2d30] text-[#cccccc] hover:bg-[#3e3e42]'
                  }`}
                >
                  {isLiveMode ? 'Live' : 'Paused'}
                </button>

                {/* Refresh Button */}
                <button
                  onClick={handleRefresh}
                  disabled={loading}
                  className="p-1.5 text-[#cccccc] hover:text-[#ffffff] hover:bg-[#2d2d30] rounded-md transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                </button>

                {/* Hide Header Button */}
                <button
                  onClick={() => setIsHeaderHidden(true)}
                  className="p-1.5 text-[#cccccc] hover:text-[#ffffff] hover:bg-[#2d2d30] rounded-md transition-all"
                  title="Hide header for more space"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </header>
      )}

      {/* Clean Stats Bar */}
      {!isHeaderHidden && (
        <div className="bg-[#252526] border-b border-[#3e3e42] px-6 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-[#4ec9b0] rounded-full"></div>
                <div>
                  <span className="text-sm font-medium text-[#cccccc]">{validAlerts.length}</span>
                  <span className="text-xs text-[#969696] ml-1">valid</span>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-[#808080] rounded-full"></div>
                <div>
                  <span className="text-sm font-medium text-[#cccccc]">{filteredAlerts.length}</span>
                  <span className="text-xs text-[#969696] ml-1">filtered</span>
                </div>
              </div>

              {conditionStats && (
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-[#007acc] rounded-full"></div>
                  <div>
                    <span className="text-sm font-medium text-[#cccccc]">{conditionStats.overall?.passRate || 0}%</span>
                    <span className="text-xs text-[#969696] ml-1">success</span>
                  </div>
                </div>
              )}
            </div>
            
            {lastUpdated && (
              <div className="text-xs text-[#969696]">
                {lastUpdated.toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
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

      {/* Navigation with grouped tabs and Alerts toggle */}
      <div className="bg-[#252526] border-b border-[#3e3e42]">
        <div className="flex px-6 items-center">
          {/* Alerts group */}
          <div className="flex items-center space-x-1">
            <span className="text-xs text-[#808080] mr-2">Alerts</span>
            {[
              { key: 'dashboard', label: 'Dashboard', count: validAlerts.length },
              { key: 'all', label: 'All', count: allAlerts.length },
              { key: 'valid', label: 'Valid', count: validAlerts.length },
              { key: 'filtered', label: 'Filtered', count: filteredAlerts.length }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setSelectedTab(tab.key as any)}
                className={`px-3 py-2 text-sm font-medium transition-all rounded-md ${
                  selectedTab === tab.key
                    ? 'text-[#ffffff] bg-[#2d2d30]'
                    : 'text-[#969696] hover:text-[#cccccc]'
                }`}
              >
                {tab.label} {tab.count > 0 && <span className="ml-1 text-xs text-[#808080]">({tab.count})</span>}
              </button>
            ))}
          </div>

          {/* Lists group */}
          <div className="flex items-center space-x-1 ml-6">
            <span className="text-xs text-[#808080] mr-2">Lists</span>
            {[
              { key: 'testlist', label: 'Test List', count: 0 },
              { key: 'listas-float-raw', label: 'Listas FLOAT (RAW)', count: 0 },
              { key: 'config-float', label: 'Config FLOAT', count: 0 },
              { key: 'buy-list', label: 'Buy List', count: 0 }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setSelectedTab(tab.key as any)}
                className={`px-3 py-2 text-sm font-medium transition-all rounded-md ${
                  selectedTab === tab.key
                    ? 'text-[#ffffff] bg-[#2d2d30]'
                    : 'text-[#969696] hover:text-[#cccccc]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tools group */}
          <div className="flex items-center space-x-1 ml-6">
            <span className="text-xs text-[#808080] mr-2">Tools</span>
            {[
              { key: 'verification', label: '🔬 Verification', count: 0 }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setSelectedTab(tab.key as any)}
                className={`px-3 py-2 text-sm font-medium transition-all rounded-md ${
                  selectedTab === tab.key
                    ? 'text-[#ffffff] bg-[#2d2d30]'
                    : 'text-[#969696] hover:text-[#cccccc]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Alerts toggle */}
          <div className="ml-auto flex items-center space-x-2">
            <button
              onClick={async () => {
                try {
                  await fetch(`${API_BASE_URL.replace(/\/$/, '')}/alerts/enable`, { method: 'POST' });
                } catch {}
              }}
              className="px-3 py-1.5 text-xs rounded bg-[#0e639c] text-white hover:bg-[#1177bb]"
              title="Enable Alerts WebSocket"
            >
              Enable Alerts
            </button>
            <button
              onClick={async () => {
                try {
                  await fetch(`${API_BASE_URL.replace(/\/$/, '')}/alerts/disable`, { method: 'POST' });
                } catch {}
              }}
              className="px-3 py-1.5 text-xs rounded bg-[#3e3e42] text-[#cccccc] hover:bg-[#4a4a4f]"
              title="Disable Alerts WebSocket"
            >
              Disable Alerts
            </button>
            {isHeaderHidden && (
              <button
                onClick={() => setIsHeaderHidden(false)}
                className="px-3 py-1.5 text-xs rounded bg-[#3e3e42] text-[#cccccc] hover:bg-[#4a4a4f]"
                title="Show header"
              >
                Show Header
              </button>
            )}
          </div>
        </div>
      </div>

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
        {selectedTab === 'dashboard' ? (
          <Suspense 
            fallback={
              <div className="flex items-center justify-center h-full text-[#969696]">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#4ec9b0] mr-2"></div>
                Loading dashboard...
              </div>
            }
          >
            <TradingDashboard 
              alerts={allAlerts} 
              loading={loading}
            />
          </Suspense>
        ) : selectedTab === 'testlist' ? (
          <Suspense 
            fallback={
              <div className="flex items-center justify-center h-full text-[#969696]">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#4ec9b0] mr-2"></div>
                Loading test list...
              </div>
            }
          >
            <TestListSection />
          </Suspense>
        ) : selectedTab === 'config-float' ? (
          <Suspense 
            fallback={
              <div className="flex items-center justify-center h-full text-[#969696]">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#4ec9b0] mr-2"></div>
                Loading config...
              </div>
            }
          >
            <FloatConfigPanel />
          </Suspense>
        ) : selectedTab === 'listas-float-raw' ? (
          <Suspense 
            fallback={
              <div className="flex items-center justify-center h-full text-[#969696]">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#4ec9b0] mr-2"></div>
                Loading raw lists...
              </div>
            }
          >
            <FloatRawListsSection onSymbolClick={(symbol) => {
              if (!symbol) return;
              const sym = symbol.toUpperCase();
              setError(null);
              setSelectedStockInfo({ ticker: sym, isLoading: true });
              setShowStockInfoModal(true);
              fetchStockInfo(sym);
            }} />
          </Suspense>
        ) : selectedTab === 'buy-list' ? (
          <Suspense 
            fallback={
              <div className="flex items-center justify-center h-full text-[#969696]">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#4ec9b0] mr-2"></div>
                Loading buy list...
              </div>
            }
          >
            <BuyListSection />
          </Suspense>
        ) : selectedTab === 'verification' ? (
          <Suspense 
            fallback={
              <div className="flex items-center justify-center h-full text-[#969696]">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#4ec9b0] mr-2"></div>
                Loading verification...
              </div>
            }
          >
            <MACDEMAVerification />
          </Suspense>
        ) : (
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
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={closeStockInfoModal}
          >
            <div 
              className="bg-[#1e1e1e] rounded-lg shadow-2xl border border-[#3e3e42] w-full max-w-5xl max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header - TradingView Style */}
              <div className="bg-[#252526] border-b border-[#3e3e42] px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-3">
                      <div className={`w-3 h-3 rounded-full ${selectedStockInfo.evaluation?.allConditionsMet ? 'bg-[#4ec9b0]' : 'bg-[#808080]'}`}></div>
                      <div>
                        <h2 className="text-xl font-bold text-[#cccccc]">{selectedStockInfo.ticker}</h2>
                        <p className="text-sm text-[#969696]">
                          {selectedStockInfo.companyInfo?.name || 'Loading company info...'}
                        </p>
                      </div>
                    </div>
                    {selectedStockInfo.isLoading && (
                      <div className="flex items-center space-x-2 text-[#969696]">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#4ec9b0]"></div>
                        <span className="text-xs">Loading...</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={closeStockInfoModal}
                    className="p-2 text-[#969696] hover:text-[#cccccc] hover:bg-[#3e3e42] rounded transition-all duration-200"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Modal Content */}
              <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
                {selectedStockInfo.error ? (
                  <div className="text-center py-8">
                    <div className="text-[#f44747] mb-2">⚠️ Error loading data</div>
                    <div className="text-[#969696] text-sm">{selectedStockInfo.error}</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column - Basic Info */}
                    <div className="space-y-4">
                      {/* Price Information */}
                      <div className="bg-[#252526] rounded-lg border border-[#3e3e42] p-4">
                        <h3 className="text-sm font-semibold text-[#cccccc] mb-3 uppercase tracking-wide">Precio</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">Alerta</span>
                            <span className="text-[#cccccc] font-mono text-sm font-bold">
                              {selectedStockInfo.price ? `$${selectedStockInfo.price.toFixed(2)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">Último</span>
                            <span className="text-[#cccccc] font-mono text-sm">
                              {selectedStockInfo.lastCandle?.close ? `$${selectedStockInfo.lastCandle.close.toFixed(2)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">VWAP</span>
                            <span className="text-[#cccccc] font-mono text-sm">
                              {selectedStockInfo.indicators?.vwap1m ? `$${selectedStockInfo.indicators.vwap1m.toFixed(2)}` : 'N/A'}
                            </span>
                          </div>
                          {selectedStockInfo.changePercent !== undefined && (
                            <div className="flex justify-between items-center">
                              <span className="text-[#969696] text-sm">Cambio</span>
                              <span className={`font-mono text-sm ${selectedStockInfo.changePercent >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                                {selectedStockInfo.changePercent >= 0 ? '+' : ''}{selectedStockInfo.changePercent.toFixed(2)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Extreme Prices */}
                      <div className="bg-[#252526] rounded-lg border border-[#3e3e42] p-4">
                        <h3 className="text-sm font-semibold text-[#cccccc] mb-3 uppercase tracking-wide">Rango del Día</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">LOD</span>
                            <span className="text-[#f44747] font-mono text-sm">
                              {selectedStockInfo.indicators?.lod ? `$${selectedStockInfo.indicators.lod.toFixed(2)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">HOD</span>
                            <span className="text-[#4ec9b0] font-mono text-sm">
                              {selectedStockInfo.indicators?.hod ? `$${selectedStockInfo.indicators.hod.toFixed(2)}` : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Technical Conditions */}
                      <div className="bg-[#252526] rounded-lg border border-[#3e3e42] p-4">
                        <h3 className="text-sm font-semibold text-[#cccccc] mb-3 uppercase tracking-wide">Technical Conditions</h3>
                        <div className="space-y-2">
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
                                <div className="flex justify-between items-center">
                                  <span className="text-[#969696] text-xs">MACD 5m Histogram {'>'} 0</span>
                                  <span className={`text-xs px-2 py-0.5 rounded ${!failedConditionsMap.has('macd5mHistogramPositive') ? 'bg-[#4ec9b0]/20 text-[#4ec9b0]' : 'bg-[#f44747]/20 text-[#f44747]'}`}>
                                    {!failedConditionsMap.has('macd5mHistogramPositive') ? '✓' : '✗'} {macd5m?.histogram?.toFixed(4) || 'N/A'}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[#969696] text-xs">MACD 5m {'>'} 0</span>
                                  <span className={`text-xs px-2 py-0.5 rounded ${!failedConditionsMap.has('macd5mPositive') ? 'bg-[#4ec9b0]/20 text-[#4ec9b0]' : 'bg-[#f44747]/20 text-[#f44747]'}`}>
                                    {!failedConditionsMap.has('macd5mPositive') ? '✓' : '✗'} {macd5m?.macd?.toFixed(4) || 'N/A'}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[#969696] text-xs">MACD 1m {'>'} 0</span>
                                  <span className={`text-xs px-2 py-0.5 rounded ${!failedConditionsMap.has('macd1mPositive') ? 'bg-[#4ec9b0]/20 text-[#4ec9b0]' : 'bg-[#f44747]/20 text-[#f44747]'}`}>
                                    {!failedConditionsMap.has('macd1mPositive') ? '✓' : '✗'} {macd1m?.macd?.toFixed(4) || 'N/A'}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[#969696] text-xs">Close {'>'} EMA 18 1m</span>
                                  <span className={`text-xs px-2 py-0.5 rounded ${!failedConditionsMap.has('closeAboveEma18_1m') ? 'bg-[#4ec9b0]/20 text-[#4ec9b0]' : 'bg-[#f44747]/20 text-[#f44747]'}`}>
                                    {!failedConditionsMap.has('closeAboveEma18_1m') ? '✓' : '✗'}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[#969696] text-xs">EMA 18 5m {'>'} EMA 200 5m</span>
                                  <span className={`text-xs px-2 py-0.5 rounded ${!failedConditionsMap.has('ema18Above200_5m') ? 'bg-[#4ec9b0]/20 text-[#4ec9b0]' : 'bg-[#f44747]/20 text-[#f44747]'}`}>
                                    {!failedConditionsMap.has('ema18Above200_5m') ? '✓' : '✗'}
                                  </span>
                                </div>
                                <div className="mt-3 pt-3 border-t border-[#3e3e42]">
                                  <div className="flex justify-between items-center">
                                    <span className="text-[#969696] text-sm font-semibold">All Tech Met</span>
                                    <span className={`text-sm px-3 py-1 rounded font-semibold ${allConditionsMet ? 'bg-[#4ec9b0]/20 text-[#4ec9b0]' : 'bg-[#f44747]/20 text-[#f44747]'}`}>
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
                    <div className="space-y-4">
                      <div className="bg-[#252526] rounded-lg border border-[#3e3e42] p-4">
                        <h3 className="text-sm font-semibold text-[#cccccc] mb-3 uppercase tracking-wide">MACD 1m</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">Histogram</span>
                            <span className={`font-mono text-xs ${selectedStockInfo.indicators?.macd1m?.histogram >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                              {selectedStockInfo.indicators?.macd1m?.histogram ? selectedStockInfo.indicators.macd1m.histogram.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">MACD</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.macd1m?.macd ? selectedStockInfo.indicators.macd1m.macd.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">Signal</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.macd1m?.signal ? selectedStockInfo.indicators.macd1m.signal.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* EMA 1m */}
                      <div className="bg-[#252526] rounded-lg border border-[#3e3e42] p-4">
                        <h3 className="text-sm font-semibold text-[#cccccc] mb-3 uppercase tracking-wide">EMA 1m</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">EMA 12</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema1m12 ? `$${selectedStockInfo.indicators.ema1m12.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">EMA 20</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema1m20 ? `$${selectedStockInfo.indicators.ema1m20.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">EMA 26</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema1m26 ? `$${selectedStockInfo.indicators.ema1m26.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">EMA 200</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema1m200 ? `$${selectedStockInfo.indicators.ema1m200.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Column - MACD 5m & EMA 5m */}
                    <div className="space-y-4">
                      <div className="bg-[#252526] rounded-lg border border-[#3e3e42] p-4">
                        <h3 className="text-sm font-semibold text-[#cccccc] mb-3 uppercase tracking-wide">MACD 5m</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">Histogram</span>
                            <span className={`font-mono text-xs ${selectedStockInfo.indicators?.macd5m?.histogram >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                              {selectedStockInfo.indicators?.macd5m?.histogram ? selectedStockInfo.indicators.macd5m.histogram.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">MACD</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.macd5m?.macd ? selectedStockInfo.indicators.macd5m.macd.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">Signal</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.macd5m?.signal ? selectedStockInfo.indicators.macd5m.signal.toFixed(6) : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* EMA 5m */}
                      <div className="bg-[#252526] rounded-lg border border-[#3e3e42] p-4">
                        <h3 className="text-sm font-semibold text-[#cccccc] mb-3 uppercase tracking-wide">EMA 5m</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">EMA 12</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema5m12 ? `$${selectedStockInfo.indicators.ema5m12.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">EMA 20</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema5m20 ? `$${selectedStockInfo.indicators.ema5m20.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">EMA 26</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema5m26 ? `$${selectedStockInfo.indicators.ema5m26.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">EMA 200</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.indicators?.ema5m200 ? `$${selectedStockInfo.indicators.ema5m200.toFixed(6)}` : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Volume Info */}
                      <div className="bg-[#252526] rounded-lg border border-[#3e3e42] p-4">
                        <h3 className="text-sm font-semibold text-[#cccccc] mb-3 uppercase tracking-wide">Volumen</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">Último</span>
                            <span className="text-[#cccccc] font-mono text-sm">
                              {selectedStockInfo.lastCandle?.volume ? selectedStockInfo.lastCandle.volume.toLocaleString() : 'N/A'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-[#969696] text-sm">Timestamp</span>
                            <span className="text-[#cccccc] font-mono text-xs">
                              {selectedStockInfo.timestamp ? new Date(selectedStockInfo.timestamp).toLocaleTimeString() : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ChartsWatcher Alert Data Section - Always show if data exists */}
                    {selectedStockInfo.chartswatcherData && (selectedStockInfo.chartswatcherData.rawColumns || selectedStockInfo.chartswatcherData.alertType === 'websocket_alert') && (
                      <div className="col-span-1 lg:col-span-3 space-y-4">
                        {/* Parsed Data - Only show if we have parsed values */}
                        {(selectedStockInfo.chartswatcherData.open !== null || 
                          selectedStockInfo.chartswatcherData.high !== null || 
                          selectedStockInfo.chartswatcherData.low !== null || 
                          selectedStockInfo.chartswatcherData.close !== null ||
                          selectedStockInfo.chartswatcherData.volume !== null ||
                          selectedStockInfo.chartswatcherData.change !== null ||
                          selectedStockInfo.chartswatcherData.changePercent !== null) && (
                        <div className="bg-[#252526] rounded-lg border border-[#3e3e42] p-4">
                          <h3 className="text-sm font-semibold text-[#cccccc] mb-3 uppercase tracking-wide flex items-center">
                            <svg className="w-4 h-4 mr-2 text-[#4ec9b0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            ChartsWatcher Alert Data (Parsed)
                          </h3>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {selectedStockInfo.chartswatcherData.open !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#969696] text-xs mb-1">Open</span>
                                <span className="text-[#cccccc] font-mono text-sm">
                                  ${selectedStockInfo.chartswatcherData.open.toFixed(2)}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.high !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#969696] text-xs mb-1">High</span>
                                <span className="text-[#4ec9b0] font-mono text-sm">
                                  ${selectedStockInfo.chartswatcherData.high.toFixed(2)}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.low !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#969696] text-xs mb-1">Low</span>
                                <span className="text-[#f44747] font-mono text-sm">
                                  ${selectedStockInfo.chartswatcherData.low.toFixed(2)}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.close !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#969696] text-xs mb-1">Close</span>
                                <span className="text-[#cccccc] font-mono text-sm">
                                  ${selectedStockInfo.chartswatcherData.close.toFixed(2)}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.volume !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#969696] text-xs mb-1">Volume</span>
                                <span className="text-[#cccccc] font-mono text-sm">
                                  {selectedStockInfo.chartswatcherData.volume.toLocaleString()}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.change !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#969696] text-xs mb-1">Change</span>
                                <span className={`font-mono text-sm ${selectedStockInfo.chartswatcherData.change >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                                  {selectedStockInfo.chartswatcherData.change >= 0 ? '+' : ''}${selectedStockInfo.chartswatcherData.change.toFixed(2)}
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.changePercent !== null && (
                              <div className="flex flex-col">
                                <span className="text-[#969696] text-xs mb-1">Change %</span>
                                <span className={`font-mono text-sm ${selectedStockInfo.chartswatcherData.changePercent >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                                  {selectedStockInfo.chartswatcherData.changePercent >= 0 ? '+' : ''}{selectedStockInfo.chartswatcherData.changePercent.toFixed(2)}%
                                </span>
                              </div>
                            )}
                            {selectedStockInfo.chartswatcherData.alertType === 'websocket_alert' && (
                              <div className="flex flex-col">
                                <span className="text-[#969696] text-xs mb-1">Alert Type</span>
                                <span className="text-[#4ec9b0] font-mono text-xs">
                                  Live Alert
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        )}

                        {/* Raw Columns Received */}
                        {selectedStockInfo.chartswatcherData.rawColumns && selectedStockInfo.chartswatcherData.rawColumns.length > 0 && (
                          <div className="bg-[#252526] rounded-lg border border-[#3e3e42] p-4">
                            <h3 className="text-sm font-semibold text-[#cccccc] mb-3 uppercase tracking-wide flex items-center">
                              <svg className="w-4 h-4 mr-2 text-[#808080]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                              </svg>
                              Alert Columns Received
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {selectedStockInfo.chartswatcherData.rawColumns.map((column: any, idx: number) => (
                                <div key={idx} className="bg-[#1e1e1e] rounded p-3 border border-[#3e3e42]">
                                  <div className="text-[#969696] text-xs mb-1">{column.key}</div>
                                  <div className="text-[#cccccc] font-mono text-sm break-all">
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
      </div>
    </div>
  );
}

export default App;