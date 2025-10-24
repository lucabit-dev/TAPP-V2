import React from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';

interface ToplistColumn { key: string; value: string; text_color: string; color: string; }
interface ToplistRow { color: string; symbol: string; columns: ToplistColumn[]; }

const LISTS: Array<{ id: string; label: string }>= [
  { id: '68ecefc9420a933c6c60a971', label: 'Lista A' },
  { id: '68ecefcb420a933c6c60a997', label: 'Lista B' },
  { id: '68ecefcd420a933c6c60aaaa', label: 'Lista C' },
  { id: '68ecefce420a933c6c60aabb', label: 'Lista D' },
  { id: '68eceff9420a933c6c60b6eb', label: 'Lista E' }
];

interface Props {
  onSymbolClick?: (symbol: string | null | undefined) => void;
}

const FloatListsSection: React.FC<Props> = ({ onSymbolClick }) => {
  const [validated, setValidated] = React.useState<Record<string, any[]>>({});
  const [toplist, setToplist] = React.useState<Record<string, ToplistRow[]>>({});
  const [loading, setLoading] = React.useState(true);
  const [connectionStatus, setConnectionStatus] = React.useState<'checking' | 'connected' | 'disconnected'>('checking');
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const [buysEnabled, setBuysEnabled] = React.useState<boolean>(true);
  const [isTogglingBuys, setIsTogglingBuys] = React.useState<boolean>(false);

  React.useEffect(() => {
    const load = async () => {
      try {
        const [vRes, tRes, bRes] = await Promise.all([
          fetch(`${API_BASE_URL}/float/validated`),
          fetch(`${API_BASE_URL}/toplist`),
          fetch(`${API_BASE_URL}/buys/enabled`)
        ]);
        const [vData, tData, bData] = await Promise.all([vRes.json(), tRes.json(), bRes.json()]);
        if (vData.success) setValidated(vData.data || {});
        if (tData.success) setToplist(tData.data || {});
        if (bData.success) setBuysEnabled(Boolean(bData.data?.enabled));
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
            if (msg.type === 'FLOAT_LIST_VALIDATED' && msg.data) {
              const { config_id, results } = msg.data;
              setValidated(prev => ({ ...prev, [config_id]: results || [] }));
            } else if (msg.type === 'TOPLIST_UPDATE' && msg.data && msg.data.config_id) {
              const { config_id, rows } = msg.data;
              setToplist(prev => ({ ...prev, [config_id]: rows || [] }));
            } else if (msg.type === 'BUY_SIGNAL' && msg.data) {
              const { configId, ticker, price } = msg.data;
              if (configId && ticker) {
                setValidated(prev => {
                  const list = prev[configId] || [];
                  const exists = list.some(it => (it?.ticker || '').toUpperCase() === (ticker || '').toUpperCase());
                  if (exists) return prev;
                  const next = [{ ticker, price: price ?? null }, ...list];
                  return { ...prev, [configId]: next };
                });
              }
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
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const theme = 'bg-[#252526] text-[#cccccc] border-[#3e3e42]';
  const toggleBuys = async () => {
    if (isTogglingBuys) return;
    setIsTogglingBuys(true);
    try {
      const next = !buysEnabled;
      const resp = await fetch(`${API_BASE_URL}/buys/enabled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.success) {
        setBuysEnabled(Boolean(data.data?.enabled));
      }
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
          <h2 className="text-sm font-semibold text-[#cccccc] tracking-wide">Listas por FLOAT</h2>
          <p className="text-[11px] text-[#808080] mt-0.5">Stocks que pasan filtros técnicos y momentum</p>
        </div>
        <div className="text-[11px] text-[#969696] flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' : (connectionStatus === 'checking' ? 'bg-yellow-500' : 'bg-red-500')}`}></div>
          <span>{connectionStatus === 'connected' ? 'En vivo' : (connectionStatus === 'checking' ? 'Checking' : 'Desconectado')}</span>
          <button
            className={`ml-2 px-2 py-0.5 rounded ${isTogglingBuys ? 'bg-[#5a5a5a] cursor-not-allowed' : (buysEnabled ? 'bg-green-600' : 'bg-red-600')} text-white`}
            onClick={toggleBuys}
            disabled={isTogglingBuys}
            title={buysEnabled ? 'Disable buys' : 'Enable buys'}
          >{isTogglingBuys ? '...' : (buysEnabled ? 'Buys: ON' : 'Buys: OFF')}</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-3 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : (
          <div className="h-full min-h-0 grid grid-rows-5 gap-2">
            {LISTS.map(list => {
              const items = validated[list.id] || [];
              return (
                <div key={list.id} className={`${theme} rounded-md border overflow-hidden flex flex-col min-h-0`}>
                  <div className="px-2 py-1.5 border-b border-[#3e3e42] flex items-center justify-between sticky top-0 bg-[#252526] z-10">
                    <div className="font-semibold text-[12px] tracking-wide">{list.label}</div>
                    <div className="text-[10px] text-[#969696]">{items.length}</div>
                  </div>
                  <div className="flex-1 overflow-y-auto overscroll-contain">
                    {items.length === 0 ? (
                      <div className="h-16 flex items-center justify-center text-[10px] text-[#969696]">Sin coincidencias</div>
                    ) : (
                      <div className="p-2 overflow-x-auto">
                        {(() => {
                          const rows = toplist[list.id] || [];
                          const headers = resolveHeaders(rows);
                          const colCount = headers.length || 1;
                          if (headers.length === 0) {
                            return (
                              <div className="text-[10px] text-[#969696]">Esperando columnas de ChartsWatcher…</div>
                            );
                          }
                          const rowsBySymbol = new Map<string, ToplistRow>();
                          rows.forEach(r => {
                            const sym = (r.symbol || (Array.isArray(r.columns) ? (r.columns.find(c => c.key === 'SymbolColumn')?.value as string) : undefined))?.toUpperCase();
                            if (sym) rowsBySymbol.set(sym, r);
                          });
                          return (
                            <>
                              <div
                                className="grid gap-1 text-[10px] text-[#969696] mb-1 min-w-max"
                                style={{ gridTemplateColumns: `repeat(${colCount}, minmax(80px, 1fr))` }}
                              >
                                {headers.map((h, i) => (
                                  <div key={i} className="text-center leading-4 px-1">
                                    <span className="truncate inline-block" title={h.title}>{shortenHeaderTitle(h.title)}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="space-y-0.5 min-w-max">
                                {items.slice(0, 120).map((it, idx) => {
                                  const symbolVal: string | undefined = (it.ticker || '').toUpperCase();
                                  const baseRow = symbolVal ? rowsBySymbol.get(symbolVal) : undefined;
                                  const columnsByKey = new Map<string, ToplistColumn>((baseRow?.columns || []).map(c => [c.key, c]));
                                  return (
                                    <div
                                      key={`${symbolVal || 'row'}-${idx}`}
                                      className={`grid gap-1 text-[10px] border-b border-[#3e3e42] py-0.5 ${idx % 2 === 0 ? 'bg-[#2a2a2d]' : ''} hover:bg-[#2f2f33] cursor-pointer`}
                                      style={{ gridTemplateColumns: `repeat(${colCount}, minmax(80px, 1fr))` }}
                                      onClick={() => onSymbolClick && onSymbolClick(symbolVal)}
                                      title={`Ver detalles de ${symbolVal || ''}`}
                                    >
                                      {headers.map((h, i) => {
                                        const c = h.key ? columnsByKey.get(h.key) : undefined;
                                        const value = c?.value ?? '—';
                                        return (
                                          <div key={i} className="text-center leading-4">
                                            <span className="truncate block font-mono text-white">{value}</span>
                                          </div>
                                        );
                                      })}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FloatListsSection;


