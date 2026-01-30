import React, { useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const AdminSection: React.FC = () => {
  const [password, setPassword] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<{ positionsDeleted: number; ordersDeleted: number } | null>(null);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLastResult(null);
    if (!password.trim()) {
      setError('Enter admin password');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/clear-caches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim(), clearPositions: false, clearOrders: false })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid password');
        return;
      }
      setIsUnlocked(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClearCaches = async (clearPositions: boolean, clearOrders: boolean) => {
    setError(null);
    setLastResult(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/clear-caches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: password.trim(),
          clearPositions,
          clearOrders
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to clear caches');
        return;
      }
      setLastResult(data.data || { positionsDeleted: 0, ordersDeleted: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLock = () => {
    setIsUnlocked(false);
    setPassword('');
    setError(null);
    setLastResult(null);
  };

  return (
    <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9] p-6 overflow-auto">
      <div className="max-w-lg mx-auto w-full space-y-6">
        <div className="border border-[#2a2820] rounded-lg bg-[#0f0e0a] p-6">
          <h2 className="text-lg font-semibold text-[#eae9e9] mb-1 uppercase tracking-wider">Admin</h2>
          <p className="text-xs text-[#969696] mb-6">Clear MongoDB position and order cache collections.</p>

          {!isUnlocked ? (
            <form onSubmit={handleUnlock} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#969696] uppercase tracking-wider mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Admin password"
                  className="w-full px-4 py-3 bg-[#14130e] border border-[#2a2820] rounded-lg text-[#eae9e9] placeholder-[#808080] focus:outline-none focus:ring-2 focus:ring-[#22c55e]/50 focus:border-[#22c55e]/50"
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <div className="text-sm text-[#f87171] flex items-center gap-2">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-[#22c55e]/20 border border-[#22c55e]/50 text-[#22c55e] rounded-lg font-medium hover:bg-[#22c55e]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Checking...' : 'Unlock'}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-[#4ec9b0] mb-4">
                <span>Unlocked</span>
                <button
                  type="button"
                  onClick={handleLock}
                  className="text-[#969696] hover:text-[#eae9e9] transition-colors"
                >
                  Lock
                </button>
              </div>
              {error && (
                <div className="text-sm text-[#f87171] flex items-center gap-2">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </div>
              )}
              {lastResult && (
                <div className="text-sm text-[#4ec9b0] bg-[#0d3a2e]/30 border border-[#22c55e]/30 rounded-lg p-3">
                  Cleared: {lastResult.positionsDeleted} position(s), {lastResult.ordersDeleted} order(s).
                </div>
              )}
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => handleClearCaches(true, false)}
                  disabled={loading}
                  className="py-3 px-4 bg-[#2a2820] border border-[#3e3e42] text-[#eae9e9] rounded-lg font-medium hover:border-[#22c55e]/50 hover:bg-[#22c55e]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Clear positions cache (MongoDB)
                </button>
                <button
                  type="button"
                  onClick={() => handleClearCaches(false, true)}
                  disabled={loading}
                  className="py-3 px-4 bg-[#2a2820] border border-[#3e3e42] text-[#eae9e9] rounded-lg font-medium hover:border-[#22c55e]/50 hover:bg-[#22c55e]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Clear orders cache (MongoDB)
                </button>
                <button
                  type="button"
                  onClick={() => handleClearCaches(true, true)}
                  disabled={loading}
                  className="py-3 px-4 bg-[#22c55e]/20 border border-[#22c55e]/50 text-[#22c55e] rounded-lg font-medium hover:bg-[#22c55e]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Clear all (positions + orders)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminSection;
