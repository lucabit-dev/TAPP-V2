import { useState, useEffect } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

interface VerificationStatus {
  monitoring: boolean;
  symbols: string[];
  statistics: {
    entriesToday: number;
    entriesBySymbol: { [key: string]: number };
    symbolsTracked: number;
    latestEntry?: {
      timestamp: string;
      symbol: string;
      macd1m: { macd: number; signal: number; histogram: number };
      macd5m: { macd: number; signal: number; histogram: number };
      [key: string]: any;
    };
  };
  logFile: string;
}

interface VerificationEntry {
  timestamp: string;
  symbol: string;
  macd1m: { macd: number; signal: number; histogram: number };
  macd5m: { macd: number; signal: number; histogram: number };
  ema1m12?: number;
  ema1m18?: number;
  ema1m20?: number;
  ema1m26?: number;
  ema1m200?: number;
  ema5m12?: number;
  ema5m18?: number;
  ema5m20?: number;
  ema5m26?: number;
  ema5m200?: number;
  lastClose?: number;
}

const MACDEMAVerification: React.FC = () => {
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [verificationData, setVerificationData] = useState<VerificationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<'start' | 'stop'>('start');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [lastCollectionTime, setLastCollectionTime] = useState<Date | null>(null);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      fetchStatus();
    }, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchVerificationData();
    const interval = setInterval(() => {
      fetchVerificationData();
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedSymbol]);

  const fetchVerificationData = async () => {
    try {
      const url = selectedSymbol 
        ? `${API_BASE_URL}/verification/data?symbol=${selectedSymbol}`
        : `${API_BASE_URL}/verification/data`;
      
      const response = await fetch(url);
      const data = await response.json();
      if (data.success) {
        setVerificationData(data.data);
        
        // Update last collection time from most recent entry
        if (data.data && data.data.length > 0) {
          const latestEntry = data.data[data.data.length - 1];
          setLastCollectionTime(new Date(latestEntry.timestamp));
        }
      }
    } catch (error) {
      console.error('Error fetching verification data:', error);
    }
  };

  const fetchStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/verification/status`);
      const data = await response.json();
      setStatus(data);
      setAction(data.monitoring ? 'stop' : 'start');
    } catch (error) {
      console.error('Error fetching verification status:', error);
    }
  };

  const handleAction = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/verification/${action}`);
      const data = await response.json();
      console.log('Action result:', data);
      await fetchStatus();
      
      // If starting, also fetch data immediately
      if (action === 'start') {
        setTimeout(() => {
          fetchVerificationData();
        }, 2000);
      }
    } catch (error) {
      console.error('Error performing action:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCollectNow = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/verification/collect-now`);
      const data = await response.json();
      console.log('Manual collection:', data);
      
      // Wait a bit then fetch updated data
      setTimeout(() => {
        fetchVerificationData();
        fetchStatus();
      }, 2000);
    } catch (error) {
      console.error('Error collecting data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatValue = (value: number | null | undefined, decimals = 4): string => {
    if (value === null || value === undefined) return 'N/A';
    return value.toFixed(decimals);
  };

  const formatPrice = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return 'N/A';
    return `$${value.toFixed(6)}`;
  };

  if (!status) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4ec9b0]"></div>
      </div>
    );
  }

  // Ensure statistics exists with default values
  const statistics = status.statistics || {
    entriesToday: 0,
    entriesBySymbol: {},
    symbolsTracked: status.symbols?.length || 0,
    latestEntry: null
  };

  // Ensure entriesBySymbol is always an object
  const entriesBySymbol = statistics.entriesBySymbol || {};

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      {/* Header */}
      <div className="p-4 border-b border-[#3e3e42] bg-[#252526]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#cccccc]">MACD/EMA Verification</h1>
            <p className="text-sm text-[#969696] mt-1">
              Track MACD and EMA values for accuracy validation
            </p>
          </div>
          <div className="flex items-center space-x-4">
            {/* Status */}
            <div className={`px-3 py-2 rounded-lg flex items-center space-x-2 ${
              status.monitoring 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-gray-700/20 text-gray-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${status.monitoring ? 'bg-green-400' : 'bg-gray-400'}`}></div>
              <span className="text-sm font-medium">
                {status.monitoring ? 'Active' : 'Stopped'}
              </span>
            </div>

            {/* Control Buttons */}
            {status.monitoring && (
              <button
                onClick={handleCollectNow}
                disabled={loading}
                className="px-3 py-2 rounded-lg bg-[#3e3e42] hover:bg-[#4a4a4f] text-[#cccccc] disabled:opacity-50 text-sm transition-colors"
                title="Force immediate data collection"
              >
                {loading ? '...' : '⟳ Refresh'}
              </button>
            )}

            <button
              onClick={handleAction}
              disabled={loading}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                action === 'start'
                  ? 'bg-blue-500 hover:bg-blue-600 text-white'
                  : 'bg-red-500 hover:bg-red-600 text-white'
              } disabled:opacity-50`}
            >
              {loading ? '...' : (action === 'start' ? '▶ Start' : '■ Stop')}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 bg-[#1e1e1e] border-b border-[#3e3e42]">
        <div className="flex items-center space-x-8">
          <div>
            <div className="text-xs text-[#808080]">Entries Today</div>
            <div className="text-lg font-bold text-[#cccccc]">{statistics.entriesToday}</div>
          </div>
          <div>
            <div className="text-xs text-[#808080]">Symbols Tracked</div>
            <div className="text-lg font-bold text-blue-500">{statistics.symbolsTracked}</div>
          </div>
          <div>
            <div className="text-xs text-[#808080]">Last Update</div>
            <div className="text-sm font-mono text-[#cccccc]">
              {lastCollectionTime ? lastCollectionTime.toLocaleTimeString() : 'Never'}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#808080]">Interval</div>
            <div className="text-sm font-medium text-green-500">60s</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4">

        {/* Monitored Symbols */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-[#cccccc]">Monitored Symbols ({statistics.symbolsTracked})</h2>
            {selectedSymbol && (
              <button
                onClick={() => setSelectedSymbol(null)}
                className="px-3 py-1 text-xs bg-[#3e3e42] hover:bg-[#4a4a4f] rounded text-[#cccccc] transition-colors"
              >
                View All
              </button>
            )}
          </div>
          <div className="grid grid-cols-5 gap-2">
            {status.symbols && status.symbols.length > 0 ? (
              status.symbols.map((symbol) => {
                const entries = entriesBySymbol[symbol] || 0;
                const isSelected = selectedSymbol === symbol;
                return (
                  <div 
                    key={symbol} 
                    onClick={() => {
                      const newSelection = isSelected ? null : symbol;
                      setSelectedSymbol(newSelection);
                      setTimeout(() => fetchVerificationData(), 100);
                    }}
                    className={`rounded-lg border cursor-pointer transition-all p-3 ${
                      isSelected 
                        ? 'bg-[#1e3a5f] border-blue-500' 
                        : 'bg-[#252526] border-[#3e3e42] hover:border-blue-500/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className={`w-8 h-8 rounded flex items-center justify-center font-bold text-sm ${
                          isSelected ? 'bg-blue-500 text-white' : 'bg-[#3e3e42] text-[#969696]'
                        }`}>
                          {symbol}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-[#cccccc]">{symbol}</div>
                          <div className="text-[10px] text-[#808080]">{entries}</div>
                        </div>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${
                        entries > 0 ? 'bg-green-500' : 'bg-gray-600'
                      }`}></div>
                    </div>
                  </div>
                );
              })
            ) : null}
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-[#252526] rounded-lg border border-[#3e3e42] overflow-hidden">
          {/* Table Header */}
          <div className="px-4 py-3 bg-[#2a2a2d] border-b border-[#3e3e42] flex items-center justify-between">
            <div className="text-sm font-semibold text-[#cccccc]">
              {selectedSymbol ? `${selectedSymbol} Logs` : 'All Verification Logs'}
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-xs text-[#808080] font-mono">
                {verificationData.length} {verificationData.length === 1 ? 'entry' : 'entries'}
              </div>
              {verificationData.length > 0 && (
                <div className="text-xs text-green-400 font-medium">
                  Latest: {verificationData[0] ? new Date(verificationData[0].timestamp).toLocaleTimeString() : 'N/A'}
                </div>
              )}
            </div>
          </div>

          {/* Table Content */}
          {verificationData.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-5xl mb-4">📊</div>
              <h3 className="text-lg font-semibold text-[#cccccc] mb-2">No Data Yet</h3>
              <p className="text-sm text-[#808080] mb-4">
                {status.monitoring 
                  ? 'Collecting data every 60 seconds...'
                  : 'Click "Start" to begin monitoring'}
              </p>
              {!status.monitoring && (
                <button
                  onClick={handleAction}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Start Monitoring
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[calc(100vh-400px)]">
              <table className="w-full">
                <thead className="bg-[#2a2a2d] sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">Symbol</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">MACD 1m</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">Signal 1m</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">Hist 1m</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">MACD 5m</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">Signal 5m</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">Hist 5m</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">EMA 12</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">EMA 18</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">EMA 20</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">EMA 200</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#808080] uppercase tracking-wider">Close</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#3e3e42]">
                  {verificationData.map((entry, index) => {
                    const entryTime = new Date(entry.timestamp);
                    const isRecent = (Date.now() - entryTime.getTime()) < 120000;
                    
                    return (
                      <tr 
                        key={`${entry.symbol}-${entry.timestamp}-${index}`} 
                        className={`hover:bg-[#2a2a2d] transition-colors ${
                          index % 2 === 0 ? 'bg-[#252526]' : ''
                        }`}
                      >
                        <td className="px-4 py-3 text-xs text-[#cccccc] font-mono whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            {isRecent && <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>}
                            <span>{entryTime.toLocaleTimeString()}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-semibold text-blue-500">
                            {entry.symbol}
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-xs font-mono ${(entry.macd1m?.macd >= 0) ? 'text-green-400' : 'text-red-400'}`}>
                          {formatValue(entry.macd1m?.macd)}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#cccccc] font-mono">
                          {formatValue(entry.macd1m?.signal)}
                        </td>
                        <td className={`px-4 py-3 text-xs font-mono ${(entry.macd1m?.histogram >= 0) ? 'text-green-400' : 'text-red-400'}`}>
                          {formatValue(entry.macd1m?.histogram)}
                        </td>
                        <td className={`px-4 py-3 text-xs font-mono ${(entry.macd5m?.macd >= 0) ? 'text-green-400' : 'text-red-400'}`}>
                          {formatValue(entry.macd5m?.macd)}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#cccccc] font-mono">
                          {formatValue(entry.macd5m?.signal)}
                        </td>
                        <td className={`px-4 py-3 text-xs font-mono ${(entry.macd5m?.histogram >= 0) ? 'text-green-400' : 'text-red-400'}`}>
                          {formatValue(entry.macd5m?.histogram)}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#cccccc] font-mono">
                          {formatPrice(entry.ema1m12)}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#cccccc] font-mono">
                          {formatPrice(entry.ema1m18)}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#cccccc] font-mono">
                          {formatPrice(entry.ema1m20)}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#cccccc] font-mono">
                          {formatPrice(entry.ema1m200)}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#cccccc] font-mono font-semibold">
                          {formatPrice(entry.lastClose)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MACDEMAVerification;

