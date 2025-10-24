import React from 'react';
import { Virtuoso } from 'react-virtuoso';

interface ToplistColumn {
  key: string;
  value: string;
  text_color: string;
  color: string;
}

interface ToplistRow {
  color: string;
  symbol: string;
  columns: ToplistColumn[];
}

// Removed unused interface - keeping for reference if needed later
// interface ToplistUpdate {
//   "@type": "ToplistUpdate";
//   config_id: string;
//   rows: ToplistRow[];
// }

interface ToplistWidgetProps {
  height?: string;
  theme?: 'light' | 'dark';
  showHeader?: boolean;
}

const ToplistWidget: React.FC<ToplistWidgetProps> = ({
  height = "400px",
  theme = "dark",
  // showHeader prop available but not currently used in render
}) => {
  const [toplistData, setToplistData] = React.useState<ToplistRow[]>([]);
  const [isConnected, setIsConnected] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [ws, setWs] = React.useState<WebSocket | null>(null);
  const reconnectAttemptsRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const heartbeatTimerRef = React.useRef<number | null>(null);
  const lastPongAtRef = React.useRef<number>(Date.now());

  React.useEffect(() => {
    connectToToplist();
    return () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (heartbeatTimerRef.current) {
        window.clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      try { ws && ws.close(); } catch {}
    };
  }, []);

  const connectToToplist = () => {
    try {
      const websocketUrl = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';
      const newWs = new WebSocket(websocketUrl);
      
      newWs.onopen = () => {
        console.log('Connected to server WebSocket for toplist updates');
        setIsConnected(true);
        setLoading(false);
        reconnectAttemptsRef.current = 0;
        // Start lightweight client heartbeat to detect silent drops (server responds with pong)
        lastPongAtRef.current = Date.now();
        if (heartbeatTimerRef.current) {
          window.clearInterval(heartbeatTimerRef.current);
        }
        heartbeatTimerRef.current = window.setInterval(() => {
          try {
            if (newWs.readyState === WebSocket.OPEN) {
              // Send a ping frame alternative: text-based ping for browsers
              newWs.send(JSON.stringify({ type: 'PING', t: Date.now() }));
              // If no messages for > 90s, consider dead and force close to trigger reconnect
              if (Date.now() - lastPongAtRef.current > 90000) {
                try { newWs.close(); } catch {}
              }
            }
          } catch {}
        }, 30000);
      };
      
      newWs.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message && (message.type === 'PONG' || message.type === 'TOPLIST_UPDATE' || message.type === 'FLOAT_LIST_VALIDATED')) {
            lastPongAtRef.current = Date.now();
          }
          handleServerMessage(message);
        } catch (error) {
          console.error('Error parsing server message:', error);
        }
      };
      
      newWs.onclose = (ev) => {
        console.log('Toplist WebSocket connection closed', ev?.code, ev?.reason || '');
        setIsConnected(false);
        setWs(null);
        // Backoff reconnect
        const attempts = reconnectAttemptsRef.current + 1;
        reconnectAttemptsRef.current = attempts;
        const delay = Math.min(15000, 1000 * Math.pow(2, attempts - 1));
        if (reconnectTimerRef.current) {
          window.clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = window.setTimeout(() => {
          connectToToplist();
        }, delay);
      };
      
      newWs.onerror = (error) => {
        console.error('Toplist WebSocket error:', error);
        setError('Failed to connect to toplist service');
        setLoading(false);
        try { newWs.close(); } catch {}
      };
      
      setWs(newWs);
    } catch (error) {
      console.error('Failed to connect to toplist WebSocket:', error);
      setError('Failed to connect to toplist service');
      setLoading(false);
    }
  };


  const handleServerMessage = (message: any) => {
    console.log('Received server message:', message);
    
    if (message.type === "TOPLIST_UPDATE") {
      console.log('Received toplist update from server:', message.data);
      if (message.data && message.data.rows) {
        setToplistData(message.data.rows);
        setError(null);
      }
    }
  };

  // Column name mapping for better display
  const getColumnDisplayName = (key: string): string => {
    const columnNames: { [key: string]: string } = {
      'SymbolColumn': 'Symbol',
      'ChangeFromClosePRZ': 'Change from Close',
      'NewFloatNOOPTION': 'Float',
      'ChangeFromOpenPRZ': 'Change from Open',
      'DistanceFromVWAPPRZ': 'Distance from VWAP',
      'PrzVolumeSameTimeNOOPTION': 'Volume vs Same Time',
      'PriceNOOPTION': 'Price',
      'PrzChangeFilterMIN5': '5m Change Filter',
      'PrzVolumeFilterFM5': '5m Volume Filter',
      'PrzRangeFilterMIN30': '30m Range Filter'
    };
    return columnNames[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
  };

  // Column width mapping for better layout
  const getColumnWidth = (key: string): string => {
    const columnWidths: { [key: string]: string } = {
      'SymbolColumn': 'col-span-1',
      'ChangeFromClosePRZ': 'col-span-2',
      'NewFloatNOOPTION': 'col-span-1',
      'ChangeFromOpenPRZ': 'col-span-2',
      'DistanceFromVWAPPRZ': 'col-span-2',
      'PrzVolumeSameTimeNOOPTION': 'col-span-2',
      'PriceNOOPTION': 'col-span-1',
      'PrzChangeFilterMIN5': 'col-span-2',
      'PrzVolumeFilterFM5': 'col-span-2',
      'PrzRangeFilterMIN30': 'col-span-2'
    };
    return columnWidths[key] || 'col-span-1';
  };

  // Utility functions - commented out as not currently used but kept for reference
  // const getColumnValue = (columns: ToplistColumn[], key: string): string => {
  //   const column = columns.find(col => col.key === key);
  //   return column ? column.value : 'N/A';
  // };

  // const getColumnColor = (columns: ToplistColumn[], key: string): string => {
  //   const column = columns.find(col => col.key === key);
  //   return column ? column.color : '#333333';
  // };

  // const getColumnTextColor = (columns: ToplistColumn[], key: string): string => {
  //   const column = columns.find(col => col.key === key);
  //   return column ? column.text_color : '#ffffff';
  // };

  // Improved text color with better contrast
  const getReadableTextColor = (originalColor: string, backgroundColor: string): string => {
    // If the original color is too dark (like rgb(33,33,33)), use white
    if (originalColor === 'rgb(33,33,33)' || originalColor === '#333333' || originalColor === '') {
      return '#ffffff';
    }
    
    // If background is light, use dark text
    if (backgroundColor && backgroundColor !== '' && backgroundColor !== 'transparent') {
      return '#000000';
    }
    
    // Default to white for dark backgrounds
    return '#ffffff';
  };

  // Format values based on column type
  const formatColumnValue = (value: string, key: string): string => {
    // For percentage values, ensure proper formatting
    if (key.includes('PRZ') || key.includes('Change') || key.includes('Filter')) {
      if (value.includes('%')) {
        return value;
      }
      // If it's a number that should be a percentage, add %
      if (!isNaN(parseFloat(value)) && !value.includes('$') && !value.includes('M')) {
        return `${value}%`;
      }
    }
    
    // For price values
    if (key === 'PriceNOOPTION') {
      return `$${value}`;
    }
    
    // For float values
    if (key === 'NewFloatNOOPTION') {
      return value;
    }
    
    // For symbol column
    if (key === 'SymbolColumn') {
      return value;
    }
    
    return value;
  };

  const themeClasses = theme === 'dark' 
    ? 'bg-[#252526] text-[#cccccc] border-[#3e3e42]' 
    : 'bg-white text-gray-900 border-gray-300';

  if (loading) {
    return (
      <div className={`h-full ${themeClasses} rounded-lg border overflow-hidden flex items-center justify-center`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p className="text-sm">Connecting to toplist...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`h-full ${themeClasses} rounded-lg border overflow-hidden flex items-center justify-center`}>
        <div className="text-center p-4">
          <div className="text-red-500 mb-2">⚠️</div>
          <p className="text-sm text-red-400">{error}</p>
          <button 
            onClick={connectToToplist}
            className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full ${themeClasses} rounded-lg border overflow-hidden flex flex-col`} style={{ height }}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[#3e3e42]">
        <h3 className="font-semibold text-[#cccccc]">Test List</h3>
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="text-xs text-[#969696]">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
          <span className="text-xs text-[#808080]">
            ({toplistData.length} stocks)
          </span>
        </div>
      </div>

      {/* Toplist Content */}
      <div className="flex-1 overflow-y-auto">
        {toplistData.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#2d2d30] rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-[#808080]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <p className="text-sm text-[#969696]">Waiting for toplist data...</p>
              <p className="text-xs text-[#808080] mt-1">Config ID: 68a9bbebb2c5294077710db4</p>
            </div>
          </div>
        ) : (
          <div className="p-4">
            {/* Table Header */}
            <div className="grid grid-cols-24 gap-1 p-3 bg-[#2d2d30] rounded-t text-xs font-semibold text-white border-b border-[#3e3e42]">
              {toplistData.length > 0 && toplistData[0].columns.map((column, index) => (
                <div key={index} className={`${getColumnWidth(column.key)} text-center`}>
                  {getColumnDisplayName(column.key)}
                </div>
              ))}
            </div>
            
            {/* Table Body - Virtualized */}
            <div className="max-h-96">
              <Virtuoso
                style={{ height: '24rem' }}
                data={toplistData}
                overscan={300}
                itemContent={(index, row) => (
                  <div 
                    key={`${row.symbol}-${index}`}
                    className="grid grid-cols-24 gap-1 p-2 border-b border-[#3e3e42] hover:bg-[#2d2d30] transition-colors"
                    style={{ backgroundColor: row.color || 'transparent' }}
                  >
                    {row.columns.map((column, colIndex) => (
                      <div key={colIndex} className={`${getColumnWidth(column.key)} flex items-center justify-center`}>
                        <div 
                          className="text-xs font-medium text-center px-2 py-1 rounded whitespace-nowrap"
                          style={{ 
                            color: getReadableTextColor(column.text_color || '', column.color || ''),
                            backgroundColor: column.color || 'transparent'
                          }}
                          title={`${getColumnDisplayName(column.key)}: ${column.value}`}
                        >
                          {formatColumnValue(column.value, column.key)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              />
            </div>
          </div>
        )}
      </div>

      {/* Simple Footer */}
      <div className="p-2 border-t border-[#3e3e42] bg-[#1e1e1e]">
        <div className="flex items-center justify-between text-xs text-[#808080]">
          <span>Config: 68a9bbebb2c5294077710db4</span>
          <span>{toplistData.length} stocks</span>
        </div>
      </div>
    </div>
  );
};

export default ToplistWidget;
