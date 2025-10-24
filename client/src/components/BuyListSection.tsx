import React from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';

interface BuyEntry {
  ticker: string;
  timestamp: string;
  price?: number | null;
  configId?: string | null;
  group?: string | null;
  notifyStatus?: string;
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
                  <div className="text-[10px] text-[#969696]">{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default BuyListSection;


