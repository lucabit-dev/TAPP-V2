import React from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

type GroupKey = 'A' | 'B' | 'C' | 'D' | 'E';

const GROUPS: Array<{ key: GroupKey; label: string }>= [
  { key: 'A', label: 'Lista A' },
  { key: 'B', label: 'Lista B' },
  { key: 'C', label: 'Lista C' },
  { key: 'D', label: 'Lista D' },
  { key: 'E', label: 'Lista E' }
];

const FloatConfigPanel: React.FC = () => {
  const [thresholds, setThresholds] = React.useState<Record<GroupKey, any>>({} as any);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/float/thresholds`);
        const data = await res.json();
        if (data.success) setThresholds(data.data);
      } catch (e) {
        setError('No se pudieron cargar los umbrales');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const updateValue = async (group: GroupKey, field: string, value: number) => {
    const next = { ...(thresholds[group] || {}), [field]: value };
    setThresholds(prev => ({ ...prev, [group]: next }));
    try {
      await fetch(`${API_BASE_URL}/float/thresholds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupKey: group, values: { [field]: value } })
      });
    } catch {}
  };

  const resetDefaults = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/float/thresholds`);
      const data = await res.json();
      if (data.success) setThresholds(data.data);
    } catch {}
  };

  const theme = 'bg-[#252526] text-[#cccccc] border-[#3e3e42]';

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      <div className="p-4 border-b border-[#3e3e42] bg-[#252526] flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#cccccc]">Configuración de Umbrales por FLOAT</h1>
          <p className="text-sm text-[#969696] mt-1">Defina mínimos para momentum por lista</p>
        </div>
        <button className="px-3 py-1 text-xs rounded bg-[#0e639c] text-white" onClick={resetDefaults}>Restaurar</button>
      </div>
      <div className="flex-1 p-4">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : error ? (
          <div className="text-sm text-red-400">{error}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {GROUPS.map(g => {
              const t = thresholds[g.key] || {};
              return (
                <div key={g.key} className={`${theme} rounded-lg border p-3`}>
                  <div className="font-semibold mb-2">{g.label}</div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <label className="flex flex-col">
                      <span className="text-[#969696] mb-1">5 Min Change (%)</span>
                      <input type="number" step="0.01" className="px-2 py-1 bg-[#2d2d30] border border-[#3e3e42] rounded"
                        value={t.change5mPct ?? ''}
                        onChange={e => updateValue(g.key, 'change5mPct', parseFloat(e.target.value))}
                      />
                    </label>
                    <label className="flex flex-col">
                      <span className="text-[#969696] mb-1">1 Min Trade Count</span>
                      <input type="number" step="1" className="px-2 py-1 bg-[#2d2d30] border border-[#3e3e42] rounded"
                        value={t.trades1m ?? ''}
                        onChange={e => updateValue(g.key, 'trades1m', parseInt(e.target.value || '0', 10))}
                      />
                    </label>
                    <label className="flex flex-col">
                      <span className="text-[#969696] mb-1">5 Min Volume</span>
                      <input type="number" step="1000" className="px-2 py-1 bg-[#2d2d30] border border-[#3e3e42] rounded"
                        value={t.vol5m ?? ''}
                        onChange={e => updateValue(g.key, 'vol5m', parseInt(e.target.value || '0', 10))}
                      />
                    </label>
                    <label className="flex flex-col">
                      <span className="text-[#969696] mb-1">Change From Open (%)</span>
                      <input type="number" step="0.01" className="px-2 py-1 bg-[#2d2d30] border border-[#3e3e42] rounded"
                        value={t.changeFromOpenPct ?? ''}
                        onChange={e => updateValue(g.key, 'changeFromOpenPct', parseFloat(e.target.value))}
                      />
                    </label>
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

export default FloatConfigPanel;




