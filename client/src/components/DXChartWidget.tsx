import React, { useEffect, useRef } from 'react';
import { createChart } from '@devexperts/dxcharts-lite';

interface DXChartWidgetProps {
  symbol: string;
  onClose?: () => void;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const DXChartWidget: React.FC<DXChartWidgetProps> = ({ symbol }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const macdPaneRef = useRef<any>(null);
  const macdSeriesRef = useRef<any>(null);
  const signalSeriesRef = useRef<any>(null);
  const histogramSeriesRef = useRef<any>(null);

  useEffect(() => {
    let active = true;
    let pollInterval: NodeJS.Timeout | null = null;

    const initChart = async () => {
      if (!containerRef.current) return;

      // Clean up previous chart
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
        macdPaneRef.current = null;
        macdSeriesRef.current = null;
        signalSeriesRef.current = null;
        histogramSeriesRef.current = null;
      }

      try {
        // Initialize the chart
        const chart = createChart(containerRef.current, {
            components: {
                chart: {
                    type: 'candle',
                }
            },
            colors: {
                chartAreaTheme: {
                    backgroundColor: '#14130e',
                    gridColor: '#2a2820'
                },
                xAxis: {
                    labelTextColor: '#969696',
                    backgroundColor: '#14130e'
                },
                yAxis: {
                    labelTextColor: '#969696',
                    backgroundColor: '#14130e',
                    labelBoxColor: '#2a2820'
                },
                candleTheme: {
                    upColor: '#4ec9b0',
                    downColor: '#f44747',
                    upWickColor: '#4ec9b0',
                    downWickColor: '#f44747',
                    noneColor: '#969696',
                    noneWickColor: '#969696'
                }
            }
        });
        
        if (!active) {
            chart.destroy();
            return;
        }
        
        chartRef.current = chart;

        // Fetch initial data (Candles + MACD)
        const fetchInitialData = async () => {
            try {
                const [historyRes, macdRes] = await Promise.all([
                    fetch(`${API_BASE_URL.replace(/\/$/, '')}/history/${symbol}?limit=1000`),
                    fetch(`${API_BASE_URL.replace(/\/$/, '')}/indicators/macd/${symbol}?limit=1000`)
                ]);

                const historyResult = await historyRes.json();
                const macdResult = await macdRes.json();
                
                if (!active) return;

                // 1. Set Candle Data
                if (historyResult.success && Array.isArray(historyResult.data)) {
                    const candles = historyResult.data.map((candle: any) => ({
                        id: new Date(candle.timestamp).getTime().toString(),
                        timestamp: new Date(candle.timestamp).getTime(),
                        open: candle.open,
                        hi: candle.high,
                        lo: candle.low,
                        close: candle.close,
                        volume: candle.volume
                    }));

                    chart.setData({
                        candles: candles,
                        instrument: {
                            symbol: symbol,
                            description: symbol,
                            priceIncrements: [0.01]
                        }
                    });
                }

                // 2. Setup MACD Pane and Series
                if (macdResult.success && macdResult.data) {
                    const { macd, signal, histogram } = macdResult.data;
                    
                    if (!macdPaneRef.current) {
                        const pane = chart.createPane();
                        macdPaneRef.current = pane;
                        
                        const macdSeries = pane.createDataSeries();
                        macdSeries.name = 'MACD';
                        macdSeries.setType('line');
                        
                        const signalSeries = pane.createDataSeries();
                        signalSeries.name = 'Signal';
                        signalSeries.setType('line');
                        
                        const histogramSeries = pane.createDataSeries();
                        histogramSeries.name = 'Histogram';
                        histogramSeries.setType('histogram');
                        
                        macdSeriesRef.current = macdSeries;
                        signalSeriesRef.current = signalSeries;
                        histogramSeriesRef.current = histogramSeries;
                    }

                    if (macdSeriesRef.current && signalSeriesRef.current && histogramSeriesRef.current) {
                        const macdPoints = macd.map((p: any) => ({ timestamp: p.timestamp, close: p.value }));
                        const signalPoints = signal.map((p: any) => ({ timestamp: p.timestamp, close: p.value }));
                        const histogramPoints = histogram.map((p: any) => ({ timestamp: p.timestamp, close: p.value }));
                        
                        macdSeriesRef.current.setDataPoints(macdPoints);
                        signalSeriesRef.current.setDataPoints(signalPoints);
                        histogramSeriesRef.current.setDataPoints(histogramPoints);
                    }
                }

            } catch (err) {
                console.error("Error fetching initial data:", err);
            }
        };

        await fetchInitialData();

        // Polling for updates (Fast polling for realtime feel)
        pollInterval = setInterval(async () => {
            if (!active || !chartRef.current) return;
            
            try {
                // 1. Fetch current price for immediate update
                const priceRes = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/price/${symbol}`);
                const priceResult = await priceRes.json();
                
                if (priceResult.success && priceResult.data) {
                    const currentPrice = priceResult.data.price;
                    const now = Date.now();
                    
                    // Create a pseudo-candle update for the current second
                    // If we have access to last candle, we update it.
                    // DXCharts Lite handles "updateLastCandle" if we pass a candle with same timestamp or newer?
                    // We need to construct a valid candle object.
                    
                    // Since we don't have full OHLC for the current second from this endpoint, 
                    // we might need to rely on the history endpoint which hopefully includes the developing bar.
                    // BUT, to make it "tick", we can fetch history more frequently.
                }

                // 2. Fetch history (developing bar)
                const historyRes = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/history/${symbol}?limit=2`);
                const historyResult = await historyRes.json();
                
                if (historyResult.success && Array.isArray(historyResult.data) && historyResult.data.length > 0) {
                    const newCandles = historyResult.data.map((candle: any) => ({
                        id: new Date(candle.timestamp).getTime().toString(),
                        timestamp: new Date(candle.timestamp).getTime(),
                        open: candle.open,
                        hi: candle.high,
                        lo: candle.low,
                        close: candle.close,
                        volume: candle.volume
                    }));
                    
                    if (chartRef.current.data) {
                        chartRef.current.data.updateCandles(newCandles, symbol);
                    }
                }
                
                // 3. Fetch MACD less frequently or every time? 
                // Every 1s might be heavy for full MACD recalc, but fine for small dataset.
                // Let's do it every poll to keep sync.
                const macdRes = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/indicators/macd/${symbol}?limit=500`);
                const macdResult = await macdRes.json();

                if (macdResult.success && macdResult.data && macdSeriesRef.current) {
                    const { macd, signal, histogram } = macdResult.data;
                    
                    const macdPoints = macd.map((p: any) => ({ timestamp: p.timestamp, close: p.value }));
                    const signalPoints = signal.map((p: any) => ({ timestamp: p.timestamp, close: p.value }));
                    const histogramPoints = histogram.map((p: any) => ({ timestamp: p.timestamp, close: p.value }));
                    
                    macdSeriesRef.current.setDataPoints(macdPoints);
                    signalSeriesRef.current.setDataPoints(signalPoints);
                    histogramSeriesRef.current.setDataPoints(histogramPoints);
                }
            } catch (err) {
                console.error("Error polling updates:", err);
            }
        }, 1000); // 1 second polling

      } catch (error) {
        console.error("Failed to initialize DXCharts Lite:", error);
      }
    };

    setTimeout(initChart, 0);

    return () => {
      active = false;
      if (pollInterval) clearInterval(pollInterval);
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [symbol]);

  return (
    <div className="w-full h-full bg-[#14130e] relative">
       <div ref={containerRef} className="w-full h-full" id="chart_container" />
    </div>
  );
};

export default DXChartWidget;
