import { useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { formatTimestampRelative } from '../utils/timeFormat';

interface Alert {
  ticker: string;
  timestamp: string;
  price?: number;
  volume?: number;
  indicators: {
    ema1m18: number | null;
    ema1m200: number | null;
    ema5m18: number | null;
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
}

interface AlertsSidebarProps {
  alerts: Alert[];
  selectedAlert: Alert | null;
  onAlertSelect: (alert: Alert) => void;
  loading?: boolean;
}

const AlertsSidebar: React.FC<AlertsSidebarProps> = ({
  alerts,
  selectedAlert,
  onAlertSelect,
  loading = false
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const formatTimestamp = (timestamp: string) => {
    return formatTimestampRelative(timestamp);
  };

  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  const debounceRef = useRef<number | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      setDebouncedSearch(value);
    }, 200);
  };

  const filteredAlerts = useMemo(() => {
    const query = debouncedSearch.toLowerCase();
    if (!query) return alerts.filter(a => a.evaluation.allConditionsMet);
    return alerts.filter(alert => 
      alert.evaluation.allConditionsMet && alert.ticker.toLowerCase().includes(query)
    );
  }, [alerts, debouncedSearch]);

  const validAlerts = filteredAlerts.filter(alert => alert.evaluation.allConditionsMet);

  return (
    <div className="alerts-sidebar bg-[#252526] border-l border-[#3e3e42] w-80 flex flex-col h-full flex-shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-[#3e3e42]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#cccccc]">Valid Alerts</h2>
          <div className="text-xs text-[#969696]">
            {validAlerts.length} signals
          </div>
        </div>
        
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search symbol..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full px-3 py-2 bg-[#2d2d30] border border-[#3e3e42] rounded-md text-[#cccccc] placeholder-[#808080] focus:outline-none focus:ring-1 focus:ring-[#007acc] focus:border-transparent text-sm"
          />
          <svg className="absolute right-3 top-2.5 w-4 h-4 text-[#808080]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Alerts List */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#007acc]"></div>
          </div>
        ) : validAlerts.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <svg className="w-8 h-8 text-[#808080] mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm text-[#969696]">No valid alerts</p>
            </div>
          </div>
        ) : (
          <Virtuoso
            style={{ height: '100%' }}
            data={validAlerts}
            overscan={150}
            itemContent={(index, alert) => (
              <div className="p-3" key={`${alert.ticker}-${alert.timestamp}-${index}`}>
                <div
                  onClick={() => onAlertSelect(alert)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-sm ${
                    selectedAlert?.ticker === alert.ticker && selectedAlert?.timestamp === alert.timestamp
                      ? 'border-[#007acc] bg-[#0e639c]'
                      : 'border-[#3e3e42] bg-[#2d2d30] hover:border-[#007acc] hover:bg-[#3e3e42]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-1.5 h-1.5 bg-[#4ec9b0] rounded-full"></div>
                      <span className="font-semibold text-[#cccccc] text-sm">{alert.ticker}</span>
                    </div>
                    <div className="text-xs text-[#969696]">
                      {formatTimestamp(alert.timestamp)}
                    </div>
                  </div>
                  <div className="mb-2">
                    <div className="text-lg font-semibold text-[#cccccc]">
                      {alert.lastCandle?.close ? formatPrice(alert.lastCandle.close) : 'N/A'}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-[#969696]">
                      Score: <span className="text-[#cccccc] font-medium">{alert.evaluation.score}</span>
                    </div>
                    <div className="px-2 py-0.5 bg-[#0d3a2e] text-[#4ec9b0] text-xs rounded-md font-medium">
                      BUY
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                    <div className="text-[#969696]">
                      MACD 1m: <span className={`font-mono ${alert.indicators.macd1m && alert.indicators.macd1m.macd >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                        {alert.indicators.macd1m ? alert.indicators.macd1m.macd.toFixed(4) : 'N/A'}
                      </span>
                    </div>
                    <div className="text-[#969696]">
                      MACD 5m: <span className={`font-mono ${alert.indicators.macd5m && alert.indicators.macd5m.macd >= 0 ? 'text-[#4ec9b0]' : 'text-[#f44747]'}`}>
                        {alert.indicators.macd5m ? alert.indicators.macd5m.macd.toFixed(4) : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          />
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-[#3e3e42]">
        <div className="text-xs text-[#969696] text-center mb-3">
          Click on an alert to view charts
        </div>
        
        {/* Action Button */}
        <button 
          className="w-full px-4 py-2 bg-[#0e639c] text-[#ffffff] text-sm font-medium rounded-md hover:bg-[#1177bb] focus:outline-none focus:ring-2 focus:ring-[#007acc] focus:ring-offset-2 focus:ring-offset-[#252526] transition-colors duration-200"
          onClick={() => {
            // TODO: Add functionality in the future
            console.log('Action button clicked');
          }}
        >
          Action
        </button>
      </div>
    </div>
  );
};

export default AlertsSidebar;
