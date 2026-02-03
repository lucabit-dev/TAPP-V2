import React, { useState, useEffect } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

interface AdjustmentStep {
  pnl: number;
  stop: number;
  stopOffset?: number;
}

interface TrackerGroup {
  groupId: string;
  minPrice: number;
  maxPrice: number;
  initialStopPrice: number;
  enabled: boolean;
  steps: AdjustmentStep[];
}

interface StopLimitAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Stop Limit Adjustment - Configure P&L-based steps to update stop limit orders.
 * When position P&L per share reaches a step's target, the stop limit is updated
 * to lock in profits (stop = buy price + offset).
 */
const StopLimitAdjustmentModal: React.FC<StopLimitAdjustmentModalProps> = ({ isOpen, onClose }) => {
  const [groups, setGroups] = useState<TrackerGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchGroups();
    }
  }, [isOpen]);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/stoplimit-tracker/config`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const data = await res.json();
      if (data.success) {
        setGroups(data.data || []);
      } else {
        setError(data.error || 'Failed to load groups');
      }
    } catch (e: any) {
      setError('Error connecting to server');
    } finally {
      setLoading(false);
    }
  };

  const updateGroupSteps = (groupId: string, steps: AdjustmentStep[]) => {
    setGroups(prev => prev.map(g =>
      g.groupId === groupId ? { ...g, steps } : g
    ));
  };

  const addStep = (groupId: string) => {
    updateGroupSteps(groupId, [
      ...(groups.find(g => g.groupId === groupId)?.steps || []),
      { pnl: 0, stopOffset: 0 }
    ]);
  };

  const updateStep = (groupId: string, stepIndex: number, field: 'pnl' | 'stopOffset', value: number) => {
    const group = groups.find(g => g.groupId === groupId);
    if (!group) return;
    const newSteps = [...group.steps];
    if (stepIndex >= newSteps.length) return;
    newSteps[stepIndex] = { ...newSteps[stepIndex], [field]: value };
    updateGroupSteps(groupId, newSteps);
  };

  const removeStep = (groupId: string, stepIndex: number) => {
    const group = groups.find(g => g.groupId === groupId);
    if (!group) return;
    const newSteps = group.steps.filter((_, i) => i !== stepIndex);
    updateGroupSteps(groupId, newSteps);
  };

  const saveGroups = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      for (const group of groups) {
        await fetch(`${API_BASE_URL}/stoplimit-tracker/config/group/${group.groupId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            steps: group.steps.map(s => ({
              pnl: s.pnl,
              stop: s.stopOffset ?? s.stop,
              stopOffset: s.stopOffset
            }))
          })
        });
      }

      setSuccess('Adjustment steps saved successfully');
      setTimeout(() => setSuccess(null), 3000);
      await fetchGroups();
    } catch (e: any) {
      setError('Error saving adjustment steps');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const theme = 'bg-[#14130e] text-[#eae9e9] border-[#2a2820]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#14130e] border border-[#2a2820] rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[#2a2820]/50 bg-gradient-to-r from-[#14130e] to-[#0f0e0a] flex items-center justify-between backdrop-blur-sm">
          <div>
            <h1 className="text-xl font-bold text-[#eae9e9] tracking-wider uppercase mb-1.5">Stop Limit Adjustment</h1>
            <p className="text-sm text-[#eae9e9]/70 mt-1">
              Configure P&L-based steps. When position P&L per share reaches a target, the stop limit is updated to lock in profits.
            </p>
          </div>
          <button onClick={onClose} className="text-[#808080] hover:text-[#eae9e9] transition-colors p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

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

        <div className="flex-1 overflow-y-auto p-4">
          {loading && groups.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4ade80]" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-12 text-[#808080] text-sm">
              No price groups found. Configure groups in <strong>Stop Limit Tracker</strong> first.
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((group) => (
                <div
                  key={group.groupId}
                  className={`${theme} rounded-lg border p-4 ${!group.enabled ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="font-semibold text-[#eae9e9]">
                      ${group.minPrice.toFixed(2)} – ${group.maxPrice === 999999 ? '∞' : `$${group.maxPrice.toFixed(2)}`}
                    </div>
                    {!group.enabled && (
                      <span className="text-xs text-[#808080]">Group disabled</span>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#808080] uppercase tracking-wider">Adjustment Steps</span>
                      <button
                        onClick={() => addStep(group.groupId)}
                        disabled={loading || !group.enabled}
                        className="px-2 py-1 text-xs rounded bg-[#22c55e]/20 border border-[#22c55e]/50 text-[#22c55e] hover:bg-[#22c55e]/30 transition-colors disabled:opacity-50"
                      >
                        + Add Step
                      </button>
                    </div>

                    {group.steps.length === 0 ? (
                      <div className="text-sm text-[#808080] py-4 border border-dashed border-[#2a2820] rounded-lg text-center">
                        No steps. Add a step to update stop limit when P&L reaches target.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {group.steps.map((step, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-3 p-3 bg-[#0f0e0a] border border-[#2a2820] rounded-lg"
                          >
                            <span className="text-xs text-[#808080] w-8">Step {idx + 1}</span>
                            <label className="flex-1 flex flex-col">
                              <span className="text-xs opacity-60 mb-1">Target P&L ($/share)</span>
                              <input
                                type="number"
                                step="0.01"
                                placeholder="0.10"
                                value={step.pnl || ''}
                                onChange={(e) => updateStep(group.groupId, idx, 'pnl', parseFloat(e.target.value) || 0)}
                                className="px-2 py-1.5 bg-[#14130e] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] text-sm"
                              />
                              <span className="text-[10px] opacity-50 mt-0.5">When P&L per share reaches this value</span>
                            </label>
                            <label className="flex-1 flex flex-col">
                              <span className="text-xs opacity-60 mb-1">Stop Offset (from buy price)</span>
                              <input
                                type="number"
                                step="0.01"
                                placeholder="0.05"
                                value={step.stopOffset ?? step.stop ?? ''}
                                onChange={(e) => updateStep(group.groupId, idx, 'stopOffset', parseFloat(e.target.value) || 0)}
                                className="px-2 py-1.5 bg-[#14130e] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] text-sm"
                              />
                              <span className="text-[10px] opacity-50 mt-0.5">
                                Stop = Buy + ({(step.stopOffset ?? step.stop ?? 0) >= 0 ? '+' : ''}{step.stopOffset ?? step.stop ?? 0})
                              </span>
                            </label>
                            <button
                              onClick={() => removeStep(group.groupId, idx)}
                              disabled={loading}
                              className="p-2 text-[#f87171] hover:bg-[#f87171]/10 rounded transition-colors disabled:opacity-50"
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
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#2a2820]/50 flex items-center justify-between bg-[#0f0e0a]">
          <div className="text-xs text-[#808080]">
            Steps are applied in order. Higher P&L steps override lower ones when reached.
          </div>
          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs rounded-sm bg-[#2a2820] text-[#eae9e9] hover:bg-[#1e1d17] border border-[#2a2820]/50 transition-all font-bold"
            >
              Cancel
            </button>
            <button
              onClick={saveGroups}
              disabled={loading || groups.length === 0}
              className="px-4 py-2 text-xs rounded-sm bg-[#2a2820] text-[#eae9e9] hover:bg-[#1e1d17] border border-[#2a2820]/50 transition-all font-bold disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StopLimitAdjustmentModal;
