import React from 'react';

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

  const theme = 'bg-[#252526] text-[#cccccc] border-[#3e3e42]';
  
  // Visible symbols in current unified list (normalized)
  const currentSymbolSet = React.useMemo(() => {
    const set = new Set<string>();
    unified.forEach((row) => {
      const symbolVal = row.symbol || (Array.isArray(row.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value as string) : undefined);
      if (symbolVal) set.add(String(symbolVal).trim().toUpperCase());
    });
    return set;
  }, [unified]);
  
  // Count only YELLOW (Tech only) visible stocks
  const techCountInView = React.useMemo(() => {
    let count = 0;
    currentSymbolSet.forEach(sym => {
      if (meetsTechSet.has(sym) && !meetsMomentumSet.has(sym)) count++;
    });
    return count;
  }, [currentSymbolSet, meetsTechSet, meetsMomentumSet]);
  
  // Count momentum and BOTH within current view
  const momCountInView = React.useMemo(() => {
    let count = 0;
    currentSymbolSet.forEach(sym => { if (meetsMomentumSet.has(sym)) count++; });
    return count;
  }, [currentSymbolSet, meetsMomentumSet]);
  const bothCountInView = React.useMemo(() => {
    let count = 0;
    currentSymbolSet.forEach(sym => { if (meetsTechSet.has(sym) && meetsMomentumSet.has(sym)) count++; });
    return count;
  }, [currentSymbolSet, meetsTechSet, meetsMomentumSet]);
  
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
      const result = val >= t.change5mPct ? 'bg-blue-900/40' : 'bg-red-900/40';
      return result;
    }
    
    // 1 Min Trade Count
    if (/TradeCountMIN1|TradesMIN1|TradeCountFM1/i.test(columnKey) || (/trade/i.test(columnKey) && /(min1|1min|fm1)/i.test(columnKey))) {
      const val = parseIntLike(value);
      if (val === null) return '';
      const result = val >= t.trades1m ? 'bg-blue-900/40' : 'bg-red-900/40';
      return result;
    }
    
    // 5 Min Volume
    if (/PrzVolumeFilterFM5|PrzVolumeFM5|VolumeMIN5|Volume5MIN/i.test(columnKey) || (/volume/i.test(columnKey) && /(min5|5min|fm5)/i.test(columnKey))) {
      const val = parseVolume(value);
      if (val === null) return '';
      const result = val >= t.vol5m ? 'bg-blue-900/40' : 'bg-red-900/40';
      return result;
    }
    
    // Change From Open (%)
    if (/ChangeFromOpenPRZ|ChangeFromOpen/i.test(columnKey) || (/change/i.test(columnKey) && /open/i.test(columnKey))) {
      const val = parsePercent(value);
      if (val === null) return '';
      const result = val >= t.changeFromOpenPct ? 'bg-blue-900/40' : 'bg-red-900/40';
      return result;
    }
    
    return '';
  };
  
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

  type HeaderSpec = { title: string; key: string | null };
  const shortenHeaderTitle = (title: string): string => {
    const map: Record<string, string> = {
      'Symbol': 'Symbol',
      'Price': 'Price',
      'Distance from VWAP': 'Dist VWAP',
      'Change from close': 'Chg close',
      'Consecutive': 'Consecutive',
      'ConsecutiveCandleFilterFM1': 'Consec 1m',
      'Change from open': 'Chg open',
      '2 min change': '2m chg',
      '5 min change': '5m chg',
      '10 min change': '10m chg',
      '1 min trade count': '1m trades',
      '5 min trade count': '5m trades',
      '5 min volume': '5m vol',
      '10 min volume': '10m vol',
      '30 min volume': '30m vol',
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

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      <div className="p-3 border-b border-[#3e3e42] bg-[#252526] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#cccccc] tracking-wide">Listas FLOAT (RAW)</h2>
          <p className="text-[11px] text-[#808080] mt-0.5">
            Datos directos de ChartsWatcher
            {techCountInView > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-yellow-900/30 text-yellow-400 rounded text-[10px] font-semibold">
                ⚡ {techCountInView} tech
              </span>
            )}
            {(() => {
              // Count stocks that meet BOTH tech AND momentum (GREEN) in current view
              const ready = bothCountInView;
              if (ready > 0) {
                return (
                  <span className="ml-2 px-1.5 py-0.5 bg-[#0d3a2e] text-green-400 rounded text-[10px] font-semibold">
                    ✓ {ready} ready
                  </span>
                );
              }
              return null;
            })()}
          </p>
        </div>
        <div className="text-[11px] text-[#969696] flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' : (connectionStatus === 'checking' ? 'bg-yellow-500' : 'bg-red-500')}`}></div>
          <span>{connectionStatus === 'connected' ? 'En vivo' : (connectionStatus === 'checking' ? 'Checking' : 'Desconectado')}</span>
          <button
            className={`ml-2 px-2 py-0.5 rounded ${isTogglingBuys ? 'bg-[#5a5a5a] cursor-not-allowed' : (buysEnabled ? 'bg-green-600' : 'bg-red-600')} text-white`}
            onClick={toggleBuys}
            disabled={isTogglingBuys}
            title={buysEnabled ? 'Disable automatic buys' : 'Enable automatic buys'}
          >{isTogglingBuys ? '...' : (buysEnabled ? 'Buys: ON' : 'Buys: OFF')}</button>
          <button
            className={`ml-2 px-2 py-0.5 rounded ${isRestarting ? 'bg-[#074e75] cursor-not-allowed' : 'bg-[#0e639c]'} text-white`}
            onClick={handleRestart}
            disabled={isRestarting}
            title="Reiniciar conexión Toplist"
          >{isRestarting ? 'Restarting…' : 'Restart'}</button>
          {restartStatus === 'ok' && (
            <span className="ml-2 text-green-400">Reiniciado</span>
          )}
          {restartStatus === 'error' && (
            <span className="ml-2 text-red-400">Error</span>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 p-3 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : (
          <div className={`${theme} rounded-md border flex flex-col h-full`}>
            <div className="px-2 py-1.5 border-b border-[#3e3e42] flex items-center justify-between bg-[#252526] flex-shrink-0">
              <div className="font-semibold text-[12px] tracking-wide">
                Lista Unificada
                <span className="ml-2 text-[9px] text-[#808080] font-mono">
                  (Tech: {techCountInView}, Mom: {momCountInView}, Both: {bothCountInView})
                </span>
              </div>
              <div className="text-[10px] text-[#969696]">{unified.length} stocks</div>
            </div>
            <div className="flex-1 overflow-auto">
              {unified.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[10px] text-[#969696]">Sin datos</div>
              ) : (
                <div className="p-2">
                  {(() => {
                    const headers = resolveHeaders(unified);
                    const colCount = headers.length + 2; // +1 Origin column + 1 BUY button column
                    return (
                      <>
                        <div
                          className="grid gap-1 text-[10px] text-[#969696] mb-1 sticky top-0 bg-[#252526] py-1 z-10"
                          style={{ gridTemplateColumns: `repeat(${colCount}, minmax(80px, 1fr))` }}
                        >
                          {/* Origin column at the start */}
                          <div className="text-center leading-4 px-1"><span className="truncate inline-block" title="Origen">Origen</span></div>
                          {/* Other headers */}
                          {headers.map((h, i) => (
                            <div key={i} className="text-center leading-4 px-1">
                              <span className="truncate inline-block" title={h.title}>{shortenHeaderTitle(h.title)}</span>
                            </div>
                          ))}
                          {/* BUY button column at the end */}
                          <div className="text-center leading-4 px-1"><span className="truncate inline-block" title="Action">BUY</span></div>
                        </div>
                        <div className="space-y-0.5">
                          {unified.map((row, idx) => {
                            const symbolVal = row.symbol || (Array.isArray(row.columns) ? (row.columns.find(c => c.key === 'SymbolColumn')?.value as string) : undefined);
                            const columnsByKey = new Map((row.columns || []).map(c => [c.key, c]));
                            
                            // Clean and normalize symbol (trim whitespace, uppercase)
                            const cleanSymbol = symbolVal ? String(symbolVal).trim().toUpperCase() : null;
                            const meetsTech = cleanSymbol ? meetsTechSet.has(cleanSymbol) : false;
                            const meetsMomentum = cleanSymbol ? meetsMomentumSet.has(cleanSymbol) : false;
                            const meetsAll = meetsTech && meetsMomentum;
                            
                            // Extra logging for stocks that meet momentum
                            if (cleanSymbol && meetsMomentum && idx < 20) {
                              console.log(`🔍 ${cleanSymbol}: meetsTech=${meetsTech}, meetsMomentum=${meetsMomentum}, meetsAll=${meetsAll}, will be ${meetsAll ? 'GREEN' : 'YELLOW'}`);
                            }
                            
                            // Determine row background color
                            let rowBgColor = idx % 2 === 0 ? 'bg-[#2a2a2d]' : ''; // default alternating
                            if (meetsAll) {
                              rowBgColor = 'bg-[#0d3a2e]'; // green: meets tech AND momentum
                            } else if (meetsTech) {
                              rowBgColor = 'bg-yellow-900/30'; // yellow: meets tech only
                            }
                            
                            // Debug stocks that meet momentum but showing yellow
                            if (meetsTech && meetsMomentum && !meetsAll) {
                              console.error(`❌ RENDERING BUG for ${cleanSymbol}: meetsTech=${meetsTech}, meetsMomentum=${meetsMomentum}, meetsAll=${meetsAll}`);
                            }
                            
                            // Debug specific stocks or those that should be green
                            if (cleanSymbol === 'RBNE' || cleanSymbol === 'RR' || cleanSymbol === 'ACAD' || meetsAll) {
                              console.log(`🎨 Rendering ${cleanSymbol}:`, {
                                meetsTech,
                                meetsMomentum,
                                meetsAll,
                                rowBgColor,
                                expectedColor: meetsAll ? 'GREEN' : (meetsTech ? 'YELLOW' : 'GRAY'),
                                inTechSet: cleanSymbol ? meetsTechSet.has(cleanSymbol) : false,
                                inMomentumSet: cleanSymbol ? meetsMomentumSet.has(cleanSymbol) : false
                              });
                            }
                            
                            return (
                              <div
                                key={`${symbolVal || 'row'}-${idx}`}
                                className={`grid gap-1 text-[10px] border-b border-[#3e3e42] py-0.5 ${rowBgColor} hover:bg-[#2f2f33]`}
                                style={{ gridTemplateColumns: `repeat(${colCount}, minmax(80px, 1fr))` }}
                                title={`Ver detalles de ${symbolVal || ''} - Tech: ${meetsTech ? '✓' : '✗'}, Momentum: ${meetsMomentum ? '✓' : '✗'} ${meetsAll ? '(READY TO BUY)' : ''}`}
                              >
                                {/* Origin column at the start */}
                                <div className="text-center leading-4">
                                  <span className="truncate block font-bold text-white">{row.origin}</span>
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
                                  
                                  return (
                                    <div key={i} className="text-center leading-4" onClick={() => onSymbolClick && onSymbolClick(symbolVal)}>
                                      <span className={`block font-mono text-white px-1 py-0.5 rounded ${cellColor}`} style={{ minHeight: '1.2rem' }}>{value}</span>
                                    </div>
                                  );
                                })}
                                {/* BUY button column at the end */}
                                <div className="text-center leading-4">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // TODO: Implement buy action
                                      console.log(`Buy action for ${symbolVal}`);
                                    }}
                                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded transition-colors"
                                    title={`Buy ${symbolVal}`}
                                  >
                                    BUY
                                  </button>
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


