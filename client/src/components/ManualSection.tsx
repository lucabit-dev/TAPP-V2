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

const ManualSection: React.FC = () => {
  const [rawRows, setRawRows] = useState<any[]>([]);
  const [techData, setTechData] = useState<Map<string, IndicatorData>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
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
  const scoredStocks = useMemo(() => {
    const candidates: ScoredStock[] = [];

    rawRows.forEach(row => {
      const symbol = row.symbol || row.columns?.find((c: any) => c.key === 'SymbolColumn')?.value;
      if (!symbol) return;
      
      const indicators = techData.get(symbol);
      if (!indicators) return; // Need indicators for filtering

      // 1. Filter: Histogram 5m > 0, MACD 5m > 0, EMA 18 5m > EMA 200 5m
      if (
        (indicators.macd5m?.histogram ?? -1) <= 0 ||
        (indicators.macd5m?.macd ?? -1) <= 0 ||
        (indicators.ema5m18 ?? 0) <= (indicators.ema5m200 ?? 999999)
      ) {
        return;
      }

      // Extract factors
      const change2m = getColVal(row, ['PrzChangeFilterMIN2', 'ChangeMIN2', 'Change2MIN']) ?? 0;
      const change5m = getColVal(row, ['PrzChangeFilterMIN5', 'ChangeMIN5', 'Change5MIN']) ?? 0;
      const trades1m = getColVal(row, ['TradeCountFilterMIN1', 'TradeCountMIN1', 'TradesMIN1']) ?? 0;
      const trades2m = getColVal(row, ['TradeCountFilterMIN2', 'TradeCountMIN2', 'TradesMIN2']) ?? 0; // Assuming this key exists or similar
      const vol1m = getColVal(row, ['AbsVolumeFilterMIN1', 'VolumeMIN1']) ?? 0;
      const vol2m = getColVal(row, ['AbsVolumeFilterMIN2', 'VolumeMIN2']) ?? 0;
      const changeOpen = getColVal(row, ['ChangeFromOpenPRZ', 'ChangeFromOpen']) ?? 0;
      const distVwap = getColVal(row, ['DistanceFromVWAPPRZ', 'DistanceFromVWAP']) ?? 0;
      const cons1m = getColVal(row, ['ConsecutiveCandleFilterFM1', 'ConsecutiveCandle']) ?? 0;
      const dailyVol = getColVal(row, ['AbsVolumeFilterDAY1', 'Volume', 'VolumeColumn']) ?? 0;
      const price = getColVal(row, ['PriceNOOPTION', 'Price']) ?? 0;

      const meetsExtra = {
        macd1mPos: (indicators.macd1m?.macd ?? -1) > 0,
        closeOverEma1m: price > (indicators.ema1m18 ?? 999999)
      };

      candidates.push({
        symbol,
        price,
        score: 0, // Computed later
        factors: { change2m, change5m, trades1m, trades2m, vol1m, vol2m, changeOpen, distVwap, cons1m, dailyVol },
        indicators,
        meetsExtra,
        rawRow: row
      });
    });

    if (candidates.length === 0) return [];

    // 2. Normalize and Score
    // Find Min/Max for each factor
    const factorsKey = [
      'change2m', 'change5m', 'trades1m', 'trades2m', 
      'vol1m', 'vol2m', 'changeOpen', 'distVwap', 
      'cons1m', 'dailyVol'
    ] as const;

    const stats: Record<string, { min: number; max: number }> = {};
    
    factorsKey.forEach(key => {
      const values = candidates.map(c => c.factors[key]);
      stats[key] = { min: Math.min(...values), max: Math.max(...values) };
    });

    // Compute Score
    candidates.forEach(c => {
      let totalScore = 0;
      
      factorsKey.forEach(key => {
        const { min, max } = stats[key];
        const val = c.factors[key];
        let score = 0;
        
        if (max === min) {
          score = 50; // Default if no variance
        } else {
          if (key === 'distVwap') {
            // Lower is better
            score = 100 * (max - val) / (max - min);
          } else {
            // Higher is better
            score = 100 * (val - min) / (max - min);
          }
        }
        
        totalScore += score * (WEIGHTS[key] || 0);
      });
      
      c.score = totalScore;
    });

    // 3. Sort and Top 10
    return candidates.sort((a, b) => b.score - a.score).slice(0, 10);

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

  return (
    <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9] p-4 overflow-hidden">
      <div className="flex justify-between items-center mb-4 border-b border-[#2a2820] pb-4">
        <div>
          <h2 className="text-xl font-bold text-[#eae9e9]">MANUAL Live Ranking</h2>
          <p className="text-xs text-[#808080] mt-1">Top 10 Opportunities • Scoring Strategy: Momentum Intraday</p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-[#22c55e]' : 'bg-[#f87171]'}`}></div>
            <span className="text-xs text-[#808080] uppercase">{connectionStatus}</span>
          </div>
          <div className="text-xs text-[#808080]">
            Pool: {rawRows.length} | Qualified: {scoredStocks.length}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-[#2a2820] bg-[#0f0e0a]">
        <table className="w-full text-xs text-left border-collapse">
          <thead className="sticky top-0 bg-[#1a1915] z-10">
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
                  Waiting for stocks meeting strict technical criteria...
                  <br/>
                  <span className="text-xs opacity-60 mt-2 block">
                    Requires: MACD 5m &gt; 0, Histogram 5m &gt; 0, EMA18 5m &gt; EMA200 5m
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ManualSection;

