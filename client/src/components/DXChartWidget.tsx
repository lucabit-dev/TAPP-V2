import React, { useEffect, useRef } from 'react';

interface DXChartWidgetProps {
  symbol: string;
  onClose?: () => void;
}

// Simple deterministic data generator
const generateData = (symbol: string, count = 500) => {
  const data = [];
  const end = Date.now();
  // Seed random based on symbol string
  let seed = symbol.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const rnd = () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };

  let price = 100 + (rnd() * 100); // Base price varies by symbol
  
  for (let i = count; i >= 0; i--) {
    const time = end - (i * 60 * 1000); // 1m candles
    const volatility = price * 0.005;
    const open = price;
    const change = (rnd() - 0.5) * volatility;
    const close = price + change;
    const high = Math.max(open, close) + rnd() * volatility * 0.5;
    const low = Math.min(open, close) - rnd() * volatility * 0.5;
    const volume = Math.floor(rnd() * 5000 + 100);
    
    data.push({ time, open, high, low, close, volume });
    price = close;
  }
  return data;
};

const DXChartWidget: React.FC<DXChartWidgetProps> = ({ symbol }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);

  useEffect(() => {
    let active = true;
    const subscriptions = new Map<string, any>();
    const lastCandles = new Map<string, any>();

    const initWidget = async () => {
      if (!containerRef.current) return;

      // Destroy existing widget if any
      if (widgetRef.current) {
        widgetRef.current.destroy();
        widgetRef.current = null;
      }

      try {
        let DXChart = (window as any).DXChart;
        let attempts = 0;
        
        while (!DXChart && attempts < 50) {
            if (attempts === 0) console.warn("DXChart global not found immediately. Polling...");
            await new Promise(r => setTimeout(r, 100));
            DXChart = (window as any).DXChart;
            attempts++;
        }

        if (!DXChart) {
            console.error("DXChart global not found after 5 seconds.");
            return;
        }

        const createWidget = DXChart.createWidget || DXChart.widget?.createWidget;

        if (!createWidget) {
            console.error("createWidget function not found on DXChart global:", DXChart);
            return;
        }
        
        const chartDataProvider = {
            requestHistoryData: (reqSymbol: string, aggregation: any, options: any) => {
                const data = generateData(reqSymbol);
                if (data.length > 0) {
                    lastCandles.set(reqSymbol, data[data.length - 1]);
                }
                return Promise.resolve(data);
            },
            subscribeCandles: (subSymbol: string, aggregation: any, subscriptionId: string, callback: any) => {
                const interval = setInterval(() => {
                    if (!active) return;
                    
                    let lastCandle = lastCandles.get(subSymbol);
                    if (!lastCandle) return;

                    const now = Date.now();
                    // Assuming 1m aggregation for simplicity in this mock
                    const candlePeriod = 60 * 1000; 
                    const currentCandleStart = Math.floor(now / candlePeriod) * candlePeriod;
                    
                    let newCandle = { ...lastCandle };
                    
                    const volatility = lastCandle.close * 0.0005;
                    const change = (Math.random() - 0.5) * volatility;
                    
                    if (lastCandle.time < currentCandleStart) {
                        // Start new candle
                        newCandle = {
                            time: currentCandleStart,
                            open: lastCandle.close,
                            close: lastCandle.close + change,
                            high: Math.max(lastCandle.close, lastCandle.close + change),
                            low: Math.min(lastCandle.close, lastCandle.close + change),
                            volume: Math.floor(Math.random() * 100)
                        };
                    } else {
                        // Update existing candle
                        newCandle.close += change;
                        newCandle.high = Math.max(newCandle.high, newCandle.close);
                        newCandle.low = Math.min(newCandle.low, newCandle.close);
                        newCandle.volume += Math.floor(Math.random() * 10);
                    }
                    
                    lastCandles.set(subSymbol, newCandle);
                    callback([newCandle]);
                }, 1000); // Update every second
                
                subscriptions.set(subscriptionId, interval);
            },
            unsubscribeCandles: (subscriptionId: string) => {
                const interval = subscriptions.get(subscriptionId);
                if (interval) {
                    clearInterval(interval);
                    subscriptions.delete(subscriptionId);
                }
            },
            subscribeServiceData: (symbol: string, callback: any) => {
                // Optional: Send periodic updates if needed
            },
            unsubscribeServiceData: (symbol: string) => {
                // Optional cleanup
            }
        };

        const providers = {
            chartDataProvider,
        };
        
        const widget = await createWidget(containerRef.current, {
          dependencies: providers,
          symbol: symbol, 
          period: '1m', 
          chartTheme: 'dark', 
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });

        if (active) {
          widgetRef.current = widget;
        } else {
          widget.destroy();
        }
      } catch (error) {
        console.error("Failed to initialize DXCharts widget:", error);
      }
    };

    setTimeout(initWidget, 0);

    return () => {
      active = false;
      subscriptions.forEach(interval => clearInterval(interval));
      subscriptions.clear();
      if (widgetRef.current) {
        widgetRef.current.destroy();
        widgetRef.current = null;
      }
    };
  }, [symbol]);

  return (
    <div className="w-full h-full bg-[#0f0e0a] relative">
       <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};

export default DXChartWidget;
