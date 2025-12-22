import React, { useState, useEffect } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

interface PriceRange {
  minExclusive: number;
  maxInclusive: number;
}

interface Stage {
  trigger: number;
  stopOffset: number;
  label: string;
}

interface GroupConfig {
  label: string;
  priceRange: PriceRange;
  initialOffset: number;
  stages: Stage[];
  autoSellTrigger: number;
}

type GroupConfigs = Record<string, GroupConfig>;

const StopLimitConfigPanel: React.FC = () => {
  const [configs, setConfigs] = useState<GroupConfigs>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newGroupKey, setNewGroupKey] = useState('');
  const [showAddGroup, setShowAddGroup] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`${API_BASE_URL}/stoplimit/config`);
        const data = await res.json();
        if (data.success && data.data) {
          setConfigs(data.data);
        } else {
          setError(data.error || 'Failed to load StopLimit configuration');
          setConfigs({});
        }
      } catch (e: any) {
        console.error('Error fetching StopLimit config:', e);
        setError(e.message || 'Error connecting to server. Make sure the backend server is running.');
        setConfigs({});
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/stoplimit/config`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.success && data.data) {
        setConfigs(data.data);
      } else {
        setError(data.error || 'Failed to load StopLimit configuration');
        setConfigs({});
      }
    } catch (e: any) {
      console.error('Error fetching StopLimit config:', e);
      setError(e.message || 'Error connecting to server. Make sure the backend server is running.');
      setConfigs({});
    } finally {
      setLoading(false);
    }
  };

  const updateGroupConfig = async (groupKey: string, updatedConfig: Partial<GroupConfig>) => {
    const next = { ...configs };
    next[groupKey] = { ...next[groupKey], ...updatedConfig };
    setConfigs(next);
    setError(null);
    setSuccess(null);
    
    try {
      const res = await fetch(`${API_BASE_URL}/stoplimit/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupKey, config: updatedConfig })
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.success) {
        setSuccess('Configuration updated successfully');
        setConfigs(data.data);
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.error || 'Failed to update configuration');
        fetchConfigs(); // Revert on error
      }
    } catch (e: any) {
      setError(e.message || 'Error saving configuration');
      fetchConfigs(); // Revert on error
    }
  };

  const updatePriceRange = (groupKey: string, field: 'minExclusive' | 'maxInclusive', value: number) => {
    const config = configs[groupKey];
    if (!config) return;
    updateGroupConfig(groupKey, {
      priceRange: { ...config.priceRange, [field]: value }
    });
  };

  const updateStage = (groupKey: string, stageIndex: number, field: keyof Stage, value: number | string) => {
    const config = configs[groupKey];
    if (!config) return;
    const updatedStages = [...config.stages];
    updatedStages[stageIndex] = { ...updatedStages[stageIndex], [field]: value };
    updateGroupConfig(groupKey, { stages: updatedStages });
  };

  const addStage = (groupKey: string) => {
    const config = configs[groupKey];
    if (!config) return;
    const newStage: Stage = {
      trigger: 0.10,
      stopOffset: 0.05,
      label: 'New Stage'
    };
    updateGroupConfig(groupKey, {
      stages: [...config.stages, newStage]
    });
  };

  const removeStage = (groupKey: string, stageIndex: number) => {
    const config = configs[groupKey];
    if (!config || config.stages.length <= 1) return;
    const updatedStages = config.stages.filter((_, i) => i !== stageIndex);
    updateGroupConfig(groupKey, { stages: updatedStages });
  };

  const addGroup = async () => {
    if (!newGroupKey.trim() || configs[newGroupKey]) {
      setError('Group key already exists or is empty');
      return;
    }

    const newConfig: GroupConfig = {
      label: `Group ${newGroupKey}`,
      priceRange: { minExclusive: 0, maxInclusive: 100 },
      initialOffset: -0.10,
      stages: [
        { trigger: 0.05, stopOffset: -0.05, label: 'Break-even' }
      ],
      autoSellTrigger: 0.75
    };

    try {
      const res = await fetch(`${API_BASE_URL}/stoplimit/config/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupKey: newGroupKey, config: newConfig })
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.success) {
        setConfigs(data.data);
        setNewGroupKey('');
        setShowAddGroup(false);
        setSuccess('New group created successfully');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.error || 'Failed to create group');
      }
    } catch (e: any) {
      setError(e.message || 'Error creating group');
    }
  };

  const deleteGroup = async (groupKey: string) => {
    if (!confirm(`Are you sure you want to delete Group ${groupKey}?`)) return;

    try {
      const res = await fetch(`${API_BASE_URL}/stoplimit/config/group/${groupKey}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.success) {
        setConfigs(data.data);
        setSuccess('Group deleted successfully');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.error || 'Failed to delete group');
      }
    } catch (e: any) {
      setError(e.message || 'Error deleting group');
    }
  };

  const theme = 'bg-[#14130e] text-[#eae9e9] border-[#2a2820]';

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#14130e]">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-6 h-6 border-2 border-[#2a2820] border-t-[#808080] rounded-full animate-spin"></div>
          <p className="text-xs text-[#808080] uppercase tracking-wider">Loading configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9] p-4 overflow-hidden relative">
      <div className="flex justify-between items-center mb-4 border-b border-[#2a2820] pb-4">
        <div>
          <h2 className="text-xl font-bold text-[#eae9e9]">StopLimit Configuration</h2>
          <p className="text-xs text-[#808080] mt-1">Configure price groups, stages, goals, and sell prices</p>
        </div>
        <button
          onClick={() => setShowAddGroup(true)}
          className="px-4 py-2 bg-[#4ade80] hover:bg-[#22c55e] text-[#14130e] text-xs rounded border border-[#4ade80] transition-colors font-semibold"
        >
          + Add Price Group
        </button>
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

      {/* Add Group Dialog */}
      {showAddGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowAddGroup(false)}>
          <div className="bg-[#14130e] border border-[#2a2820] rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Add New Price Group</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-2">Group Key (e.g., D, E, F)</label>
                <input
                  type="text"
                  value={newGroupKey}
                  onChange={(e) => setNewGroupKey(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                  placeholder="Enter group key"
                />
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={addGroup}
                  className="flex-1 px-4 py-2 bg-[#4ade80] hover:bg-[#22c55e] text-[#14130e] text-sm rounded font-semibold"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowAddGroup(false);
                    setNewGroupKey('');
                  }}
                  className="flex-1 px-4 py-2 bg-[#2a2820] hover:bg-[#3a3830] text-[#eae9e9] text-sm rounded border border-[#404040]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto space-y-4">
        {Object.keys(configs).length === 0 ? (
          <div className="text-center py-8 text-[#808080]">
            <p>No price groups configured.</p>
            <p className="text-xs mt-2">Click "Add Price Group" to create your first group.</p>
          </div>
        ) : (
          Object.entries(configs).map(([groupKey, config]) => (
          <div key={groupKey} className={`${theme} rounded-lg border p-4`}>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-lg font-bold text-[#eae9e9]">{config.label} ({groupKey})</h3>
                <p className="text-xs text-[#808080] mt-1">
                  Price Range: ${config.priceRange.minExclusive.toFixed(2)} - ${config.priceRange.maxInclusive.toFixed(2)}
                </p>
              </div>
              <button
                onClick={() => deleteGroup(groupKey)}
                className="px-3 py-1 bg-[#f87171] hover:bg-[#ef4444] text-[#14130e] text-xs rounded font-semibold"
              >
                Delete Group
              </button>
            </div>

            {/* Group Settings */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <label className="flex flex-col">
                <span className="text-sm opacity-60 mb-1">Initial Offset</span>
                <input
                  type="number"
                  step="0.01"
                  value={config.initialOffset}
                  onChange={(e) => updateGroupConfig(groupKey, { initialOffset: parseFloat(e.target.value) })}
                  className="px-2 py-1 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                />
              </label>
              <label className="flex flex-col">
                <span className="text-sm opacity-60 mb-1">Auto Sell Trigger (%)</span>
                <input
                  type="number"
                  step="0.01"
                  value={config.autoSellTrigger}
                  onChange={(e) => updateGroupConfig(groupKey, { autoSellTrigger: parseFloat(e.target.value) })}
                  className="px-2 py-1 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                />
              </label>
              <div className="flex flex-col">
                <span className="text-sm opacity-60 mb-1">Price Range</span>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    step="0.01"
                    value={config.priceRange.minExclusive}
                    onChange={(e) => updatePriceRange(groupKey, 'minExclusive', parseFloat(e.target.value))}
                    className="flex-1 px-2 py-1 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                    placeholder="Min"
                  />
                  <span className="py-1 text-[#808080]">-</span>
                  <input
                    type="number"
                    step="0.01"
                    value={config.priceRange.maxInclusive}
                    onChange={(e) => updatePriceRange(groupKey, 'maxInclusive', parseFloat(e.target.value))}
                    className="flex-1 px-2 py-1 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                    placeholder="Max"
                  />
                </div>
              </div>
            </div>

            {/* Stages */}
            <div className="border-t border-[#2a2820] pt-4">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-sm font-semibold text-[#eae9e9]">Stages (Goals & Sell Prices)</h4>
                <button
                  onClick={() => addStage(groupKey)}
                  className="px-3 py-1 bg-[#2a2820] hover:bg-[#3a3830] text-[#eae9e9] text-xs rounded border border-[#404040] transition-colors"
                >
                  + Add Stage
                </button>
              </div>
              <div className="space-y-3">
                {config.stages.map((stage, stageIndex) => (
                  <div key={stageIndex} className="bg-[#0f0e0a] rounded border border-[#2a2820] p-3">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-semibold text-[#4ade80]">Stage {stageIndex + 1}</span>
                      {config.stages.length > 1 && (
                        <button
                          onClick={() => removeStage(groupKey, stageIndex)}
                          className="text-[#f87171] hover:text-[#ef4444] text-xs"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="flex flex-col">
                        <span className="text-xs opacity-60 mb-1">Goal/Trigger (%)</span>
                        <input
                          type="number"
                          step="0.01"
                          value={stage.trigger}
                          onChange={(e) => updateStage(groupKey, stageIndex, 'trigger', parseFloat(e.target.value))}
                          className="px-2 py-1 bg-[#14130e] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors text-sm"
                        />
                      </label>
                      <label className="flex flex-col">
                        <span className="text-xs opacity-60 mb-1">Sell Price Offset</span>
                        <input
                          type="number"
                          step="0.01"
                          value={stage.stopOffset}
                          onChange={(e) => updateStage(groupKey, stageIndex, 'stopOffset', parseFloat(e.target.value))}
                          className="px-2 py-1 bg-[#14130e] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors text-sm"
                        />
                      </label>
                      <label className="flex flex-col">
                        <span className="text-xs opacity-60 mb-1">Label</span>
                        <input
                          type="text"
                          value={stage.label}
                          onChange={(e) => updateStage(groupKey, stageIndex, 'label', e.target.value)}
                          className="px-2 py-1 bg-[#14130e] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors text-sm"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          ))
        )}
      </div>
    </div>
  );
};

export default StopLimitConfigPanel;
