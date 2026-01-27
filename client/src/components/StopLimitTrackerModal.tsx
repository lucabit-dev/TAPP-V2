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

  useEffect(() => {
    if (isOpen) {
      loadConfig();
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
  };

  const removeGroup = (index: number) => {
    setGroups(groups.filter((_, i) => i !== index));
  };

  const updateGroup = (index: number, updates: Partial<Group>) => {
    const newGroups = [...groups];
    newGroups[index] = { ...newGroups[index], ...updates };
    setGroups(newGroups);
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
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/stoplimit-tracker/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups })
      });
      const data = await response.json();
      if (data.success) {
        alert('StopLimit tracker configuration saved successfully!');
        onClose();
      } else {
        alert(`Error saving configuration: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      console.error('Error saving StopLimit tracker config:', err);
      alert(`Error saving configuration: ${err.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#1e1e1e] rounded-2xl shadow-2xl border border-[#3e3e42] w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#3e3e42]">
          <div>
            <h2 className="text-2xl font-bold text-white">StopLimit Tracker Configuration</h2>
            <p className="text-sm text-[#969696] mt-1">Configure groups by price range and P&L steps</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[#969696] hover:text-white hover:bg-[#3e3e42] rounded-lg transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-[#969696]">Loading configuration...</div>
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((group, groupIndex) => (
                <div key={group.groupId} className="bg-[#252526] border border-[#3e3e42] rounded-xl p-6">
                  {/* Group Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-4">
                      <h3 className="text-lg font-semibold text-white">Group {groupIndex + 1}</h3>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={group.enabled}
                          onChange={(e) => updateGroup(groupIndex, { enabled: e.target.checked })}
                          className="w-4 h-4 rounded border-[#3e3e42] text-[#007acc] focus:ring-[#007acc]"
                        />
                        <span className="text-sm text-[#cccccc]">Enabled</span>
                      </label>
                    </div>
                    {groups.length > 1 && (
                      <button
                        onClick={() => removeGroup(groupIndex)}
                        className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors"
                      >
                        Remove Group
                      </button>
                    )}
                  </div>

                  {/* Group Fields */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-medium text-[#cccccc] mb-2">Min Price</label>
                      <input
                        type="number"
                        step="0.01"
                        value={group.minPrice}
                        onChange={(e) => updateGroup(groupIndex, { minPrice: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#3e3e42] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#007acc]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#cccccc] mb-2">Max Price</label>
                      <input
                        type="number"
                        step="0.01"
                        value={group.maxPrice}
                        onChange={(e) => updateGroup(groupIndex, { maxPrice: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#3e3e42] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#007acc]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#cccccc] mb-2">Initial Stop Price</label>
                      <input
                        type="number"
                        step="0.01"
                        value={group.initialStopPrice}
                        onChange={(e) => updateGroup(groupIndex, { initialStopPrice: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#3e3e42] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#007acc]"
                        placeholder="Override default stop_price"
                      />
                    </div>
                  </div>

                  {/* Steps */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-[#cccccc]">Steps</h4>
                      <button
                        onClick={() => addStep(groupIndex)}
                        className="px-3 py-1.5 text-sm text-[#007acc] hover:text-[#79b8ff] hover:bg-[#007acc]/10 rounded-lg transition-colors"
                      >
                        + Add Step
                      </button>
                    </div>
                    {group.steps.length === 0 ? (
                      <div className="text-sm text-[#969696] py-4 text-center border border-dashed border-[#3e3e42] rounded-lg">
                        No steps configured. Add steps to update StopLimit when P&L thresholds are reached.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {group.steps.map((step, stepIndex) => (
                          <div key={stepIndex} className="flex items-center space-x-4 p-3 bg-[#1e1e1e] border border-[#3e3e42] rounded-lg">
                            <div className="flex-1 grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-[#969696] mb-1">P&L Threshold ($)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={step.pnl}
                                  onChange={(e) => updateStep(groupIndex, stepIndex, { pnl: parseFloat(e.target.value) || 0 })}
                                  className="w-full px-3 py-2 bg-[#252526] border border-[#3e3e42] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#007acc]"
                                  placeholder="0.00"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-[#969696] mb-1">Stop Price ($)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={step.stop}
                                  onChange={(e) => updateStep(groupIndex, stepIndex, { stop: parseFloat(e.target.value) || 0 })}
                                  className="w-full px-3 py-2 bg-[#252526] border border-[#3e3e42] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#007acc]"
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                            <button
                              onClick={() => removeStep(groupIndex, stepIndex)}
                              className="px-2 py-1 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                              title="Remove step"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                className="w-full px-4 py-3 bg-[#007acc]/20 border border-[#007acc]/50 rounded-lg text-[#79b8ff] hover:bg-[#007acc]/30 transition-colors font-medium"
              >
                + Add Group
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-4 p-6 border-t border-[#3e3e42]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[#cccccc] hover:text-white hover:bg-[#3e3e42] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-[#007acc] hover:bg-[#005a9e] text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StopLimitTrackerModal;
