import React from 'react';
import { useAuth } from '../auth/AuthContext';

interface StopLimitSnapshot {
  symbol: string;
  groupKey: string;
  groupLabel: string;
  avgPrice: number;
  quantity: number;
  stageIndex: number;
  stageLabel: string;
  stageDescription: string;
  nextTrigger: number | null;
  nextStageLabel: string | null;
  nextStageDescription: string | null;
  stopPrice: number | null;
  limitPrice: number | null;
  orderId: string | null;
  orderStatus: string | null;
  unrealizedQty: number | null;
  autoSellTrigger: number | null;
  progress: number | null;
  status: string;
  statusLabel: string;
  pendingCreate: boolean;
  pendingUpdate: boolean;
  autoSellExecuted: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  // Sold position fields
  sellPrice?: number;
  pnlPerShare?: number;
  totalPnL?: number;
  soldAt?: number;
}

interface WebSocketDiagnostics {
  connected: boolean;
  readyState: string;
  lastMessageAt: number | null;
  lastConnectAttempt: number | null;
  reconnectAttempts: number;
  staleForMs: number | null;
  lastError: string | null;
}

interface StopLimitTrackedSymbolDiagnostics {
  symbol: string;
  groupKey: string;
  stageIndex: number;
  avgPrice: number;
  quantity: number;
  positionQty: number | null;
  orderId: string | null;
  orderStatus: string | null;
  pendingCreate: boolean;
  pendingUpdate: boolean;
  autoSellExecuted: boolean;
  lastUpdated: number | null;
  issues: string[];
}

interface StopLimitServiceDiagnostics {
  timestamp: number;
  trackedCount: number;
  soldCount: number;
  positionsCacheSize: number;
  ordersCacheSize: number;
  trackedSymbols: StopLimitTrackedSymbolDiagnostics[];
  issues: { symbol: string; type: string; orderId: string | null }[];
}

interface StopLimitDiagnostics {
  timestamp: number;
  positionsWs: WebSocketDiagnostics | null;
  ordersWs: WebSocketDiagnostics | null;
  caches: {
    positions: number;
    orders: number;
  };
  service: StopLimitServiceDiagnostics | null;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const statusStyles: Record<string, string> = {
  active: 'bg-[#1e3a2e] text-[#4ade80] border border-[#4ade80]/30',
  'creating-order': 'bg-[#3a2e1e] text-[#facc15] border border-[#facc15]/30',
  'updating-order': 'bg-[#1e313a] text-[#38bdf8] border border-[#38bdf8]/30',
  queued: 'bg-[#312f20] text-[#fde68a] border border-[#fde68a]/30',
  'awaiting-stoplimit': 'bg-[#332f1f] text-[#fde68a] border border-[#fde68a]/30',
  'awaiting-ack': 'bg-[#2f1f33] text-[#e879f9] border border-[#e879f9]/30',
  'auto-sell-executed': 'bg-[#3a1e1e] text-[#f87171] border border-[#f87171]/30',
  'analysis-disabled': 'bg-[#3a1e1e] text-[#f87171] border border-[#f87171]/40',
  sold: 'bg-[#1e3a2e] text-[#4ade80] border border-[#4ade80]/50'
};

const statusDot: Record<string, string> = {
  active: 'bg-[#4ade80]',
  'creating-order': 'bg-[#facc15]',
  'updating-order': 'bg-[#38bdf8]',
  queued: 'bg-[#fde68a]',
  'awaiting-stoplimit': 'bg-[#fde68a]',
  'awaiting-ack': 'bg-[#e879f9]',
  'auto-sell-executed': 'bg-[#f87171]',
  'analysis-disabled': 'bg-[#f87171]',
  sold: 'bg-[#4ade80]'
};

const StopLimitSection: React.FC = () => {
  const { fetchWithAuth } = useAuth();
  const [rows, setRows] = React.useState<StopLimitSnapshot[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [analysisEnabled, setAnalysisEnabled] = React.useState<boolean>(true);
  const [analysisChangedAt, setAnalysisChangedAt] = React.useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null);
  const [diagnostics, setDiagnostics] = React.useState<StopLimitDiagnostics | null>(null);
  const [isTogglingAutomation, setIsTogglingAutomation] = React.useState<boolean>(false);
  const [isEnabled, setIsEnabled] = React.useState<boolean>(false); // Default to disabled as per requirements
  const refreshIntervalRef = React.useRef<number | null>(null);

  const fetchStatus = React.useCallback(async () => {
    if (!isEnabled) return;
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/stoplimit/status`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to load StopLimit status');
      }

      setRows(Array.isArray(data.data) ? data.data : []);
      setAnalysisEnabled(data.analysisEnabled !== false);
      setAnalysisChangedAt(typeof data.analysisChangedAt === 'number' ? data.analysisChangedAt : null);
      setDiagnostics(data.diagnostics || null);
      setError(null);
      setLastUpdated(Date.now());
    } catch (err: any) {
      setError(err.message || 'Failed to load StopLimit status');
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, isEnabled]);

  React.useEffect(() => {
    if (!isEnabled) {
      setLoading(false);
      setRows([]);
      return;
    }
    setLoading(true);
    fetchStatus();
  }, [fetchStatus, isEnabled]);

  React.useEffect(() => {
    if (!isEnabled) {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }

    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }

    refreshIntervalRef.current = window.setInterval(() => {
      fetchStatus();
    }, 4000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [fetchStatus, isEnabled]);

  const toggleAutomation = React.useCallback(async () => {
    if (isTogglingAutomation) return;
    setIsTogglingAutomation(true);
    setError(null);

    try {
      const target = !analysisEnabled;
      const response = await fetchWithAuth(`${API_BASE_URL}/stoplimit/analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: target })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      setAnalysisEnabled(data.analysisEnabled !== false);
      setAnalysisChangedAt(
        typeof data.analysisChangedAt === 'number' ? data.analysisChangedAt : Date.now()
      );
      await fetchStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to update StopLimit automation');
    } finally {
      setIsTogglingAutomation(false);
    }
  }, [analysisEnabled, fetchStatus, fetchWithAuth, isTogglingAutomation]);

  const summary = React.useMemo(() => {
    const total = rows.length;
    const active = analysisEnabled ? rows.filter(row => row.status === 'active').length : 0;
    const pending = analysisEnabled
      ? rows.filter(row =>
          row.status === 'creating-order' ||
          row.status === 'awaiting-stoplimit' ||
          row.status === 'awaiting-ack' ||
          row.status === 'updating-order' ||
          row.status === 'queued'
        ).length
      : 0;
    const autoSold = rows.filter(row => row.autoSellExecuted || row.status === 'auto-sell-executed').length;

    const groupCounts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.groupLabel] = (acc[row.groupLabel] || 0) + 1;
      return acc;
    }, {});

    return { total, active, pending, autoSold, groupCounts };
  }, [rows, analysisEnabled]);

  const formatCurrency = (value: number | null) => {
    if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
    return `$${value.toFixed(2)}`;
  };

  const formatOffset = (value: number | null) => {
    if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
  };

  const formatNumber = (value: number | null, decimals = 2) => {
    if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
    return value.toFixed(decimals);
  };

  const formatRelativeTime = (timestamp: number | null) => {
    if (!timestamp) return 'N/A';
    const diff = Date.now() - timestamp;
    if (diff < 0) return 'Just now';
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const describeOrderStatus = (status: string | null) => {
    if (!status) return null;
    const upper = status.toUpperCase();
    switch (upper) {
      case 'DON':
        return 'Queued (DON – awaiting market hours)';
      case 'QUE':
      case 'QUEUED':
        return 'Queued';
      case 'ACK':
        return 'Received (ACK)';
      case 'REC':
        return 'Received (REC)';
      case 'OUT':
        return 'Cancelled (OUT)';
      case 'REJ':
        return 'Rejected (REJ)';
      case 'FLL':
      case 'FIL':
        return 'Filled';
      default:
        return upper;
    }
  };

  const renderWsCard = (title: string, wsDiag: WebSocketDiagnostics | null, cacheSize?: number) => {
    const connected = !!wsDiag?.connected;
    const statusClass = connected ? 'text-[#4ade80]' : 'text-[#f87171]';
    const lastUpdateLabel = wsDiag?.lastMessageAt ? `${formatRelativeTime(wsDiag.lastMessageAt)} (${formatTimestamp(wsDiag.lastMessageAt)})` : 'N/A';
    const staleSeconds = wsDiag?.staleForMs ? Math.round(wsDiag.staleForMs / 1000) : null;

    return (
      <div className="rounded-lg border border-[#2a2820]/60 bg-[#1b1910] p-3 space-y-1.5" key={title}>
        <div className="text-[11px] uppercase tracking-wide text-[#eae9e9]/60">{title}</div>
        <div className={`text-sm font-semibold ${statusClass}`}>
          {connected ? 'Connected' : 'Disconnected'}
          {wsDiag?.readyState ? ` (${wsDiag.readyState})` : ''}
        </div>
        <div className="text-[11px] text-[#eae9e9]/60">Last update: {lastUpdateLabel}</div>
        <div className="text-[11px] text-[#eae9e9]/60">Reconnects: {wsDiag?.reconnectAttempts ?? 0}</div>
        <div className="text-[11px] text-[#eae9e9]/60">Cache size: {cacheSize ?? 0}</div>
        {staleSeconds !== null && staleSeconds > 15 && (
          <div className="text-[11px] text-[#facc15]">Stale for {staleSeconds}s</div>
        )}
        {wsDiag?.lastError && (
          <div className="text-[11px] text-[#fbbf24] truncate" title={wsDiag.lastError}>
            Last error: {wsDiag.lastError}
          </div>
        )}
      </div>
    );
  };

  const automationStatusClass = analysisEnabled ? 'text-[#4ade80]' : 'text-[#f87171]';
  const automationButtonClass = analysisEnabled
    ? 'bg-[#1e3a2e] text-[#4ade80] border border-[#4ade80]/30 hover:bg-[#1e3a2e]/80'
    : 'bg-[#3a1e1e] text-[#f87171] border border-[#f87171]/40 hover:bg-[#3a1e1e]/80';
  const automationButtonLabel = isTogglingAutomation
    ? 'Updating...'
    : `Auto ${analysisEnabled ? 'ON' : 'OFF'}`;

  return (
    <div className="h-full flex flex-col bg-[#14130e]">
      <div className="p-4 border-b border-[#2a2820]/60 bg-gradient-to-r from-[#14130e] to-[#0f0e0a]">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-3 lg:space-y-0">
          <div>
            <h2 className="text-sm font-bold text-[#eae9e9] tracking-wider uppercase">Stop Limit Automation</h2>
            <p className="text-xs text-[#eae9e9]/60 mt-1">
              Live overview of automated StopLimit management for active positions
            </p>
          </div>
          <div className="flex flex-col items-start lg:items-end space-y-2">
            <div className="flex items-center space-x-3">
              <button
                className={`px-3 py-1 rounded-sm text-[11px] font-bold transition-all ${
                  isEnabled 
                    ? 'bg-[#22c55e] text-[#14130e] hover:bg-[#16a34a] shadow-[0_0_8px_rgba(34,197,94,0.3)]' 
                    : 'bg-[#2a2820] text-[#eae9e9] hover:bg-[#3e3e42] border border-[#3e3e42]'
                }`}
                onClick={() => setIsEnabled(!isEnabled)}
                title={isEnabled ? 'Disable StopLimit Monitor' : 'Enable StopLimit Monitor'}
              >
                {isEnabled ? 'ON' : 'OFF'}
              </button>
              
              {isEnabled && (
                <>
                  <div className="text-[11px] text-[#eae9e9]/60">
                    Last update: {lastUpdated ? `${formatRelativeTime(lastUpdated)} (${formatTimestamp(lastUpdated)})` : 'N/A'}
                  </div>
                  <div className={`text-[11px] font-semibold ${automationStatusClass}`}>
                    Automation {analysisEnabled ? 'Enabled' : 'Disabled'}
                    {analysisChangedAt ? ` • ${formatRelativeTime(analysisChangedAt)} (${formatTimestamp(analysisChangedAt)})` : ''}
                  </div>
                  <button
                    onClick={() => fetchStatus()}
                    className="px-3 py-1.5 text-xs font-semibold rounded border border-[#2a2820] text-[#eae9e9]/80 hover:text-[#eae9e9] hover:border-[#eae9e9]/30 transition-colors"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={toggleAutomation}
                    disabled={isTogglingAutomation}
                    className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${automationButtonClass} ${isTogglingAutomation ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {automationButtonLabel}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {!isEnabled ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-[#808080] text-sm mb-2 uppercase tracking-wider">Stop Limit Monitor Disabled</div>
            <p className="text-[#eae9e9]/40 text-xs">Click ON to enable monitoring</p>
          </div>
        </div>
      ) : (
        <>
          {!analysisEnabled && (
            <div className="px-4 py-2 bg-[#3a1e1e] border-b border-[#f87171]/40 text-[#f87171] text-xs">
              StopLimit automation is disabled. Orders will not be created or updated automatically while AUTO is OFF.
            </div>
          )}

          {diagnostics && (
            <div className="px-4 py-3 border-b border-[#2a2820]/40 bg-[#15130d]">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {renderWsCard('Positions WebSocket', diagnostics.positionsWs, diagnostics.caches?.positions)}
                {renderWsCard('Orders WebSocket', diagnostics.ordersWs, diagnostics.caches?.orders)}
                <div className="rounded-lg border border-[#2a2820]/60 bg-[#1b1910] p-3 space-y-1.5">
                  <div className="text-[11px] uppercase tracking-wide text-[#eae9e9]/60">StopLimit Tracker</div>
                  <div className="text-sm font-semibold text-[#eae9e9]">
                    {diagnostics.service?.trackedCount ?? 0} tracked • {diagnostics.service?.soldCount ?? 0} sold
                  </div>
                  <div className="text-[11px] text-[#eae9e9]/60">
                    Issues detected: {diagnostics.service?.issues?.length ?? 0}
                  </div>
                  <div className="text-[11px] text-[#eae9e9]/60">
                    Cache sync: {diagnostics.service?.positionsCacheSize ?? 0} positions • {diagnostics.service?.ordersCacheSize ?? 0} orders
                  </div>
                  {diagnostics.service?.issues?.length ? (
                    <ul className="text-[11px] text-[#fbbf24] space-y-0.5 mt-1">
                      {diagnostics.service.issues.slice(0, 3).map((issue, idx) => (
                        <li key={`${issue.symbol}-${issue.type}-${idx}`}>
                          {issue.symbol}: {issue.type.replace(/-/g, ' ')}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-[11px] text-[#4ade80] mt-1">No active issues detected</div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="px-3 py-2 border-b border-[#2a2820]/40">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <SummaryCard
                title="Tracked Positions"
                value={summary.total}
                subtitle={Object.entries(summary.groupCounts)
                  .map(([group, count]) => `${group}: ${count}`)
                  .join(' • ') || 'No positions tracked'}
              />
              <SummaryCard
                title="Active Stops"
                value={summary.active}
                subtitle={analysisEnabled ? 'Stops currently enforced' : 'Automation paused'}
              />
              <SummaryCard
                title="Pending Actions"
                value={summary.pending}
                subtitle={analysisEnabled ? 'Orders awaiting execution or update' : 'Automation paused'}
              />
              <SummaryCard
                title="Auto-Sell Executed"
                value={summary.autoSold}
                subtitle="Positions exited automatically"
              />
            </div>
          </div>

          {error && (
            <div className="px-4 pt-3">
              <div className="bg-[#3a1e1e] border border-[#f87171] text-[#f87171] text-xs rounded p-3">
                {error}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {loading ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-12 h-12 bg-[#2a2820] rounded-lg flex items-center justify-center mx-auto mb-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4ade80]"></div>
                  </div>
                  <h3 className="text-sm font-medium text-[#eae9e9] mb-1">Loading Stop Limit data...</h3>
                  <p className="text-xs text-[#eae9e9]/60">Fetching the latest automation status</p>
                </div>
              </div>
            ) : rows.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-[#eae9e9]/70">
                  <div className="w-12 h-12 bg-[#2a2820] rounded-lg flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19V6a2 2 0 012-2h2a2 2 0 012 2v13m-4-5h6" />
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold text-[#eae9e9]">No tracked positions yet</h3>
                  <p className="text-xs mt-1">StopLimit automation will appear once new positions are opened.</p>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col">
                <div className="bg-[#14130e] border-b border-[#2a2820]/40 px-4 py-2 sticky top-0 z-10">
                  <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-[#eae9e9]/50 uppercase tracking-wider">
                    <div className="col-span-2">Symbol</div>
                    <div className="col-span-1 text-center">Group</div>
                    <div className="col-span-2">Stage</div>
                    <div className="col-span-1 text-right">Unrealized / Auto</div>
                    <div className="col-span-2">Stop / Limit</div>
                    <div className="col-span-2">Progress</div>
                    <div className="col-span-2">Order / Updated</div>
                  </div>
                </div>
                <div className="flex-1 overflow-auto">
                  <div className="divide-y divide-[#2a2820]/50">
                    {rows.map((row) => {
                      const orderStatusLabel = describeOrderStatus(row.orderStatus);
                      const orderStatusClass =
                        row.status === 'queued'
                          ? 'text-[#fde68a]'
                          : row.status === 'analysis-disabled'
                            ? 'text-[#f87171]'
                            : 'text-[#eae9e9]/50';

                      return (
                        <div
                          key={row.symbol}
                          className="px-4 py-3 bg-[#14130e] hover:bg-[#1e1d17] transition-colors"
                        >
                          <div className="grid grid-cols-12 gap-2 items-center text-xs text-[#eae9e9]/80">
                            <div className="col-span-2 flex items-center space-x-3">
                              <div className={`w-2 h-2 rounded-full ${statusDot[row.status] || 'bg-[#808080]'}`}></div>
                              <div>
                                <div className="text-sm font-semibold text-[#eae9e9]">{row.symbol}</div>
                                <div className="flex items-center space-x-2 mt-1">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusStyles[row.status] || 'bg-[#2a2820] text-[#eae9e9]/80 border border-[#2a2820]'}`}>
                                    {row.statusLabel}
                                  </span>
                                  <span className="text-[10px] text-[#eae9e9]/50">
                                    Avg {formatCurrency(row.avgPrice)}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="col-span-1 text-center">
                              <div className="font-semibold text-[#eae9e9]">{row.groupLabel}</div>
                              <div className="text-[10px] text-[#eae9e9]/50 uppercase tracking-wider">Group {row.groupKey}</div>
                            </div>
                            <div className="col-span-2">
                              <div className="font-semibold text-[#eae9e9]">{row.stageLabel}</div>
                              <div className="text-[10px] text-[#eae9e9]/60">{row.stageDescription}</div>
                              {row.nextTrigger !== null && row.nextStageLabel && (
                                <div className="text-[10px] text-[#eae9e9]/45 mt-1">
                                  Next: {row.nextStageLabel} at {formatOffset(row.nextTrigger)}
                                </div>
                              )}
                            </div>
                            <div className="col-span-1 text-right">
                              {row.status === 'sold' && row.totalPnL !== undefined ? (
                                <>
                                  <div className={`font-mono font-semibold text-lg ${row.totalPnL >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                                    {formatCurrency(row.totalPnL)}
                                  </div>
                                  <div className={`text-[10px] font-medium ${row.pnlPerShare !== undefined && row.pnlPerShare >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                                    {row.pnlPerShare !== undefined ? `${row.pnlPerShare >= 0 ? '+' : ''}${formatCurrency(row.pnlPerShare)}/share` : 'N/A'}
                                  </div>
                                  <div className="text-[10px] text-[#eae9e9]/50">
                                    Sold at {row.sellPrice !== undefined ? formatCurrency(row.sellPrice) : 'N/A'}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className={`font-mono font-semibold ${row.unrealizedQty !== null && row.unrealizedQty >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                                    {row.unrealizedQty !== null ? formatNumber(row.unrealizedQty, 2) : 'N/A'}
                                  </div>
                                  <div className="text-[10px] text-[#eae9e9]/50">
                                    Target {row.autoSellTrigger !== null ? formatNumber(row.autoSellTrigger, 2) : 'N/A'}
                                  </div>
                                  <div className="text-[10px] text-[#eae9e9]/45">
                                    Qty {row.quantity ? row.quantity.toLocaleString() : 'N/A'}
                                  </div>
                                </>
                              )}
                            </div>
                            <div className="col-span-2">
                              {row.status === 'sold' ? (
                                <>
                                  <div className="flex items-center space-x-2">
                                    <span className="text-[10px] text-[#eae9e9]/50 uppercase tracking-wider">Buy Avg</span>
                                    <span className="font-mono text-sm text-[#eae9e9]">{formatCurrency(row.avgPrice)}</span>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <span className="text-[10px] text-[#eae9e9]/50 uppercase tracking-wider">Sell Price</span>
                                    <span className="font-mono text-sm text-[#4ade80]">{row.sellPrice !== undefined ? formatCurrency(row.sellPrice) : 'N/A'}</span>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="flex items-center space-x-2">
                                    <span className="text-[10px] text-[#eae9e9]/50 uppercase tracking-wider">Stop</span>
                                    <span className="font-mono text-sm text-[#eae9e9]">{formatCurrency(row.stopPrice)}</span>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <span className="text-[10px] text-[#eae9e9]/50 uppercase tracking-wider">Limit</span>
                                    <span className="font-mono text-sm text-[#eae9e9]">{formatCurrency(row.limitPrice)}</span>
                                  </div>
                                </>
                              )}
                            </div>
                            <div className="col-span-2">
                              {row.status === 'sold' ? (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-[#eae9e9]/50">
                                    Sold {row.soldAt ? formatRelativeTime(row.soldAt) : 'N/A'}
                                  </div>
                                  <div className="text-[10px] text-[#eae9e9]/50">
                                    Qty: {row.quantity ? row.quantity.toLocaleString() : 'N/A'}
                                  </div>
                                </div>
                              ) : row.progress !== null ? (
                                <div className="space-y-1">
                                  <div className="w-full h-2 bg-[#2a2820] rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${row.progress >= 0.75 ? 'bg-[#22c55e]' : row.progress >= 0.4 ? 'bg-[#38bdf8]' : 'bg-[#facc15]'}`}
                                      style={{ width: `${Math.min(100, Math.max(0, row.progress * 100))}%` }}
                                    ></div>
                                  </div>
                                  <div className="flex items-center justify-between text-[10px] text-[#eae9e9]/60">
                                    <span>{(Math.min(100, Math.max(0, (row.progress || 0) * 100))).toFixed(0)}%</span>
                                    <span>Auto sell at {row.autoSellTrigger !== null ? formatNumber(row.autoSellTrigger, 2) : 'N/A'}</span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-[10px] text-[#eae9e9]/50">Progress N/A</span>
                              )}
                            </div>
                            <div className="col-span-2">
                              <div className="font-mono text-xs text-[#eae9e9] truncate">
                                {row.orderId || 'No order ID yet'}
                              </div>
                              {orderStatusLabel && (
                                <div className={`text-[10px] font-medium ${orderStatusClass}`}>
                                  Order Status: {orderStatusLabel}
                                </div>
                              )}
                              <div className="text-[10px] text-[#eae9e9]/50">
                                Updated {formatRelativeTime(row.updatedAt)} · {formatTimestamp(row.updatedAt)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
            </div>
          </div>
          )}
      </div>
        </>
      )}
    </div>
  );
};

interface SummaryCardProps {
  title: string;
  value: number;
  subtitle: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ title, value, subtitle }) => (
  <div className="bg-[#14130e] border border-[#2a2820]/40 rounded-md p-3 hover:border-[#2a2820]/60 transition-colors duration-200">
    <div className="text-[10px] font-medium text-[#eae9e9]/55 uppercase tracking-[0.15em]">
      {title}
    </div>
    <div className="text-lg font-semibold text-[#eae9e9] leading-none mt-2">{value}</div>
    <div className="text-[11px] text-[#eae9e9]/45 mt-2 leading-snug">{subtitle}</div>
  </div>
);

export default StopLimitSection;