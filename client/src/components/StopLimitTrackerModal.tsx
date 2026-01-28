import React, { useState, useEffect } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

interface TrackerStep {
  pnl: number;
  stop: number;
}

interface TrackerGroup {
  groupId: string;
  minPrice: number;
  maxPrice: number;
  initialStopPrice: number;
  enabled: boolean;
  steps: TrackerStep[];
}

interface StopLimitTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const StopLimitTrackerModal: React.FC<StopLimitTrackerModalProps> = ({ isOpen, onClose }) => {
  const [groups, setGroups] = useState<TrackerGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState<Partial<TrackerGroup>>({
    minPrice: 0,
    maxPrice: 999999,
    initialStopPrice: -0.15,
    enabled: true,
    steps: []
  });

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
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
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

  const saveGroups = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);
      
      const res = await fetch(`${API_BASE_URL}/stoplimit-tracker/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ groups })
      });
      
      const data = await res.json();
      if (data.success) {
        setSuccess('Groups saved successfully');
        setTimeout(() => setSuccess(null), 3000);
        await fetchGroups();
      } else {
        setError(data.error || 'Failed to save groups');
      }
    } catch (e: any) {
      setError('Error saving groups');
    } finally {
      setLoading(false);
    }
  };

  const addGroup = async () => {
    if (!newGroup.minPrice || !newGroup.maxPrice || newGroup.initialStopPrice === undefined) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const res = await fetch(`${API_BASE_URL}/stoplimit-tracker/config/group`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(newGroup)
      });
      
      const data = await res.json();
      if (data.success) {
        setSuccess('Group added successfully');
        setTimeout(() => setSuccess(null), 3000);
        setNewGroup({
          minPrice: 0,
          maxPrice: 999999,
          initialStopPrice: -0.15,
          enabled: true,
          steps: []
        });
        await fetchGroups();
      } else {
        setError(data.error || 'Failed to add group');
      }
    } catch (e: any) {
      setError('Error adding group');
    } finally {
      setLoading(false);
    }
  };

  const updateGroup = (groupId: string, updates: Partial<TrackerGroup>) => {
    setGroups(prev => prev.map(g => 
      g.groupId === groupId ? { ...g, ...updates } : g
    ));
  };

  const deleteGroup = async (groupId: string) => {
    if (!confirm('Are you sure you want to delete this group?')) return;

    try {
      setLoading(true);
      setError(null);
      
      const res = await fetch(`${API_BASE_URL}/stoplimit-tracker/config/group/${groupId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });
      
      const data = await res.json();
      if (data.success) {
        setSuccess('Group deleted successfully');
        setTimeout(() => setSuccess(null), 3000);
        await fetchGroups();
      } else {
        setError(data.error || 'Failed to delete group');
      }
    } catch (e: any) {
      setError('Error deleting group');
    } finally {
      setLoading(false);
    }
  };

  const toggleGroupEnabled = (groupId: string) => {
    updateGroup(groupId, { enabled: !groups.find(g => g.groupId === groupId)?.enabled });
  };

  if (!isOpen) return null;

  const theme = 'bg-[#14130e] text-[#eae9e9] border-[#2a2820]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-[#14130e] border border-[#2a2820] rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Minimalistic style matching FloatConfigPanel */}
        <div className="p-4 border-b border-[#2a2820]/50 bg-gradient-to-r from-[#14130e] to-[#0f0e0a] flex items-center justify-between backdrop-blur-sm">
          <div>
            <h1 className="text-xl font-bold text-[#eae9e9] tracking-wider uppercase mb-1.5">StopLimit Tracker Configuration</h1>
            <p className="text-sm text-[#eae9e9]/70 mt-1">Manage price range groups and initial stop-limit offsets</p>
          </div>
          <button
            onClick={onClose}
            className="text-[#808080] hover:text-[#eae9e9] transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages */}
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
          {loading && groups.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4ade80]" />
            </div>
          ) : (
            <>
              {/* Add New Group Form - Minimalistic style */}
              <div className="mb-6 p-4 bg-[#0f0e0a] border border-[#2a2820] rounded-lg">
                <h3 className="text-sm font-semibold text-[#eae9e9] mb-3 uppercase tracking-wider">Add New Group</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <label className="flex flex-col">
                    <span className="opacity-60 mb-1 text-xs">Min Price</span>
                    <input
                      type="number"
                      step="0.01"
                      value={newGroup.minPrice || ''}
                      onChange={(e) => setNewGroup({ ...newGroup, minPrice: parseFloat(e.target.value) || 0 })}
                      className="px-2 py-1 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors text-xs"
                      placeholder="0.00"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="opacity-60 mb-1 text-xs">Max Price</span>
                    <input
                      type="number"
                      step="0.01"
                      value={newGroup.maxPrice || ''}
                      onChange={(e) => setNewGroup({ ...newGroup, maxPrice: parseFloat(e.target.value) || 999999 })}
                      className="px-2 py-1 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors text-xs"
                      placeholder="999999"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="opacity-60 mb-1 text-xs">Initial Stop Offset</span>
                    <input
                      type="number"
                      step="0.01"
                      value={newGroup.initialStopPrice || ''}
                      onChange={(e) => setNewGroup({ ...newGroup, initialStopPrice: parseFloat(e.target.value) || 0 })}
                      className="px-2 py-1 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors text-xs"
                      placeholder="-0.15"
                    />
                    <span className="text-xs opacity-60 mt-1">Buy price + offset</span>
                  </label>
                  <div className="flex items-end">
                    <button
                      onClick={addGroup}
                      disabled={loading}
                      className="w-full px-4 py-2 text-xs rounded-sm bg-[#2a2820] text-[#eae9e9] hover:bg-[#1e1d17] border border-[#2a2820]/50 transition-all font-bold disabled:opacity-50"
                    >
                      Add Group
                    </button>
                  </div>
                </div>
              </div>

              {/* Groups List - Grid layout like FloatConfigPanel */}
              {groups.length === 0 ? (
                <div className="text-center py-12 text-[#808080] text-sm">
                  No groups configured. Add a group to get started.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {groups.map((group) => (
                    <div
                      key={group.groupId}
                      className={`${theme} rounded-lg border p-3 ${!group.enabled ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-semibold text-sm text-[#eae9e9]">
                          ${group.minPrice.toFixed(2)} - ${group.maxPrice === 999999 ? '∞' : `$${group.maxPrice.toFixed(2)}`}
                        </div>
                        <button
                          onClick={() => toggleGroupEnabled(group.groupId)}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            group.enabled
                              ? 'bg-[#22c55e]/20 border-[#22c55e]/50 text-[#22c55e]'
                              : 'bg-[#808080]/20 border-[#808080]/50 text-[#808080]'
                          }`}
                        >
                          {group.enabled ? 'ON' : 'OFF'}
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <label className="flex flex-col">
                          <span className="opacity-60 mb-1">Min Price</span>
                          <input
                            type="number"
                            step="0.01"
                            value={group.minPrice}
                            onChange={(e) => updateGroup(group.groupId, { minPrice: parseFloat(e.target.value) || 0 })}
                            className="px-2 py-1 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                          />
                        </label>
                        <label className="flex flex-col">
                          <span className="opacity-60 mb-1">Max Price</span>
                          <input
                            type="number"
                            step="0.01"
                            value={group.maxPrice}
                            onChange={(e) => updateGroup(group.groupId, { maxPrice: parseFloat(e.target.value) || 999999 })}
                            className="px-2 py-1 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                          />
                        </label>
                        <label className="flex flex-col col-span-2">
                          <span className="opacity-60 mb-1">Initial Stop Offset</span>
                          <input
                            type="number"
                            step="0.01"
                            value={group.initialStopPrice}
                            onChange={(e) => updateGroup(group.groupId, { initialStopPrice: parseFloat(e.target.value) || 0 })}
                            className="px-2 py-1 bg-[#0f0e0a] border border-[#2a2820] rounded text-[#eae9e9] focus:outline-none focus:border-[#4ade80] transition-colors"
                          />
                          <span className="text-xs opacity-60 mt-1">
                            Formula: Buy Price + ({group.initialStopPrice >= 0 ? '+' : ''}{group.initialStopPrice})
                          </span>
                        </label>
                      </div>
                      
                      <div className="mt-3 pt-3 border-t border-[#2a2820] flex justify-end">
                        <button
                          onClick={() => deleteGroup(group.groupId)}
                          disabled={loading}
                          className="px-3 py-1 text-xs bg-[#f87171]/20 hover:bg-[#f87171]/30 border border-[#f87171]/50 text-[#f87171] rounded transition-colors disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer - Minimalistic */}
        <div className="p-4 border-t border-[#2a2820]/50 flex items-center justify-between bg-[#0f0e0a]">
          <div className="text-xs text-[#808080]">
            {groups.length} group{groups.length !== 1 ? 's' : ''} configured
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
              disabled={loading}
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

export default StopLimitTrackerModal;
