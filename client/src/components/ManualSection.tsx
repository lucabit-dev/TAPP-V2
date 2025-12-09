import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import DXChartWidget from './DXChartWidget';
import StockChart from './StockChart';

const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3001';

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

const ManualSection: React.FC<Props> = ({ viewMode = 'qualified' }) => {
  const [manualList, setManualList] = useState<{
    qualified: ScoredStock[];
    nonQualified: NonQualifiedStock[];
    analyzing: AnalyzingStock[];
  }>({ qualified: [], nonQualified: [], analyzing: [] });

  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

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
          
          if (msg.type === 'MANUAL_LIST_UPDATE') {
            setManualList({
              qualified: msg.data.qualified || [],
              nonQualified: msg.data.nonQualified || [],
              analyzing: msg.data.analyzing || []
            });
            setIsInitialLoad(false);
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

  const { qualified: scoredStocks, nonQualified, analyzing } = manualList;
  const poolSize = scoredStocks.length + nonQualified.length + analyzing.length;
  
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
    <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9] p-4 overflow-hidden relative">
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
            Pool: {poolSize} | Qualified: {scoredStocks.length} | Non-Qualified: {nonQualified.length} | Analyzing: {analyzing.length}
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
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-center">Chart</th>
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
                  <React.Fragment key={stock.symbol}>
                    <tr className="hover:bg-[#1e1d17] transition-colors border-t border-[#2a2820]/50">
                      <td className="p-3 font-bold text-[#eae9e9] w-12 text-center bg-[#1a1915]/50">{idx + 1}</td>
                      <td className="p-3 font-bold text-[#4ade80]">{stock.symbol}</td>
                      <td className="p-3 text-center">
                        <button 
                          onClick={() => setSelectedStock(stock.symbol)}
                          className="px-2 py-1 bg-[#2a2820] hover:bg-[#3a3830] text-[#eae9e9] text-xs rounded border border-[#404040] transition-colors"
                        >
                          Show
                        </button>
                      </td>
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
                    <tr className="border-b border-[#2a2820]/50 bg-[#0f0e0a]/50">
                      <td colSpan={17} className="p-2 pl-16">
                        <div className="h-24 w-full border border-[#2a2820] rounded bg-[#14130e] p-1">
                          <StockChart ticker={stock.symbol} height={90} />
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
                {scoredStocks.length === 0 && (
                  <tr>
                    <td colSpan={17} className="p-8 text-center text-[#808080]">
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
                  <th className="p-3 border-b border-[#2a2820] text-[#808080] font-medium text-center">Chart</th>
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
                    <td className="p-3 text-center">
                      <button 
                        onClick={() => setSelectedStock(stock.symbol)}
                        className="px-2 py-1 bg-[#2a2820] hover:bg-[#3a3830] text-[#eae9e9] text-xs rounded border border-[#404040] transition-colors"
                      >
                        Show
                      </button>
                    </td>
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
                    <td colSpan={7} className="p-8 text-center text-[#808080]">
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

      {/* CHART MODAL */}
      {selectedStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#1a1915] border border-[#2a2820] rounded-lg w-full max-w-6xl h-[80vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-3 border-b border-[#2a2820] bg-[#14130e]">
              <h3 className="font-bold text-[#eae9e9] text-lg flex items-center">
                <span className="text-[#eab308] mr-2">{selectedStock}</span> Chart
              </h3>
              <button 
                onClick={() => setSelectedStock(null)}
                className="p-1 hover:bg-[#2a2820] rounded text-[#808080] hover:text-[#eae9e9] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden relative p-1 bg-[#0f0e0a]">
              <DXChartWidget symbol={selectedStock} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManualSection;
