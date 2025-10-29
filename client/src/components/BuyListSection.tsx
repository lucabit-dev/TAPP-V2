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
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      <div className="p-3 border-b border-[#3e3e42] bg-[#252526] flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h2 className="text-sm font-semibold text-[#cccccc] tracking-wide">Buy List</h2>
          <div className="flex items-center space-x-1 text-[11px] text-[#969696]">
            <span>Trigger:</span>
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
              className="bg-[#2d2d30] border border-[#3e3e42] rounded px-2 py-1 text-[11px] text-[#cccccc]"
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
            <input name="symbol" placeholder="Test symbol" className="px-2 py-1 text-xs bg-[#2d2d30] border border-[#3e3e42] rounded text-[#cccccc]" />
            <button type="submit" className="px-2 py-1 text-xs rounded bg-[#0e639c] text-white">Test Buy</button>
          </form>
          <div className="text-[11px] text-[#969696]">{buys.length} entries</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {buys.length === 0 ? (
          <div className="h-24 flex items-center justify-center text-[12px] text-[#969696]">No buy signals yet</div>
        ) : (
          <ul className="divide-y divide-[#3e3e42]">
            {buys.map((entry, idx) => (
              <li key={`${entry.ticker}-${entry.timestamp}-${idx}`} className={`${idx % 2 === 0 ? 'bg-[#2a2a2d]' : ''} py-2 px-2`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-[12px] font-semibold">{entry.ticker}</span>
                    {entry.group && <span className="text-[10px] text-[#808080]">({entry.group})</span>}
                  </div>
                  <div className="text-[10px] text-[#969696]">
                    {formatTimeUTC4(entry.timestamp, { includeAMPM: true, includeET: true })}
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-[#969696]">Price</span>
                  <span className="font-mono text-[#00df82]">{entry.price ? `$${entry.price.toFixed(2)}` : 'N/A'}</span>
                </div>
                {entry.notifyStatus && (
                  <div className="mt-1 flex items-center justify-between text-[10px]">
                    <span className="text-[#969696]">Webhook</span>
                    <span className="font-mono text-[#cccccc]">{entry.notifyStatus}</span>
                  </div>
                )}
                {entry.indicators && (
                  <div className="mt-2 space-y-1 border-t border-[#3e3e42] pt-2">
                    <div className="text-[10px] font-semibold text-[#808080] mb-1">Indicators at Buy:</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                      {entry.indicators.ema1m18 !== null && entry.indicators.ema1m18 !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-[#969696]">EMA 1m18:</span>
                          <span className="font-mono text-[#cccccc]">{entry.indicators.ema1m18.toFixed(4)}</span>
                        </div>
                      )}
                      {entry.indicators.ema5m18 !== null && entry.indicators.ema5m18 !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-[#969696]">EMA 5m18:</span>
                          <span className="font-mono text-[#cccccc]">{entry.indicators.ema5m18.toFixed(4)}</span>
                        </div>
                      )}
                      {entry.indicators.ema5m200 !== null && entry.indicators.ema5m200 !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-[#969696]">EMA 5m200:</span>
                          <span className="font-mono text-[#cccccc]">{entry.indicators.ema5m200.toFixed(4)}</span>
                        </div>
                      )}
                      {entry.indicators.macd1m && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-[#969696]">MACD 1m:</span>
                            <span className="font-mono text-[#cccccc]">{entry.indicators.macd1m.macd.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#969696]">Signal 1m:</span>
                            <span className="font-mono text-[#cccccc]">{entry.indicators.macd1m.signal.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#969696]">Hist 1m:</span>
                            <span className={`font-mono ${entry.indicators.macd1m.histogram >= 0 ? 'text-[#00df82]' : 'text-[#ff4444]'}`}>
                              {entry.indicators.macd1m.histogram.toFixed(4)}
                            </span>
                          </div>
                        </>
                      )}
                      {entry.indicators.macd5m && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-[#969696]">MACD 5m:</span>
                            <span className="font-mono text-[#cccccc]">{entry.indicators.macd5m.macd.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#969696]">Hist 5m:</span>
                            <span className={`font-mono ${entry.indicators.macd5m.histogram >= 0 ? 'text-[#00df82]' : 'text-[#ff4444]'}`}>
                              {entry.indicators.macd5m.histogram.toFixed(4)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {entry.momentum && (
                  <div className="mt-2 space-y-1 border-t border-[#3e3e42] pt-2">
                    <div className="text-[10px] font-semibold text-[#808080] mb-1">Momentum at Buy ({entry.momentum.groupKey}):</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                      {entry.momentum.values.change5mPct !== null && (
                        <div className="flex justify-between">
                          <span className="text-[#969696]">5m Change:</span>
                          <span className={`font-mono ${entry.momentum.values.change5mPct >= entry.momentum.thresholds.change5mPct ? 'text-[#00df82]' : 'text-[#ff4444]'}`}>
                            {entry.momentum.values.change5mPct.toFixed(2)}% {entry.momentum.values.change5mPct >= entry.momentum.thresholds.change5mPct ? '✓' : '✗'}
                          </span>
                        </div>
                      )}
                      {entry.momentum.values.trades1m !== null && (
                        <div className="flex justify-between">
                          <span className="text-[#969696]">1m Trades:</span>
                          <span className={`font-mono ${entry.momentum.values.trades1m >= entry.momentum.thresholds.trades1m ? 'text-[#00df82]' : 'text-[#ff4444]'}`}>
                            {entry.momentum.values.trades1m.toLocaleString()} {entry.momentum.values.trades1m >= entry.momentum.thresholds.trades1m ? '✓' : '✗'}
                          </span>
                        </div>
                      )}
                      {entry.momentum.values.vol5m !== null && (
                        <div className="flex justify-between">
                          <span className="text-[#969696]">5m Volume:</span>
                          <span className={`font-mono ${entry.momentum.values.vol5m >= entry.momentum.thresholds.vol5m ? 'text-[#00df82]' : 'text-[#ff4444]'}`}>
                            {(entry.momentum.values.vol5m / 1000).toFixed(0)}K {entry.momentum.values.vol5m >= entry.momentum.thresholds.vol5m ? '✓' : '✗'}
                          </span>
                        </div>
                      )}
                      {entry.momentum.values.changeFromOpenPct !== null && (
                        <div className="flex justify-between">
                          <span className="text-[#969696]">From Open:</span>
                          <span className={`font-mono ${entry.momentum.values.changeFromOpenPct >= entry.momentum.thresholds.changeFromOpenPct ? 'text-[#00df82]' : 'text-[#ff4444]'}`}>
                            {entry.momentum.values.changeFromOpenPct.toFixed(2)}% {entry.momentum.values.changeFromOpenPct >= entry.momentum.thresholds.changeFromOpenPct ? '✓' : '✗'}
                          </span>
                        </div>
                      )}
                      <div className="col-span-2 text-[9px] text-[#808080] mt-1 pt-1 border-t border-[#3e3e42]">
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


