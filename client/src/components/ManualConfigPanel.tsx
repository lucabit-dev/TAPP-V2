import React, { useState, useEffect } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const WEIGHT_LABELS: Record<string, string> = {
  distVwap: 'Distance VWAP',
  change2m: '2 min Change',
  change5m: '5 min Change',
  trades1m: '1 min Trades',
  trades2m: '2 min Trades',
  vol1m: '1 min Volume',
  vol2m: '2 min Volume',
  changeOpen: 'Change from Open',
  cons1m: 'Consolidation 1m',
  dailyVol: 'Daily Volume'
};

const ManualConfigPanel: React.FC = () => {
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchWeights();
  }, []);

  const fetchWeights = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/manual/weights`);
      const data = await res.json();
      if (data.success) {
        // Convert 0-1 to 0-100 for display
        const displayWeights: Record<string, number> = {};
        for (const [key, val] of Object.entries(data.data)) {
          displayWeights[key] = Math.round((val as number) * 100);
        }
        setWeights(displayWeights);
      } else {
        setError('Failed to load weights');
      }
    } catch (e) {
      setError('Error connecting to server');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (key: string, value: string) => {
    const num = parseInt(value) || 0;
    setWeights(prev => ({ ...prev, [key]: num }));
    setError(null);
    setSuccess(null);
  };

  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  const save = async () => {
    if (Math.abs(total - 100) > 0.1) {
      setError(`Total must be 100% (currently ${total}%)`);
      return;
    }

    try {
      setLoading(true);
      setSuccess(null);
      setError(null);
      
      const res = await fetch(`${API_BASE_URL}/manual/weights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights }) // Sending 0-100 values
      });
      const data = await res.json();
      if (data.success) {
        setSuccess('Weights updated successfully');
        // Update local state with returned data (converting back to 0-100)
         const displayWeights: Record<string, number> = {};
        for (const [key, val] of Object.entries(data.data)) {
          displayWeights[key] = Math.round((val as number) * 100);
        }
        setWeights(displayWeights);
      } else {
        setError(data.error || 'Failed to update weights');
      }
    } catch (e) {
      setError('Error saving weights');
    } finally {
      setLoading(false);
    }
  };

  const theme = 'bg-[#14130e] text-[#eae9e9] border-[#2a2820]';

  return (
    <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9] p-4 overflow-hidden relative">
      <div className="flex justify-between items-center mb-4 border-b border-[#2a2820] pb-4">
        <div>
          <h2 className="text-xl font-bold text-[#eae9e9]">MANUAL Scoring Configuration</h2>
          <p className="text-xs text-[#808080] mt-1">Adjust weights for ranking algorithm</p>
        </div>
        <div className="flex items-center space-x-4">
           <div className={`text-sm font-bold ${Math.abs(total - 100) <= 0.1 ? 'text-[#22c55e]' : 'text-[#f87171]'}`}>
             Total: {total}%
           </div>
           <button 
             onClick={save}
             disabled={loading}
             className="px-4 py-2 bg-[#2a2820] hover:bg-[#3a3830] text-[#eae9e9] text-xs rounded border border-[#404040] transition-colors disabled:opacity-50"
           >
             {loading ? 'Saving...' : 'Save Changes'}
           </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-[#f87171]/10 border border-[#f87171]/30 rounded text-[#f87171] text-sm">
          {error}
        </div>
      )}
      
      {success && (
        <div className="mb-4 p-3 bg-[#22c55e]/10 border border-[#22c55e]/30 rounded text-[#22c55e] text-sm">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-auto">
        {Object.entries(weights).map(([key, val]) => (
          <div key={key} className={`${theme} rounded-lg border p-4`}>
            <label className="flex flex-col space-y-2">
              <span className="text-sm font-medium text-[#eae9e9]">{WEIGHT_LABELS[key] || key}</span>
              <div className="flex items-center space-x-2">
                <input 
                  type="number" 
                  min="0" 
                  max="100" 
                  value={val}
                  onChange={(e) => handleChange(key, e.target.value)}
                  className="flex-1 px-3 py-2 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                />
                <span className="text-[#808080]">%</span>
              </div>
              <div className="w-full bg-[#2a2820] h-1.5 rounded-full overflow-hidden mt-2">
                <div 
                  className={`h-full transition-all duration-300 ${Math.abs(total - 100) <= 0.1 ? 'bg-[#4ade80]' : 'bg-[#f87171]'}`}
                  style={{ width: `${Math.min(val, 100)}%` }}
                ></div>
              </div>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ManualConfigPanel;
