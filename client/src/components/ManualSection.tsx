import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';

const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';
const MANUAL_CONFIG_ID = '692117e2b7bb6ba7a6ae6f6c';

interface IndicatorData {
  ema1m18: number | null;
  ema1m200: number | null;
  ema5m18: number | null;
  ema5m200: number | null;
  macd1m: { macd: number; signal: number; histogram: number } | null;
  macd5m: { macd: number; signal: number; histogram: number } | null;
  vwap1m: number | null;
}

interface ScoredStock {
  symbol: string;
  price: number;
  score: number;
  factors: {
    change2m: number;
    change5m: number;
    trades1m: number;
    trades2m: number;
    vol1m: number;
    vol2m: number;
    changeOpen: number;
    distVwap: number;
    cons1m: number;
    dailyVol: number;
  };
  indicators: IndicatorData | null;
  meetsExtra: {
    macd1mPos: boolean;
    closeOverEma1m: boolean;
  };
  rawRow: any;
}

interface NonQualifiedStock {
  symbol: string;
  price: number;
  reasons: string[];
  factors: {
    change2m: number;
    change5m: number;
    trades1m: number;
    trades2m: number;
    vol1m: number;
    vol2m: number;
    changeOpen: number;
    distVwap: number;
    cons1m: number;
    dailyVol: number;
  };
  rawRow: any;
}

interface AnalyzingStock {
  symbol: string;
  price: number;
  factors: any;
  rawRow: any;
}

interface Props {
  viewMode?: 'qualified' | 'non-qualified';
}

const WEIGHTS = {
  distVwap: 0.20,
  change2m: 0.15,
  change5m: 0.15,
  trades1m: 0.08,
  trades2m: 0.08,
  vol1m: 0.08,
  vol2m: 0.08,
  changeOpen: 0.08,
  cons1m: 0.05,
  dailyVol: 0.05
};

const ManualSection: React.FC<Props> = ({ viewMode = 'qualified' }) => {
  const [rawRows, setRawRows] = useState<any[]>([]);
  const [techData, setTechData] = useState<Map<string, IndicatorData>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);

  // Helper to extract value from row columns
  const getColVal = (row: any, keys: string[]): number | null => {
    if (!row.columns) return null;
    const col = row.columns.find((c: any) => keys.includes(c.key));
    if (!col) return null;
    
    // Handle K/M/B suffixes
    const valStr = String(col.value).trim();
    if (/[KMB]$/i.test(valStr)) {
      const num = parseFloat(valStr.replace(/[^0-9.-]/g, ''));
      if (isNaN(num)) return null;
      if (/B$/i.test(valStr)) return num * 1_000_000_000;
      if (/M$/i.test(valStr)) return num * 1_000_000;
      if (/K$/i.test(valStr)) return num * 1_000;
      return num;
    }
    
    const val = parseFloat(valStr.replace(/[^0-9.-]/g, ''));
    return isNaN(val) ? null : val;
  };

  // Computed scored stocks
  const { qualified: scoredStocks, nonQualified, analyzing } = useMemo(() => {
    const qualified: ScoredStock[] = [];
    const nonQualified: NonQualifiedStock[] = [];
    const analyzing: AnalyzingStock[] = [];

    rawRows.forEach(row => {
      const symbol = row.symbol || row.columns?.find((c: any) => c.key === 'SymbolColumn')?.value;
      if (!symbol) return;
      
      // Extract factors first as we need them for both lists (for display or scoring)
      const change2m = getColVal(row, ['PrzChangeFilterMIN2', 'ChangeMIN2', 'Change2MIN']) ?? 0;
      const change5m = getColVal(row, ['PrzChangeFilterMIN5', 'ChangeMIN5', 'Change5MIN']) ?? 0;
      const trades1m = getColVal(row, ['TradeCountFilterMIN1', 'TradeCountMIN1', 'TradesMIN1']) ?? 0;
      const trades2m = getColVal(row, ['TradeCountFilterMIN2', 'TradeCountMIN2', 'TradesMIN2']) ?? 0;
      const vol1m = getColVal(row, ['AbsVolumeFilterMIN1', 'VolumeMIN1']) ?? 0;
      const vol2m = getColVal(row, ['AbsVolumeFilterMIN2', 'VolumeMIN2']) ?? 0;
      const changeOpen = getColVal(row, ['ChangeFromOpenPRZ', 'ChangeFromOpen']) ?? 0;
      const distVwap = getColVal(row, ['DistanceFromVWAPPRZ', 'DistanceFromVWAP']) ?? 0;
      const cons1m = getColVal(row, ['ConsecutiveCandleFilterFM1', 'ConsecutiveCandle']) ?? 0;
      const dailyVol = getColVal(row, ['AbsVolumeFilterDAY1', 'Volume', 'VolumeColumn']) ?? 0;
      const price = getColVal(row, ['PriceNOOPTION', 'Price']) ?? 0;

      const factors = { change2m, change5m, trades1m, trades2m, vol1m, vol2m, changeOpen, distVwap, cons1m, dailyVol };

      const indicators = techData.get(symbol);
      
      if (!indicators) {
        analyzing.push({ symbol, price, factors, rawRow: row });
        return;
      }

      const reasons: string[] = [];
      if ((indicators.macd5m?.histogram ?? -1) <= 0) reasons.push("Hist 5m <= 0");
      if ((indicators.macd5m?.macd ?? -1) <= 0) reasons.push("MACD 5m <= 0");
      if ((indicators.ema5m18 ?? 0) <= (indicators.ema5m200 ?? 999999)) reasons.push("EMA18 < EMA200");

      if (reasons.length > 0) {
        nonQualified.push({
          symbol,
          price,
          reasons,
          factors,
          rawRow: row
        });
        return;
      }

      const meetsExtra = {
        macd1mPos: (indicators.macd1m?.macd ?? -1) > 0,
        closeOverEma1m: price > (indicators.ema1m18 ?? 999999)
      };

      qualified.push({
        symbol,
        price,
        score: 0, // Computed later
        factors,
        indicators,
        meetsExtra,
        rawRow: row
      });
    });

    if (qualified.length > 0) {
      // Normalize and Score for qualified stocks
      const factorsKey = [
        'change2m', 'change5m', 'trades1m', 'trades2m', 
        'vol1m', 'vol2m', 'changeOpen', 'distVwap', 
        'cons1m', 'dailyVol'
      ] as const;

      const stats: Record<string, { min: number; max: number }> = {};
      
      factorsKey.forEach(key => {
        const values = qualified.map(c => c.factors[key]);
        stats[key] = { min: Math.min(...values), max: Math.max(...values) };
      });

      qualified.forEach(c => {
        let totalScore = 0;
        
        factorsKey.forEach(key => {
          const { min, max } = stats[key];
          const val = c.factors[key];
          let score = 0;
          
          if (max === min) {
            score = 50;
          } else {
            if (key === 'distVwap') {
              score = 100 * (max - val) / (max - min);
            } else {
              score = 100 * (val - min) / (max - min);
            }
          }
          
          totalScore += score * (WEIGHTS[key] || 0);
        });
        
        c.score = totalScore;
      });
    }

    return {
      qualified: qualified.sort((a, b) => b.score - a.score).slice(0, 10),
      nonQualified: nonQualified.sort((a, b) => a.symbol.localeCompare(b.symbol)),
      analyzing: analyzing.sort((a, b) => a.symbol.localeCompare(b.symbol))
    };

  }, [rawRows, techData]);

  useEffect(() => {
    const connect = () => {
      setConnectionStatus('connecting');
      wsRef.current = new WebSocket(WS_BASE_URL);

      wsRef.current.onopen = () => {
        setConnectionStatus('connected');
      };

      wsRef.current.onclose = () => {
        setConnectionStatus('disconnected');
        setTimeout(connect, 3000);
      };

      wsRef.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          
          if (msg.type === 'TOPLIST_UPDATE' && msg.data?.config_id === MANUAL_CONFIG_ID) {
            setRawRows(msg.data.rows || []);
            setIsInitialLoad(false);
          }
          
          if (msg.type === 'STOCK_TECH_UPDATE' && msg.data?.indicators) {
            // Only store if we have indicators
            setTechData(prev => {
              const next = new Map(prev);
              next.set(msg.data.symbol, msg.data.indicators);
              return next;
            });
          }
        } catch (err) {
          console.error(err);
        }
      };
    };

    connect();
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const formatNumber = (num: number, decimals = 2) => num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const title = viewMode === 'qualified' ? 'MANUAL Live Ranking' : 'NON-QUALIFIED Stocks';
  
  // Initial Loading Screen
  if (isInitialLoad) {
    return (
      <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9] p-4 overflow-hidden">
        <div className="flex justify-between items-center mb-4 border-b border-[#2a2820] pb-4">
          <div>
            <h2 className="text-xl font-bold text-[#eae9e9]">{title}</h2>
            <p className="text-xs text-[#808080] mt-1">Loading data...</p>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-[#eab308] animate-pulse"></div>
            <span className="text-xs text-[#808080] uppercase">INITIALIZING</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center space-y-4 text-[#808080]">
          <div className="w-8 h-8 border-2 border-[#2a2820] border-t-[#808080] rounded-full animate-spin"></div>
          <p className="text-xs tracking-wider uppercase">Connecting to market data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9] p-4 overflow-hidden">
      <div className="flex justify-between items-center mb-4 border-b border-[#2a2820] pb-4">
        <div>
          <h2 className="text-xl font-bold text-[#eae9e9]">{title}</h2>
          <p className="text-xs text-[#808080] mt-1">
            {viewMode === 'qualified' 
              ? 'Top 10 Opportunities • Scoring Strategy: Momentum Intraday' 
              : 'Stocks failing technical criteria (MACD, Histogram, EMA)'}
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-[#22c55e]' : 'bg-[#f87171]'}`}></div>
            <span className="text-xs text-[#808080] uppercase">{connectionStatus}</span>
          </div>
          <div className="text-xs text-[#808080]">
            Pool: {rawRows.length} | Qualified: {scoredStocks.length} | Non-Qualified: {nonQualified.length} | Analyzing: {analyzing.length}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-6">
        {/* QUALIFIED SECTION */}
        {viewMode === 'qualified' && (
          <div className="rounded-lg border border-[#2a2820] bg-[#0f0e0a]">
            <div className="p-2 border-b border-[#2a2820] bg-[#1a1915] sticky top-0">
              <h3 className="text-sm font-bold text-[#4ade80]">QUALIFIED STOCKS ({scoredStocks.length})</h3>
            </div>
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-[#1a1915]">
                <tr>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium">Rank</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium">Symbol</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">Score</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">Price</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-center">MACD 1m+</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-center">Close {'>'} EMA18</th>
                  {/* Factors */}
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="Distance VWAP (20%)">VWAP %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="2m Change (15%)">2m %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="5m Change (15%)">5m %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="1m Trades (8%)">1m Trd</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="2m Trades (8%)">2m Trd</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="1m Vol (8%)">1m Vol</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="2m Vol (8%)">2m Vol</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="Open Chg (8%)">Open %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="Cons 1m (5%)">Cons</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right" title="Daily Vol (5%)">Day Vol</th>
                </tr>
              </thead>
              <tbody>
                {scoredStocks.map((stock, idx) => (
                  <tr key={stock.symbol} className="hover:bg-[#1e1d17] transition-colors border-b border-[#2a2820]/50 last:border-0">
                    <td className="p-3 font-bold text-[#eae9e9] w-12 text-center bg-[#1a1915]/50">{idx + 1}</td>
                    <td className="p-3 font-bold text-[#4ade80]">{stock.symbol}</td>
                    <td className="p-3 text-right font-mono font-bold text-[#facc15]">{stock.score.toFixed(1)}</td>
                    <td className="p-3 text-right font-mono">${formatNumber(stock.price)}</td>
                    
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded ${stock.meetsExtra.macd1mPos ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#2a2820] text-[#808080]'}`}>
                        {stock.meetsExtra.macd1mPos ? 'YES' : 'NO'}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded ${stock.meetsExtra.closeOverEma1m ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#2a2820] text-[#808080]'}`}>
                        {stock.meetsExtra.closeOverEma1m ? 'YES' : 'NO'}
                      </span>
                    </td>

                    <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.distVwap)}%</td>
                    <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.change2m)}%</td>
                    <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.change5m)}%</td>
                    <td className="p-3 text-right font-mono text-[#eae9e9]/80">{Math.round(stock.factors.trades1m)}</td>
                    <td className="p-3 text-right font-mono text-[#eae9e9]/80">{Math.round(stock.factors.trades2m)}</td>
                    <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.vol1m / 1000, 0)}k</td>
                    <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.vol2m / 1000, 0)}k</td>
                    <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.changeOpen)}%</td>
                    <td className="p-3 text-right font-mono text-[#eae9e9]/80">{stock.factors.cons1m}</td>
                    <td className="p-3 text-right font-mono text-[#eae9e9]/80">{formatNumber(stock.factors.dailyVol / 1000000, 1)}M</td>
                  </tr>
                ))}
                {scoredStocks.length === 0 && (
                  <tr>
                    <td colSpan={16} className="p-8 text-center text-[#808080]">
                      {analyzing.length > 0 ? (
                        <div className="flex flex-col items-center justify-center py-4 space-y-3">
                          <div className="w-6 h-6 border-2 border-[#2a2820] border-t-[#4ade80] rounded-full animate-spin"></div>
                          <span className="text-[#4ade80]">Analyzing {analyzing.length} candidates...</span>
                          <span className="text-xs opacity-60">Waiting for technical indicators</span>
                        </div>
                      ) : (
                        <>
                          No stocks meeting strict technical criteria at the moment.
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* NON-QUALIFIED SECTION */}
        {viewMode === 'non-qualified' && (
          <div className="rounded-lg border border-[#2a2820] bg-[#0f0e0a]">
            <div className="p-2 border-b border-[#2a2820] bg-[#1a1915] sticky top-0">
              <h3 className="text-sm font-bold text-[#f87171]">NON-QUALIFIED ({nonQualified.length})</h3>
            </div>
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-[#1a1915]">
                <tr>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium">Symbol</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium">Disqualification Reasons</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">Price</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">2m %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">5m %</th>
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-right">Vol 1m</th>
                </tr>
              </thead>
              <tbody>
                {nonQualified.map((stock) => (
                  <tr key={stock.symbol} className="hover:bg-[#1e1d17] transition-colors border-b border-[#2a2820]/50 last:border-0 opacity-75 hover:opacity-100">
                    <td className="p-3 font-bold text-[#f87171]">{stock.symbol}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {stock.reasons.map((reason, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-[#f87171]/10 text-[#f87171] rounded text-[10px] border border-[#f87171]/20">
                            {reason}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono text-[#808080]">${formatNumber(stock.price)}</td>
                    <td className="p-3 text-right font-mono text-[#808080]">{formatNumber(stock.factors.change2m)}%</td>
                    <td className="p-3 text-right font-mono text-[#808080]">{formatNumber(stock.factors.change5m)}%</td>
                    <td className="p-3 text-right font-mono text-[#808080]">{formatNumber(stock.factors.vol1m / 1000, 0)}k</td>
                  </tr>
                ))}
                {nonQualified.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-[#808080]">
                      {analyzing.length > 0 ? (
                        <div className="flex flex-col items-center justify-center py-4 space-y-3">
                          <div className="w-6 h-6 border-2 border-[#2a2820] border-t-[#f87171] rounded-full animate-spin"></div>
                          <span className="text-[#f87171]">Analyzing {analyzing.length} potential failures...</span>
                        </div>
                      ) : (
                        "No non-qualified stocks (all pool stocks passed or pool is empty)."
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ManualSection;
