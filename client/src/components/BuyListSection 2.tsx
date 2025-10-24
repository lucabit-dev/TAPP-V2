import React from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';

interface BuyEntry {
  ticker: string;
  timestamp: string;
  macd1mHistogram: number;
  price?: number | null;
  floatGroup?: { key: string; name: string; range: string } | null;
}

interface Props {
  onSymbolClick?: (symbol: string | null | undefined) => void;
}

const BuyListSection: React.FC<Props> = ({ onSymbolClick }) => {
  const [entries, setEntries] = React.useState<BuyEntry[]>([]);
  const [isConnected, setIsConnected] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const wsRef = React.useRef<WebSocket | null>(null);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/buy-list`);
        const data = await res.json();
        if (data.success) setEntries(data.data || []);
      } finally {
        setLoading(false);
      }
    };
    load();

    try {
      wsRef.current = new WebSocket(WS_BASE_URL);
      wsRef.current.onopen = () => setIsConnected(true);
      wsRef.current.onclose = () => setIsConnected(false);
      wsRef.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'BUY_LIST_UPDATE' && msg.data) {
            const { list } = msg.data;
            if (Array.isArray(list)) setEntries(list);
          }
        } catch {}
      };
    } catch {}

    return () => { if (wsRef.current) wsRef.current.close(); };
  }, []);

  const theme = 'bg-[#252526] text-[#cccccc] border-[#3e3e42]';

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      <div className="p-3 border-b border-[#3e3e42] bg-[#252526] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#cccccc] tracking-wide">Buy list</h2>
          <p className="text-[11px] text-[#808080] mt-0.5">Señales al cruzar MACD 1m histograma &gt; 0</p>
        </div>
        <div className="text-[11px] text-[#969696] flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span>{isConnected ? 'En vivo' : 'Desconectado'}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : entries.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[12px] text-[#969696]">Sin señales</div>
        ) : (
          <div className={`${theme} rounded-md border overflow-hidden flex flex-col min-h-0`}>
            <div className="px-3 py-2 border-b border-[#3e3e42] grid grid-cols-5 text-[11px] text-[#969696]">
              <div>Hora</div>
              <div>Símbolo</div>
              <div>Precio</div>
              <div>MACD1m Hist</div>
              <div>Grupo FLOAT</div>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <ul>
                {entries.map((e, idx) => (
                  <li
                    key={`${e.ticker}-${e.timestamp}-${idx}`}
                    className={`grid grid-cols-5 px-3 py-1 text-[12px] ${idx % 2 === 0 ? 'bg-[#2a2a2d]' : ''} hover:bg-[#2f2f33] cursor-pointer`}
                    onClick={() => onSymbolClick && onSymbolClick(e.ticker)}
                    title={`Ver detalles de ${e.ticker}`}
                  >
                    <div className="text-[#969696]">{formatTime(e.timestamp)}</div>
                    <div className="font-medium">{e.ticker}</div>
                    <div className="font-mono">{e.price ? `$${e.price.toFixed(2)}` : '—'}</div>
                    <div className={`font-mono ${e.macd1mHistogram > 0 ? 'text-[#00df82]' : 'text-[#f44747]'}`}>{e.macd1mHistogram.toFixed(4)}</div>
                    <div className="text-[#969696]">{e.floatGroup?.key || '—'}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BuyListSection;


