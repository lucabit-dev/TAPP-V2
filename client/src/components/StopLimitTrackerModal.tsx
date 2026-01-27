import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

interface Step {
  pnl: number;
  stop: number;
}

interface Group {
  groupId: string;
  minPrice: number;
  maxPrice: number;
  initialStopPrice: number;
  steps: Step[];
  enabled: boolean;
}

interface StopLimitTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const StopLimitTrackerModal: React.FC<StopLimitTrackerModalProps> = ({ isOpen, onClose }) => {
  const { fetchWithAuth } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const theme = 'bg-[#14130e] text-[#eae9e9] border-[#2a2820]';

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      setSuccess(null);
      setError(null);
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/stoplimit-tracker/config`);
      const data = await response.json();
      if (data.success) {
        setGroups(data.data.length > 0 ? data.data : [createNewGroup()]);
      } else {
        setGroups([createNewGroup()]);
      }
    } catch (err) {
      console.error('Error loading StopLimit tracker config:', err);
      setGroups([createNewGroup()]);
    } finally {
      setLoading(false);
    }
  };

  const createNewGroup = (): Group => ({
    groupId: `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    minPrice: 0,
    maxPrice: 999999,
    initialStopPrice: 0,
    steps: [],
    enabled: true
  });

  const createNewStep = (): Step => ({
    pnl: 0,
    stop: 0
  });

  const addGroup = () => {
    setGroups([...groups, createNewGroup()]);
    setError(null);
    setSuccess(null);
  };

  const removeGroup = (index: number) => {
    setGroups(groups.filter((_, i) => i !== index));
    setError(null);
    setSuccess(null);
  };

  const updateGroup = (index: number, updates: Partial<Group>) => {
    const newGroups = [...groups];
    newGroups[index] = { ...newGroups[index], ...updates };
    setGroups(newGroups);
    setError(null);
    setSuccess(null);
  };

  const addStep = (groupIndex: number) => {
    const newGroups = [...groups];
    newGroups[groupIndex].steps = [...newGroups[groupIndex].steps, createNewStep()];
    setGroups(newGroups);
  };

  const removeStep = (groupIndex: number, stepIndex: number) => {
    const newGroups = [...groups];
    newGroups[groupIndex].steps = newGroups[groupIndex].steps.filter((_, i) => i !== stepIndex);
    setGroups(newGroups);
  };

  const updateStep = (groupIndex: number, stepIndex: number, updates: Partial<Step>) => {
    const newGroups = [...groups];
    newGroups[groupIndex].steps[stepIndex] = { ...newGroups[groupIndex].steps[stepIndex], ...updates };
    setGroups(newGroups);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/stoplimit-tracker/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups })
      });
      const data = await response.json();
      if (data.success) {
        setSuccess('StopLimit tracker configuration saved.');
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setError(data.error || 'Failed to save configuration');
      }
    } catch (err: any) {
      console.error('Error saving StopLimit tracker config:', err);
      setError(err.message || 'Error saving configuration');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`${theme} rounded-lg border w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl border-[#2a2820]`}>
        {/* Header – matches Config panel */}
        <div className="p-4 border-b border-[#2a2820] bg-gradient-to-r from-[#14130e] to-[#0f0e0a] flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#eae9e9] tracking-wider uppercase">StopLimit Tracker</h2>
            <p className="text-xs text-[#808080] mt-1">Configure groups by price range and P&L steps</p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-[#2a2820] hover:bg-[#3a3830] text-[#eae9e9] text-xs rounded border border-[#404040] transition-colors disabled:opacity-50 font-bold"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-[#808080] hover:text-[#eae9e9] hover:bg-[#2a2820] rounded border border-transparent hover:border-[#2a2820] transition-colors"
              title="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages – same as ManualConfigPanel */}
        {error && (
          <div className="mx-4 mt-4 p-3 bg-[#f87171]/10 border border-[#f87171]/30 rounded text-[#f87171] text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mx-4 mt-4 p-3 bg-[#22c55e]/10 border border-[#22c55e]/30 rounded text-[#22c55e] text-sm">
            {success}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4ade80]" />
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((group, groupIndex) => (
                <div key={group.groupId} className={`${theme} rounded-lg border p-4`}>
                  {/* Group header */}
                  <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#2a2820]">
                    <div className="flex items-center space-x-3">
                      <h3 className="text-sm font-bold text-[#eae9e9] uppercase tracking-wider">Group {groupIndex + 1}</h3>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={group.enabled}
                          onChange={(e) => updateGroup(groupIndex, { enabled: e.target.checked })}
                          className="w-4 h-4 rounded border-[#2a2820] bg-[#0f0e0a] text-[#4ade80] focus:ring-[#4ade80] focus:ring-offset-0 focus:ring-offset-[#14130e]"
                        />
                        <span className="text-xs text-[#808080]">Enabled</span>
                      </label>
                    </div>
                    {groups.length > 1 && (
                      <button
                        onClick={() => removeGroup(groupIndex)}
                        className="px-2 py-1 text-xs text-[#f87171] hover:text-[#fca5a5] hover:bg-[#f87171]/10 rounded border border-transparent hover:border-[#f87171]/30 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {/* Group fields – same input style as Config */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <label className="flex flex-col">
                      <span className="text-xs text-[#808080] mb-1 font-medium">Min Price ($)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={group.minPrice}
                        onChange={(e) => updateGroup(groupIndex, { minPrice: parseFloat(e.target.value) || 0 })}
                        className="px-3 py-2 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                      />
                    </label>
                    <label className="flex flex-col">
                      <span className="text-xs text-[#808080] mb-1 font-medium">Max Price ($)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={group.maxPrice}
                        onChange={(e) => updateGroup(groupIndex, { maxPrice: parseFloat(e.target.value) || 0 })}
                        className="px-3 py-2 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                      />
                    </label>
                    <label className="flex flex-col">
                      <span className="text-xs text-[#808080] mb-1 font-medium">Initial Stop Price ($)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={group.initialStopPrice}
                        onChange={(e) => updateGroup(groupIndex, { initialStopPrice: parseFloat(e.target.value) || 0 })}
                        className="px-3 py-2 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                        placeholder="0 = use default"
                      />
                    </label>
                  </div>

                  {/* Steps */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-[#808080] font-medium uppercase tracking-wider">Steps</span>
                      <button
                        onClick={() => addStep(groupIndex)}
                        className="px-2 py-1 text-xs bg-[#2a2820] hover:bg-[#3a3830] text-[#eae9e9] rounded border border-[#404040] transition-colors font-bold"
                      >
                        + Add Step
                      </button>
                    </div>
                    {group.steps.length === 0 ? (
                      <div className="text-xs text-[#808080] py-4 text-center border border-dashed border-[#2a2820] rounded">
                        No steps. Add steps to update StopLimit when P&L thresholds are reached.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {group.steps.map((step, stepIndex) => (
                          <div key={stepIndex} className="flex items-center gap-3 p-3 bg-[#0f0e0a] border border-[#2a2820] rounded">
                            <div className="flex-1 grid grid-cols-2 gap-3">
                              <label className="flex flex-col">
                                <span className="text-[10px] text-[#808080] mb-0.5 uppercase">P&L ($)</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={step.pnl}
                                  onChange={(e) => updateStep(groupIndex, stepIndex, { pnl: parseFloat(e.target.value) || 0 })}
                                  className="px-2 py-1.5 bg-[#14130e] border border-[#2a2820] rounded text-[#eae9e9] text-sm focus:outline-none focus:border-[#4ade80] transition-colors"
                                />
                              </label>
                              <label className="flex flex-col">
                                <span className="text-[10px] text-[#808080] mb-0.5 uppercase">Stop ($)</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={step.stop}
                                  onChange={(e) => updateStep(groupIndex, stepIndex, { stop: parseFloat(e.target.value) || 0 })}
                                  className="px-2 py-1.5 bg-[#14130e] border border-[#2a2820] rounded text-[#eae9e9] text-sm focus:outline-none focus:border-[#4ade80] transition-colors"
                                />
                              </label>
                            </div>
                            <button
                              onClick={() => removeStep(groupIndex, stepIndex)}
                              className="p-1.5 text-[#808080] hover:text-[#f87171] hover:bg-[#f87171]/10 rounded border border-transparent hover:border-[#f87171]/30 transition-colors"
                              title="Remove step"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <button
                onClick={addGroup}
                className="w-full px-4 py-3 bg-[#2a2820] hover:bg-[#3a3830] text-[#eae9e9] text-xs rounded border border-[#404040] transition-colors font-bold uppercase tracking-wider"
              >
                + Add Group
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StopLimitTrackerModal;
