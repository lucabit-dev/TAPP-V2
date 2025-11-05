import React from 'react';
import { useAuth } from '../auth/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';

interface ToplistColumn { key: string; value: string; text_color: string; color: string; }
interface ToplistRow { color: string; symbol: string; columns: ToplistColumn[]; }

const LISTS: Array<{ id: string; label: string }>= [
  { id: '68ecefc9420a933c6c60a971', label: 'A' },
  { id: '68ecefcb420a933c6c60a997', label: 'B' },
  { id: '68ecefcd420a933c6c60aaaa', label: 'C' },
  { id: '68ecefce420a933c6c60aabb', label: 'D' },
  { id: '68eceff9420a933c6c60b6eb', label: 'E' }
];

interface Props {
  onSymbolClick?: (symbol: string | null | undefined) => void;
}

const FloatRawListsSection: React.FC<Props> = ({ onSymbolClick }) => {
  const { fetchWithAuth } = useAuth();
  const [raw, setRaw] = React.useState<Record<string, ToplistRow[]>>({});
  const [unified, setUnified] = React.useState<Array<ToplistRow & { origin: string }>>([]);
  const meetsTechRef = React.useRef<Set<string>>(new Set());
  const meetsMomentumRef = React.useRef<Set<string>>(new Set());
  const [meetsTechSet, setMeetsTechSet] = React.useState<Set<string>>(new Set());
  const [meetsMomentumSet, setMeetsMomentumSet] = React.useState<Set<string>>(new Set());
  const [thresholds, setThresholds] = React.useState<Record<string, any>>({});
  const updateTimerRef = React.useRef<number | null>(null);
  const [updateCounter, setUpdateCounter] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [connectionStatus, setConnectionStatus] = React.useState<'checking' | 'connected' | 'disconnected'>('checking');
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const [isRestarting, setIsRestarting] = React.useState(false);
  const [restartStatus, setRestartStatus] = React.useState<'idle' | 'ok' | 'error'>('idle');
  const restartMsgTimerRef = React.useRef<number | null>(null);
  const [buysEnabled, setBuysEnabled] = React.useState(false);
  const [isTogglingBuys, setIsTogglingBuys] = React.useState(false);
  const [buyingSymbols, setBuyingSymbols] = React.useState<Set<string>>(new Set());
  const [buyStatuses, setBuyStatuses] = React.useState<Record<string, 'success' | 'error' | null>>({});

  // Build unified list whenever raw changes
  React.useEffect(() => {
    const originByConfig: Record<string, string> = Object.fromEntries(LISTS.map(l => [l.id, l.label]));
    const res: Array<ToplistRow & { origin: string }>= [];
    Object.keys(raw).forEach((configId) => {
      const origin = originByConfig[configId] || '?';
      const rows = raw[configId] || [];
      rows.forEach(row => res.push({ ...row, origin }));
    });
    // Stable sort by symbol
    res.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
    setUnified(res);
  }, [raw]);

  React.useEffect(() => {
    const load = async () => {
      try {
        const [toplistRes, buysRes] = await Promise.all([
          fetch(`${API_BASE_URL}/toplist`),
          fetch(`${API_BASE_URL}/buys/enabled`)
        ]);
        const [toplistData, buysData] = await Promise.all([
          toplistRes.json(),
          buysRes.json()
        ]);
        if (toplistData.success) setRaw(toplistData.data || {});
        if (buysData.success) setBuysEnabled(Boolean(buysData.data?.enabled));
      } finally {
        setLoading(false);
      }
    };
    load();

    const connect = () => {
      try {
        wsRef.current = new WebSocket(WS_BASE_URL);
        wsRef.current.onopen = () => {
          setConnectionStatus('connected');
          reconnectAttemptsRef.current = 0;
        };
        wsRef.current.onerror = () => {
          setConnectionStatus('checking');
          try { wsRef.current && wsRef.current.close(); } catch {}
        };
        wsRef.current.onclose = () => {
          setConnectionStatus('checking');
          const attempts = reconnectAttemptsRef.current + 1;
          reconnectAttemptsRef.current = attempts;
          const delay = Math.min(15000, 1000 * Math.pow(2, attempts - 1));
          if (reconnectTimerRef.current) {
            window.clearTimeout(reconnectTimerRef.current);
          }
          reconnectTimerRef.current = window.setTimeout(() => {
            connect();
          }, delay);
        };
        wsRef.current.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'TOPLIST_UPDATE' && msg.data && msg.data.config_id) {
              const { config_id, rows } = msg.data;
              setRaw(prev => ({ ...prev, [config_id]: rows || [] }));
            }
            if (msg.type === 'STOCK_TECH_UPDATE' && msg.data && msg.data.symbol) {
              // Individual stock update - update refs immediately and debounce render
              const symbol = String(msg.data.symbol).trim().toUpperCase();
              
              // Update refs immediately for instant data
              if (msg.data.meetsTech) {
                meetsTechRef.current.add(symbol);
              } else {
                meetsTechRef.current.delete(symbol);
              }
              
              if (msg.data.meetsMomentum) {
                meetsMomentumRef.current.add(symbol);
              } else {
                meetsMomentumRef.current.delete(symbol);
              }
              
              // Debounce state update to batch multiple updates (60fps = ~16ms)
              if (updateTimerRef.current) {
                window.clearTimeout(updateTimerRef.current);
              }
              updateTimerRef.current = window.setTimeout(() => {
                setMeetsTechSet(new Set(meetsTechRef.current));
                setMeetsMomentumSet(new Set(meetsMomentumRef.current));
                setUpdateCounter(prev => prev + 1); // Force re-render
                console.log(`🔄 State updated - Tech: ${meetsTechRef.current.size}, Momentum: ${meetsMomentumRef.current.size}`);
              }, 16);
            }
            if (msg.type === 'RAW_TECH_CHECKS' && msg.data) {
              console.log('📥 Received RAW_TECH_CHECKS (batch):', msg.data);
              if (Array.isArray(msg.data.meetsTech)) {
                const newTechSet = new Set<string>(msg.data.meetsTech);
                meetsTechRef.current = newTechSet;
                setMeetsTechSet(newTechSet);
                console.log(`✅ Tech: ${msg.data.meetsTech.length} stocks:`, msg.data.meetsTech.join(', ') || '(none)');
              }
              if (Array.isArray(msg.data.meetsMomentum)) {
                const newMomentumSet = new Set<string>(msg.data.meetsMomentum);
                meetsMomentumRef.current = newMomentumSet;
                setMeetsMomentumSet(newMomentumSet);
                console.log(`✓ Momentum: ${msg.data.meetsMomentum.length} stocks:`, msg.data.meetsMomentum.join(', ') || '(none)');
                
                // Log which stocks are ready (green)
                const ready = msg.data.meetsTech.filter((s: string) => newMomentumSet.has(s));
                if (ready.length > 0) {
                  console.log(`🟢 READY (green): ${ready.join(', ')}`);
                }
                const techOnly = msg.data.meetsTech.filter((s: string) => !newMomentumSet.has(s));
                if (techOnly.length > 0) {
                  console.log(`🟡 TECH ONLY (yellow): ${techOnly.join(', ')}`);
                }
              }
            }
            if (msg.type === 'FLOAT_THRESHOLDS' && msg.data) {
              console.log('📥 Received FLOAT_THRESHOLDS:', msg.data);
              setThresholds(msg.data);
            }
          } catch {}
        };
      } catch {}
    };
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (updateTimerRef.current) {
        window.clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
      }
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const theme = 'bg-[#14130e] text-[#eae9e9] border-[#2a2820]';
  
  // Visible symbols in current unified list (normalized)
  const currentSymbolSet = React.useMemo(() => {
    const set = new Set<string>();
    unified.forEach((row) => {
      const symbolVal = row.symbol || (Array.isArray(row.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value as string) : undefined);
      if (symbolVal) set.add(String(symbolVal).trim().toUpperCase());
    });
    return set;
  }, [unified]);
  
  // Helper functions for header resolution (must be defined before counters)
  type HeaderSpec = { title: string; key: string | null };
  const shortenHeaderTitle = (title: string): string => {
    const map: Record<string, string> = {
      'Symbol': 'S',
      'Price': 'P',
      'Distance from VWAP': 'VWAP',
      'Change from close': 'Chg',
      'Consecutive': 'Cons',
      'ConsecutiveCandleFilterFM1': 'Cons',
      'Change from open': 'Open',
      '2 min change': '2m',
      '5 min change': '5m',
      '10 min change': '10m',
      '1 min trade count': '1m#',
      '5 min trade count': '5m#',
      '5 min volume': '5mV',
      '10 min volume': '10mV',
      '30 min volume': '30mV',
      'high of the day': 'HOD',
      'low of the day': 'LOD'
    };
    return map[title] || title;
  };
  
  const resolveHeaders = (rows: ToplistRow[]): HeaderSpec[] => {
    const availableKeysSet = new Set<string>();
    rows.forEach(r => (r.columns || []).forEach(c => availableKeysSet.add(c.key)));
    const availableKeys = Array.from(availableKeysSet);

    const tryResolve = (candidates: string[], fallback?: (k: string) => boolean): string | null => {
      for (const cand of candidates) {
        if (availableKeysSet.has(cand)) return cand;
      }
      if (fallback) {
        const found = availableKeys.find(fallback);
        if (found) return found;
      }
      return null;
    };

    const specs: Array<{ title: string; candidates: string[]; fallback?: (k: string) => boolean }> = [
      { title: 'Symbol', candidates: ['SymbolColumn', 'Symbol', 'Ticker'] },
      { title: 'Price', candidates: ['PriceNOOPTION', 'Price'] },
      { title: 'Distance from VWAP', candidates: ['DistanceFromVWAP', 'DistanceFromVwapNOOPTION', 'DistanceFromVwap'], fallback: k => /vwap/i.test(k) && /dist/i.test(k) },
      { title: 'Change from close', candidates: ['ChangeFromClosePRZ', 'ChangeFromClose'], fallback: k => /change/i.test(k) && /close/i.test(k) },
      { title: 'ConsecutiveCandleFilterFM1', candidates: ['ConsecutiveCandleFilterFM1'] },
      { title: 'Change from open', candidates: ['ChangeFromOpenPRZ', 'ChangeFromOpen'], fallback: k => /change/i.test(k) && /open/i.test(k) },
      { title: '2 min change', candidates: ['PrzChangeFilterMIN2', 'ChangeMIN2', 'Change2MIN'], fallback: k => /change/i.test(k) && /(min2|2min|fm2)/i.test(k) },
      { title: '5 min change', candidates: ['PrzChangeFilterMIN5', 'ChangeMIN5', 'Change5MIN'], fallback: k => /change/i.test(k) && /(min5|5min|fm5)/i.test(k) },
      { title: '10 min change', candidates: ['PrzChangeFilterMIN10', 'ChangeMIN10', 'Change10MIN'], fallback: k => /change/i.test(k) && /(min10|10min|fm10)/i.test(k) },
      { title: '1 min trade count', candidates: ['TradeCountMIN1', 'TradesMIN1', 'TradeCountFM1'], fallback: k => /trade/i.test(k) && /(min1|1min|fm1)/i.test(k) },
      { title: '5 min trade count', candidates: ['TradeCountMIN5', 'TradesMIN5', 'TradeCountFM5'], fallback: k => /trade/i.test(k) && /(min5|5min|fm5)/i.test(k) },
      { title: '5 min volume', candidates: ['PrzVolumeFilterFM5', 'VolumeMIN5', 'Volume5MIN', 'PrzVolumeFM5'], fallback: k => /volume/i.test(k) && /(min5|5min|fm5)/i.test(k) },
      { title: '10 min volume', candidates: ['PrzVolumeFilterFM10', 'VolumeMIN10', 'Volume10MIN', 'PrzVolumeFM10'], fallback: k => /volume/i.test(k) && /(min10|10min|fm10)/i.test(k) },
      { title: '30 min volume', candidates: ['PrzVolumeFilterFM30', 'VolumeMIN30', 'Volume30MIN', 'PrzVolumeFM30'], fallback: k => /volume/i.test(k) && /(min30|30min|fm30)/i.test(k) },
      { title: 'high of the day', candidates: ['HighOfDay', 'HOD', 'HighOfTheDay'], fallback: k => /high/i.test(k) && /day/i.test(k) },
      { title: 'low of the day', candidates: ['LowOfDay', 'LOD', 'LowOfTheDay'], fallback: k => /low/i.test(k) && /day/i.test(k) }
    ];

    return specs.map(s => ({ title: s.title, key: tryResolve(s.candidates, s.fallback) }));
  };
  
  // Parse column values for threshold comparison
  const parsePercent = (val: string | null | undefined): number | null => {
    if (!val) return null;
    const clean = String(val).replace(/[^0-9.\-]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  };
  const parseIntLike = (val: string | null | undefined): number | null => {
    if (!val) return null;
    const clean = String(val).replace(/[^0-9\-]/g, '');
    const num = parseInt(clean, 10);
    return isNaN(num) ? null : num;
  };
  const parseVolume = (val: string | null | undefined): number | null => {
    if (!val) return null;
    const raw = String(val).trim();
    const num = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
    if (isNaN(num)) return null;
    const upper = raw.toUpperCase();
    if (upper.includes('B')) return Math.round(num * 1_000_000_000);
    if (upper.includes('M')) return Math.round(num * 1_000_000);
    if (upper.includes('K')) return Math.round(num * 1_000);
    return Math.round(num);
  };
  
  // Get cell color based on threshold comparison
  const getCellColor = (columnKey: string, value: string | null | undefined, origin: string): string => {
    const t = thresholds[origin];
    if (!t || !value) return '';
    
    // 5 Min Change (%)
    if (/PrzChangeFilterMIN5|ChangeMIN5|Change5MIN/i.test(columnKey) || (/change/i.test(columnKey) && /(min5|5min|fm5)/i.test(columnKey))) {
      const val = parsePercent(value);
      if (val === null) return '';
      const result = val >= t.change5mPct ? 'bg-[#22c55e]' : 'bg-[#f87171]';
      return result;
    }
    
    // 1 Min Trade Count
    if (/TradeCountMIN1|TradesMIN1|TradeCountFM1/i.test(columnKey) || (/trade/i.test(columnKey) && /(min1|1min|fm1)/i.test(columnKey))) {
      const val = parseIntLike(value);
      if (val === null) return '';
      const result = val >= t.trades1m ? 'bg-[#22c55e]' : 'bg-[#f87171]';
      return result;
    }
    
    // 5 Min Volume
    if (/PrzVolumeFilterFM5|PrzVolumeFM5|VolumeMIN5|Volume5MIN/i.test(columnKey) || (/volume/i.test(columnKey) && /(min5|5min|fm5)/i.test(columnKey))) {
      const val = parseVolume(value);
      if (val === null) return '';
      const result = val >= t.vol5m ? 'bg-[#22c55e]' : 'bg-[#f87171]';
      return result;
    }
    
    // Change From Open (%)
    if (/ChangeFromOpenPRZ|ChangeFromOpen/i.test(columnKey) || (/change/i.test(columnKey) && /open/i.test(columnKey))) {
      const val = parsePercent(value);
      if (val === null) return '';
      const result = val >= t.changeFromOpenPct ? 'bg-[#22c55e]' : 'bg-[#f87171]';
      return result;
    }
    
    return '';
  };
  
  // Check if all momentum columns pass thresholds for a row
  const checkAllMomentumColumnsPass = (row: any, headers: Array<{ key: string | null }>, origin: string): boolean => {
    // Define the 4 required momentum columns with their specific patterns
    const requiredMomentumColumns = [
      {
        name: '5 Min Change',
        checkPattern: (key: string) => {
          return /PrzChangeFilterMIN5|ChangeMIN5|Change5MIN/i.test(key) || 
                 (/change/i.test(key) && /(min5|5min|fm5)/i.test(key));
        },
        thresholdKey: 'change5mPct'
      },
      {
        name: '1 Min Trade Count',
        checkPattern: (key: string) => {
          return /TradeCountMIN1|TradesMIN1|TradeCountFM1/i.test(key) || 
                 (/trade/i.test(key) && /(min1|1min|fm1)/i.test(key));
        },
        thresholdKey: 'trades1m'
      },
      {
        name: '5 Min Volume',
        checkPattern: (key: string) => {
          return /PrzVolumeFilterFM5|PrzVolumeFM5|VolumeMIN5|Volume5MIN/i.test(key) || 
                 (/volume/i.test(key) && /(min5|5min|fm5)/i.test(key));
        },
        thresholdKey: 'vol5m'
      },
      {
        name: 'Change From Open',
        checkPattern: (key: string) => {
          return /ChangeFromOpenPRZ|ChangeFromOpen/i.test(key) || 
                 (/change/i.test(key) && /open/i.test(key));
        },
        thresholdKey: 'changeFromOpenPct'
      }
    ];
    
    const t = thresholds[origin];
    if (!t) return false; // No thresholds for this origin
    
    const columnsByKey = new Map<string, { value: string | null }>();
    if (row.columns) {
      row.columns.forEach((col: any) => {
        if (col.key) columnsByKey.set(col.key, { value: col.value });
      });
    }
    
    // Check each required momentum column
    for (const requiredColumn of requiredMomentumColumns) {
      // Find matching header
      let matchingHeader: { key: string | null } | null = null;
      for (const header of headers) {
        if (!header.key) continue;
        
        // Check if header matches the pattern for this required column
        if (requiredColumn.checkPattern(header.key)) {
          matchingHeader = header;
          break;
        }
      }
      
      // If required column not found in headers, cannot verify - return false
      if (!matchingHeader || !matchingHeader.key) {
        return false;
      }
      
      // Get column value
      const column = columnsByKey.get(matchingHeader.key);
      const value = column?.value ?? null;
      
      // If value is missing or null, doesn't pass
      if (!value) {
        return false;
      }
      
      // Check if this column passes its threshold
      const cellColor = getCellColor(matchingHeader.key, value, origin);
      
      // If cell color is not green (bg-[#22c55e]), then this column doesn't pass
      if (!cellColor || !cellColor.includes('bg-[#22c55e]')) {
        return false;
      }
    }
    
    // All required momentum columns were found and all passed
    return true;
  };
  
  // Count only YELLOW (Tech only) visible stocks - using same logic as highlighting
  const techCountInView = React.useMemo(() => {
    if (!unified.length) return 0;
    const headers = resolveHeaders(unified);
    if (!headers.length) return 0;
    let count = 0;
    unified.forEach((row) => {
      const symbolVal = row.symbol || (Array.isArray(row.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value as string) : undefined);
      const cleanSymbol = symbolVal ? String(symbolVal).trim().toUpperCase() : null;
      const meetsTech = cleanSymbol ? meetsTechSet.has(cleanSymbol) : false;
      const allMomentumColumnsPass = checkAllMomentumColumnsPass(row, headers, row.origin);
      
      // Count only if meets tech but NOT all momentum (yellow highlight)
      if (meetsTech && !allMomentumColumnsPass) {
        count++;
      }
    });
    return count;
  }, [unified, meetsTechSet]);
  
  // Count momentum and BOTH within current view
  const momCountInView = React.useMemo(() => {
    if (!unified.length) return 0;
    const headers = resolveHeaders(unified);
    if (!headers.length) return 0;
    let count = 0;
    unified.forEach((row) => {
      const allMomentumColumnsPass = checkAllMomentumColumnsPass(row, headers, row.origin);
      if (allMomentumColumnsPass) count++;
    });
    return count;
  }, [unified]);
  
  // Count GREEN (Tech AND all momentum columns pass) - using same logic as highlighting
  const bothCountInView = React.useMemo(() => {
    if (!unified.length) return 0;
    const headers = resolveHeaders(unified);
    if (!headers.length) return 0;
    let count = 0;
    unified.forEach((row) => {
      const symbolVal = row.symbol || (Array.isArray(row.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value as string) : undefined);
      const cleanSymbol = symbolVal ? String(symbolVal).trim().toUpperCase() : null;
      const meetsTech = cleanSymbol ? meetsTechSet.has(cleanSymbol) : false;
      const allMomentumColumnsPass = checkAllMomentumColumnsPass(row, headers, row.origin);
      
      // Count only if meets tech AND all momentum columns pass (green highlight)
      if (meetsTech && allMomentumColumnsPass) {
        count++;
      }
    });
    return count;
  }, [unified, meetsTechSet]);
  
  const handleRestart = async () => {
    if (isRestarting) return;
    setIsRestarting(true);
    setRestartStatus('idle');
    try {
      const resp = await fetch(`${API_BASE_URL}/toplist/restart`, { method: 'POST' });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.success) {
        setRestartStatus('ok');
      } else {
        setRestartStatus('error');
      }
    } catch {
      setRestartStatus('error');
    } finally {
      setIsRestarting(false);
      if (restartMsgTimerRef.current) {
        window.clearTimeout(restartMsgTimerRef.current);
      }
      restartMsgTimerRef.current = window.setTimeout(() => {
        setRestartStatus('idle');
      }, 2500);
    }
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

  const handleBuyClick = async (symbol: string | null | undefined) => {
    if (!symbol) return;
    
    const cleanSymbol = String(symbol).trim().toUpperCase();
    if (buyingSymbols.has(cleanSymbol)) return; // Prevent duplicate clicks
    
    setBuyingSymbols(prev => new Set(prev).add(cleanSymbol));
    setBuyStatuses(prev => ({ ...prev, [cleanSymbol]: null }));
    
    try {
      const resp = await fetchWithAuth(`${API_BASE_URL}/buys/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: cleanSymbol })
      });
      
      const data = await resp.json().catch(() => ({}));
      
      if (resp.ok && data?.success) {
        console.log(`✅ Buy signal sent for ${cleanSymbol}:`, data.data?.notifyStatus);
        setBuyStatuses(prev => ({ ...prev, [cleanSymbol]: 'success' }));
        // Clear status after 3 seconds
        setTimeout(() => {
          setBuyStatuses(prev => {
            const next = { ...prev };
            delete next[cleanSymbol];
            return next;
          });
        }, 3000);
      } else {
        console.error(`❌ Failed to send buy signal for ${cleanSymbol}:`, data.error || 'Unknown error');
        setBuyStatuses(prev => ({ ...prev, [cleanSymbol]: 'error' }));
        setTimeout(() => {
          setBuyStatuses(prev => {
            const next = { ...prev };
            delete next[cleanSymbol];
            return next;
          });
        }, 3000);
      }
    } catch (error) {
      console.error(`❌ Error sending buy signal for ${cleanSymbol}:`, error);
      setBuyStatuses(prev => ({ ...prev, [cleanSymbol]: 'error' }));
      setTimeout(() => {
        setBuyStatuses(prev => {
          const next = { ...prev };
          delete next[cleanSymbol];
          return next;
        });
      }, 3000);
    } finally {
      setBuyingSymbols(prev => {
        const next = new Set(prev);
        next.delete(cleanSymbol);
        return next;
      });
    }
  };

  const getColumnDisplayName = (key: string): string => {
    const map: Record<string,string> = {
      'SymbolColumn': 'Symbol',
      'PriceNOOPTION': 'Price',
      'ChangeFromClosePRZ': 'Change From Close',
      'ChangeFromOpenPRZ': 'Change From Open',
      'PrzChangeFilterMIN5': '5m Change',
      'PrzVolumeFilterFM5': '5m Volume',
      'PrzVolumeSameTimeNOOPTION': 'Vol vs Same Time',
      'NewFloatNOOPTION': 'Float'
    };
    return map[key] || key;
  };

  return (
    <div className="h-full flex flex-col bg-[#14130e]">
      <div className="p-4 border-b border-[#2a2820]/50 bg-gradient-to-r from-[#14130e] to-[#0f0e0a] flex items-center justify-between backdrop-blur-sm">
        <div>
          <h2 className="text-sm font-bold text-[#eae9e9] tracking-wider uppercase mb-1.5">Listas FLOAT (RAW)</h2>
          <p className="text-[11px] text-[#eae9e9]/70 mt-0.5">
            Datos directos de ChartsWatcher
            {techCountInView > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-[#fbbf24] text-[#14130e] rounded-sm text-[10px] font-bold shadow-[0_0_8px_rgba(251,191,36,0.3)]">
                ⚡ {techCountInView} tech
              </span>
            )}
            {(() => {
              // Count stocks that meet BOTH tech AND momentum (GREEN) in current view
              const ready = bothCountInView;
              if (ready > 0) {
                return (
                  <span className="ml-2 px-2 py-0.5 bg-[#22c55e] text-[#14130e] rounded-sm text-[10px] font-bold shadow-[0_0_8px_rgba(34,197,94,0.3)]">
                    ✓ {ready} ready
                  </span>
                );
              }
              return null;
            })()}
          </p>
        </div>
        <div className="text-[11px] text-[#eae9e9]/80 flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <div className={`w-2.5 h-2.5 rounded-full ${connectionStatus === 'connected' ? 'bg-[#22c55e] shadow-[0_0_6px_rgba(34,197,94,0.5)]' : (connectionStatus === 'checking' ? 'bg-[#eae9e9] opacity-60' : 'bg-[#f87171] shadow-[0_0_6px_rgba(248,113,113,0.5)]')}`}></div>
            <span className="font-medium">{connectionStatus === 'connected' ? 'En vivo' : (connectionStatus === 'checking' ? 'Checking' : 'Desconectado')}</span>
          </div>
          <button
            className={`ml-2 px-3 py-1 rounded-sm text-[11px] font-bold transition-all ${isTogglingBuys ? 'bg-[#2a2820] cursor-not-allowed opacity-50' : (buysEnabled ? 'bg-[#22c55e] text-[#14130e] hover:bg-[#16a34a] shadow-[0_0_8px_rgba(34,197,94,0.3)]' : 'bg-[#f87171] text-[#14130e] hover:bg-[#ef4444] shadow-[0_0_8px_rgba(248,113,113,0.3)]')}`}
            onClick={toggleBuys}
            disabled={isTogglingBuys}
            title={buysEnabled ? 'Disable automatic buys' : 'Enable automatic buys'}
          >{isTogglingBuys ? '...' : (buysEnabled ? 'Buys: ON' : 'Buys: OFF')}</button>
          <button
            className={`ml-2 px-3 py-1 rounded-sm text-[11px] font-bold transition-all ${isRestarting ? 'bg-[#2a2820] cursor-not-allowed opacity-50' : 'bg-[#eae9e9]/10 text-[#eae9e9] hover:bg-[#eae9e9]/20 border border-[#eae9e9]/20'}`}
            onClick={handleRestart}
            disabled={isRestarting}
            title="Reiniciar conexión Toplist"
          >{isRestarting ? 'Restarting…' : 'Restart'}</button>
          {restartStatus === 'ok' && (
            <span className="ml-2 text-[#22c55e] font-semibold">Reiniciado</span>
          )}
          {restartStatus === 'error' && (
            <span className="ml-2 text-[#f87171] font-semibold">Error</span>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 p-3 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#eae9e9] opacity-60" />
          </div>
              ) : (
                <div className={`${theme} rounded-md border flex flex-col h-full`}>
                  <div className="px-2 py-1.5 border-b border-[#2a2820]/50 flex items-center justify-between bg-gradient-to-r from-[#14130e] to-[#0f0e0a] flex-shrink-0">
                    <div className="font-bold text-[12px] tracking-wider text-[#eae9e9] uppercase">
                      Lista Unificada
                      <span className="ml-2 text-[9px] text-[#eae9e9]/60 font-mono normal-case">
                        (Tech: {techCountInView}, Mom: {momCountInView}, Both: {bothCountInView})
                      </span>
                    </div>
                    <div className="text-[10px] text-[#eae9e9]/70 font-medium">{unified.length} stocks</div>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {unified.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-[10px] opacity-60">Sin datos</div>
                    ) : (
                      <div className="p-1">
                  {(() => {
                    const headers = resolveHeaders(unified);
                    const colCount = headers.length + 2; // +1 Origin column + 1 BUY button column
                    return (
                      <>
                        <div
                          className="grid gap-0.5 text-[9px] opacity-60 mb-0.5 sticky top-0 bg-[#14130e] py-1 z-10"
                          style={{ gridTemplateColumns: `50px repeat(${headers.length}, minmax(60px, 1fr)) 60px` }}
                        >
                          {/* Origin column at the start */}
                          <div className="text-center leading-3 px-0.5"><span className="truncate inline-block" title="Origen">Origen</span></div>
                          {/* Other headers */}
                          {headers.map((h, i) => (
                            <div key={i} className="text-center leading-3 px-0.5">
                              <span className="truncate inline-block" title={h.title}>{shortenHeaderTitle(h.title)}</span>
                            </div>
                          ))}
                          {/* BUY button column at the end */}
                          <div className="text-center leading-3 px-0.5"><span className="truncate inline-block" title="Action">BUY</span></div>
                        </div>
                        <div className="space-y-0.5">
                          {unified.map((row, idx) => {
                            const symbolVal = row.symbol || (Array.isArray(row.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value as string) : undefined);
                            const columnsByKey = new Map((row.columns || []).map(c => [c.key, c]));
                            
                            // Clean and normalize symbol (trim whitespace, uppercase)
                            const cleanSymbol = symbolVal ? String(symbolVal).trim().toUpperCase() : null;
                            const meetsTech = cleanSymbol ? meetsTechSet.has(cleanSymbol) : false;
                            
                            // Check if all momentum columns pass thresholds for this row
                            const allMomentumColumnsPass = checkAllMomentumColumnsPass(row, headers, row.origin);
                            
                            // Stock is green only if it meets tech AND all momentum columns pass
                            const meetsAll = meetsTech && allMomentumColumnsPass;
                            
                            // Determine row background color
                            let rowBgColor = idx % 2 === 0 ? 'bg-[#0f0e0a]' : ''; // default alternating
                            let hoverColor = 'hover:bg-[#1e1d17]'; // default hover
                            if (meetsAll) {
                              rowBgColor = 'bg-[#22c55e]'; // solid green: meets tech AND all momentum columns pass
                              hoverColor = 'hover:bg-[#22c55e]/80'; // hover with opacity
                            } else if (meetsTech) {
                              rowBgColor = 'bg-[#eab308]'; // solid yellow: meets tech only
                              hoverColor = 'hover:bg-[#eab308]/80'; // hover with opacity
                            }
                            // Note: momentum-only rows are not highlighted
                            
                            return (
                              <div
                                key={`${symbolVal || 'row'}-${idx}`}
                                className={`grid gap-0.5 text-[9px] border-b border-[#2a2820] py-0.5 ${rowBgColor} ${hoverColor}`}
                                style={{ gridTemplateColumns: `50px repeat(${headers.length}, minmax(60px, 1fr)) 60px` }}
                                title={`Ver detalles de ${symbolVal || ''} - Tech: ${meetsTech ? '✓' : '✗'}, All Momentum: ${allMomentumColumnsPass ? '✓' : '✗'} ${meetsAll ? '(READY TO BUY)' : ''}`}
                              >
                                {/* Origin column at the start */}
                                <div className="text-center leading-4 px-0.5">
                                  <span className={`truncate block font-bold ${meetsAll || meetsTech ? 'text-[#14130e]' : 'text-[#eae9e9]'}`}>{row.origin}</span>
                                </div>
                                {/* Other columns */}
                                {headers.map((h, i) => {
                                  const c = h.key ? columnsByKey.get(h.key) : undefined;
                                  const value = c?.value ?? '—';
                                  const cellColor = h.key ? getCellColor(h.key, value, row.origin) : '';
                                  
                                  // Debug cell colors for first row
                                  if (idx === 0 && cellColor) {
                                    console.log(`Cell color for ${h.key}:`, cellColor, 'value:', value, 'origin:', row.origin);
                                  }
                                  
                                  // Determine text color based on row highlight or cell highlight
                                  const isRowHighlighted = meetsAll || meetsTech;
                                  const isCellHighlighted = cellColor && cellColor.includes('bg-[');
                                  const textColor = isRowHighlighted || isCellHighlighted ? 'text-[#14130e]' : 'text-[#eae9e9]';
                                  
                                  return (
                                    <div key={i} className={`text-center leading-4 ${cellColor ? 'px-0' : 'px-0.5'}`} onClick={() => onSymbolClick && onSymbolClick(symbolVal)}>
                                      <span className={`block font-mono ${textColor} ${cellColor ? 'py-0 h-full w-full' : 'px-0.5 py-0.5 rounded'} ${cellColor}`} style={{ minHeight: '1rem' }}>{value}</span>
                                    </div>
                                  );
                                })}
                                {/* BUY button column at the end */}
                                <div className="text-center leading-4 px-0.5">
                                  {(() => {
                                    const symbolForBuy = cleanSymbol || null;
                                    const isBuying = symbolForBuy ? buyingSymbols.has(symbolForBuy) : false;
                                    const status = symbolForBuy ? buyStatuses[symbolForBuy] : null;
                                    const isDisabled = isBuying || !symbolForBuy;
                                    
                                    let buttonClass = 'px-2 py-0.5 text-[9px] font-semibold rounded transition-colors';
                                    let buttonText = 'BUY';
                                    let buttonTitle = `Send buy signal for ${symbolVal}`;
                                    
                                    if (isBuying) {
                                      buttonClass += ' bg-[#2a2820] cursor-not-allowed opacity-50';
                                      buttonText = '...';
                                      buttonTitle = `Sending buy signal for ${symbolVal}...`;
                                    } else if (status === 'success') {
                                      buttonClass += ' bg-[#4ade80] text-[#14130e]';
                                      buttonText = '✓';
                                      buttonTitle = `Buy signal sent successfully for ${symbolVal}`;
                                    } else if (status === 'error') {
                                      buttonClass += ' bg-[#f87171] text-[#14130e]';
                                      buttonText = '✗';
                                      buttonTitle = `Failed to send buy signal for ${symbolVal}`;
                                    } else {
                                      // Show different colors based on stock status
                                      if (meetsAll) {
                                        buttonClass += ' bg-[#4ade80] text-[#14130e] hover:bg-[#22c55e]';
                                        buttonTitle = `Send buy signal for ${symbolVal} (Tech + Momentum ready)`;
                                      } else if (meetsTech) {
                                        buttonClass += ' bg-[#eae9e9] text-[#14130e] hover:bg-[#d4d3d3] opacity-60';
                                        buttonTitle = `Send buy signal for ${symbolVal} (Tech only)`;
                                      } else {
                                        buttonClass += ' bg-[#2a2820] text-[#eae9e9] hover:bg-[#3d3a30]';
                                      }
                                    }
                                    
                                    return (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!isDisabled) {
                                            handleBuyClick(symbolVal);
                                          }
                                        }}
                                        disabled={isDisabled}
                                        className={buttonClass}
                                        title={buttonTitle}
                                      >
                                        {buttonText}
                                      </button>
                                    );
                                  })()}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FloatRawListsSection;


