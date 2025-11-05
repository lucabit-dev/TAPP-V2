import React from 'react';
import { formatTimeUTC4 } from '../utils/timeFormat';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';

interface BuyEntry {
  ticker: string;
  timestamp: string;
  price?: number | null;
  configId?: string | null;
  group?: string | null;
  notifyStatus?: string;
  indicators?: {
    ema1m12?: number | null;
    ema1m18?: number | null;
    ema1m20?: number | null;
    ema1m26?: number | null;
    ema1m200?: number | null;
    ema5m12?: number | null;
    ema5m18?: number | null;
    ema5m20?: number | null;
    ema5m26?: number | null;
    ema5m200?: number | null;
    macd1m?: {
      macd: number;
      signal: number;
      histogram: number;
    } | null;
    macd5m?: {
      macd: number;
      signal: number;
      histogram: number;
    } | null;
    vwap1m?: number | null;
    lod?: number | null;
    hod?: number | null;
  } | null;
  momentum?: {
    values: {
      change5mPct: number | null;
      trades1m: number | null;
      vol5m: number | null;
      changeFromOpenPct: number | null;
    };
    thresholds: {
      change5mPct: number;
      trades1m: number;
      vol5m: number;
      changeFromOpenPct: number;
    };
    groupKey: string;
  } | null;
}

const BuyListSection: React.FC = () => {
  const [buys, setBuys] = React.useState<BuyEntry[]>([]);
  const [mode, setMode] = React.useState<'cross' | 'positive'>('cross');
  const wsRef = React.useRef<WebSocket | null>(null);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/buys`);
        const data = await res.json();
        if (data.success) setBuys(data.data || []);
        const m = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/buys/trigger-mode`);
        const md = await m.json();
        if (md.success && md.data?.mode) setMode(md.data.mode);
      } catch {}
    };
    load();

    try {
      wsRef.current = new WebSocket(WS_BASE_URL);
      wsRef.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'BUY_SIGNAL' && msg.data) {
            setBuys(prev => [msg.data as BuyEntry, ...prev]);
          }
        } catch {}
      };
    } catch {}

    return () => { if (wsRef.current) wsRef.current.close(); };
  }, []);

  return (
    <div className="h-full flex flex-col bg-[#14130e]">
      <div className="p-4 border-b border-[#2a2820]/50 bg-gradient-to-r from-[#14130e] to-[#0f0e0a] flex items-center justify-between backdrop-blur-sm">
        <div className="flex items-center space-x-4">
          <h2 className="text-sm font-bold text-[#eae9e9] tracking-wider uppercase">Buy List</h2>
          <div className="flex items-center space-x-2 text-[11px] text-[#eae9e9]/80">
            <span className="font-medium">Trigger:</span>
            <select
              value={mode}
              onChange={async (e) => {
                const newMode = e.target.value as 'cross' | 'positive';
                setMode(newMode);
                try {
                  await fetch(`${API_BASE_URL.replace(/\/$/, '')}/buys/trigger-mode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: newMode })
                  });
                } catch {}
              }}
              className="bg-[#0f0e0a] border border-[#2a2820] rounded px-2 py-1 text-[11px] text-[#eae9e9]"
            >
              <option value="cross">cross (neg → pos)</option>
              <option value="positive">positive (hist &gt; 0)</option>
            </select>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <form
            className="flex items-center space-x-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget as HTMLFormElement;
              const input = form.querySelector('input[name="symbol"]') as HTMLInputElement;
              const symbol = (input.value || '').toUpperCase().trim();
              if (!symbol) return;
              try {
                const res = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/buys/test`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ symbol })
                });
                const data = await res.json();
                if (data.success && data.data) {
                  alert(`Webhook status for ${data.data.symbol}: ${data.data.notifyStatus}`);
                } else {
                  alert('Test failed');
                }
              } catch {
                alert('Network error');
              }
            }}
          >
            <input name="symbol" placeholder="Test symbol" className="px-2 py-1 text-xs bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9]" />
            <button type="submit" className="px-2 py-1 text-xs rounded bg-[#eae9e9] text-[#14130e] hover:bg-[#d4d3d3]">Test Buy</button>
          </form>
          <div className="text-[11px] opacity-60">{buys.length} entries</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {buys.length === 0 ? (
          <div className="h-24 flex items-center justify-center text-[12px] opacity-60">No buy signals yet</div>
        ) : (
          <ul className="divide-y divide-[#2a2820]">
            {buys.map((entry, idx) => (
              <li key={`${entry.ticker}-${entry.timestamp}-${idx}`} className={`${idx % 2 === 0 ? 'bg-[#0f0e0a]' : ''} py-2 px-2 border-b border-[#2a2820]`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-[12px] font-semibold">{entry.ticker}</span>
                    {entry.group && <span className="text-[10px] opacity-60">({entry.group})</span>}
                  </div>
                  <div className="text-[10px] opacity-60">
                    {formatTimeUTC4(entry.timestamp, { includeAMPM: true, includeET: true })}
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="opacity-60">Price</span>
                  <span className="font-mono text-[#4ade80]">{entry.price ? `$${entry.price.toFixed(2)}` : 'N/A'}</span>
                </div>
                {entry.notifyStatus && (
                  <div className="mt-1 flex items-center justify-between text-[10px]">
                    <span className="opacity-60">Webhook</span>
                    <span className="font-mono text-[#eae9e9]">{entry.notifyStatus}</span>
                  </div>
                )}
                {entry.indicators && (
                  <div className="mt-2 space-y-1 border-t border-[#2a2820] pt-2">
                    <div className="text-[10px] font-semibold opacity-60 mb-1">Indicators at Buy:</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                      {entry.indicators.ema1m18 !== null && entry.indicators.ema1m18 !== undefined && (
                        <div className="flex justify-between">
                          <span className="opacity-60">EMA 1m18:</span>
                          <span className="font-mono text-[#eae9e9]">{entry.indicators.ema1m18.toFixed(4)}</span>
                        </div>
                      )}
                      {entry.indicators.ema5m18 !== null && entry.indicators.ema5m18 !== undefined && (
                        <div className="flex justify-between">
                          <span className="opacity-60">EMA 5m18:</span>
                          <span className="font-mono text-[#eae9e9]">{entry.indicators.ema5m18.toFixed(4)}</span>
                        </div>
                      )}
                      {entry.indicators.ema5m200 !== null && entry.indicators.ema5m200 !== undefined && (
                        <div className="flex justify-between">
                          <span className="opacity-60">EMA 5m200:</span>
                          <span className="font-mono text-[#eae9e9]">{entry.indicators.ema5m200.toFixed(4)}</span>
                        </div>
                      )}
                      {entry.indicators.macd1m && (
                        <>
                          <div className="flex justify-between">
                            <span className="opacity-60">MACD 1m:</span>
                            <span className="font-mono text-[#eae9e9]">{entry.indicators.macd1m.macd.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="opacity-60">Signal 1m:</span>
                            <span className="font-mono text-[#eae9e9]">{entry.indicators.macd1m.signal.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="opacity-60">Hist 1m:</span>
                            <span className={`font-mono ${entry.indicators.macd1m.histogram >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                              {entry.indicators.macd1m.histogram.toFixed(4)}
                            </span>
                          </div>
                        </>
                      )}
                      {entry.indicators.macd5m && (
                        <>
                          <div className="flex justify-between">
                            <span className="opacity-60">MACD 5m:</span>
                            <span className="font-mono text-[#eae9e9]">{entry.indicators.macd5m.macd.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="opacity-60">Hist 5m:</span>
                            <span className={`font-mono ${entry.indicators.macd5m.histogram >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                              {entry.indicators.macd5m.histogram.toFixed(4)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {entry.momentum && (
                  <div className="mt-2 space-y-1 border-t border-[#2a2820] pt-2">
                    <div className="text-[10px] font-semibold opacity-60 mb-1">Momentum at Buy ({entry.momentum.groupKey}):</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                      {entry.momentum.values.change5mPct !== null && (
                        <div className="flex justify-between">
                          <span className="opacity-60">5m Change:</span>
                          <span className={`font-mono ${entry.momentum.values.change5mPct >= entry.momentum.thresholds.change5mPct ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                            {entry.momentum.values.change5mPct.toFixed(2)}% {entry.momentum.values.change5mPct >= entry.momentum.thresholds.change5mPct ? '✓' : '✗'}
                          </span>
                        </div>
                      )}
                      {entry.momentum.values.trades1m !== null && (
                        <div className="flex justify-between">
                          <span className="opacity-60">1m Trades:</span>
                          <span className={`font-mono ${entry.momentum.values.trades1m >= entry.momentum.thresholds.trades1m ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                            {entry.momentum.values.trades1m.toLocaleString()} {entry.momentum.values.trades1m >= entry.momentum.thresholds.trades1m ? '✓' : '✗'}
                          </span>
                        </div>
                      )}
                      {entry.momentum.values.vol5m !== null && (
                        <div className="flex justify-between">
                          <span className="opacity-60">5m Volume:</span>
                          <span className={`font-mono ${entry.momentum.values.vol5m >= entry.momentum.thresholds.vol5m ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                            {(entry.momentum.values.vol5m / 1000).toFixed(0)}K {entry.momentum.values.vol5m >= entry.momentum.thresholds.vol5m ? '✓' : '✗'}
                          </span>
                        </div>
                      )}
                      {entry.momentum.values.changeFromOpenPct !== null && (
                        <div className="flex justify-between">
                          <span className="opacity-60">From Open:</span>
                          <span className={`font-mono ${entry.momentum.values.changeFromOpenPct >= entry.momentum.thresholds.changeFromOpenPct ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                            {entry.momentum.values.changeFromOpenPct.toFixed(2)}% {entry.momentum.values.changeFromOpenPct >= entry.momentum.thresholds.changeFromOpenPct ? '✓' : '✗'}
                          </span>
                        </div>
                      )}
                      <div className="col-span-2 text-[9px] opacity-60 mt-1 pt-1 border-t border-[#2a2820]">
                        Thresholds: {entry.momentum.thresholds.change5mPct}% / {entry.momentum.thresholds.trades1m} / {(entry.momentum.thresholds.vol5m / 1000).toFixed(0)}K / {entry.momentum.thresholds.changeFromOpenPct}%
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default BuyListSection;


