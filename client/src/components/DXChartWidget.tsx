import React, { useEffect, useRef } from 'react';

interface DXChartWidgetProps {
  symbol: string;
  onClose?: () => void;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const DXChartWidget: React.FC<DXChartWidgetProps> = ({ symbol }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);

  useEffect(() => {
    let active = true;
    const subscriptions = new Map<string, any>();

    const initWidget = async () => {
      if (!containerRef.current) return;

      // Destroy existing widget if any
      if (widgetRef.current) {
        widgetRef.current.destroy();
        widgetRef.current = null;
      }

      try {
        let DXChart = (window as any).DXChart;
        
        // Try to load script if not present
        if (!DXChart) {
           // Check if script is already added
           if (!document.querySelector('script[src="/dxcharts/index.js"]')) {
               const script = document.createElement('script');
               script.src = '/dxcharts/index.js';
               script.async = true;
               document.body.appendChild(script);
           }
           
           // Wait for it to load
           let attempts = 0;
           while (!DXChart && attempts < 50) {
              if (attempts === 0) console.log("Waiting for DXChart script to load...");
              await new Promise(r => setTimeout(r, 100));
              DXChart = (window as any).DXChart;
              attempts++;
           }
        }

        if (!DXChart) {
            console.error("DXChart global not found after waiting.");
            return;
        }

        const createWidget = DXChart.createWidget || DXChart.widget?.createWidget;

        if (!createWidget) {
            console.error("createWidget function not found on DXChart global:", DXChart);
            return;
        }
        
        const chartDataProvider = {
            requestHistoryData: async (reqSymbol: string, aggregation: any, options: any) => {
                // Use symbol from props if reqSymbol is suspicious, but reqSymbol should be correct.
                // Log to debugging
                console.log(`[DXChart] Requesting history for: ${reqSymbol} (Widget symbol: ${symbol})`);
                
                try {
                    const res = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/history/${reqSymbol}?limit=1000`);
                    const result = await res.json();
                    
                    if (result.success && Array.isArray(result.data)) {
                         // Transform data to DXChart format
                         return result.data.map((candle: any) => ({
                             time: new Date(candle.timestamp).getTime(),
                             open: candle.open,
                             high: candle.high,
                             low: candle.low,
                             close: candle.close,
                             volume: candle.volume
                         }));
                    }
                    return [];
                } catch (err) {
                    console.error("Error fetching history:", err);
                    return [];
                }
            },
            subscribeCandles: (subSymbol: string, aggregation: any, subscriptionId: string, callback: any) => {
                console.log(`[DXChart] Subscribing candles for: ${subSymbol}`);
                // Poll for updates every 5 seconds (simulating real-time)
                const interval = setInterval(async () => {
                    if (!active) return;
                    try {
                        const res = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/history/${subSymbol}?limit=5`);
                        const result = await res.json();
                        
                        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                            const lastCandle = result.data[result.data.length - 1];
                            const candle = {
                                 time: new Date(lastCandle.timestamp).getTime(),
                                 open: lastCandle.open,
                                 high: lastCandle.high,
                                 low: lastCandle.low,
                                 close: lastCandle.close,
                                 volume: lastCandle.volume
                             };
                             callback([candle]);
                        }
                    } catch (err) {
                        console.error("Error polling candle:", err);
                    }
                }, 5000);
                
                subscriptions.set(subscriptionId, interval);
            },
            unsubscribeCandles: (subscriptionId: string) => {
                const interval = subscriptions.get(subscriptionId);
                if (interval) {
                    clearInterval(interval);
                    subscriptions.delete(subscriptionId);
                }
            },
            subscribeServiceData: (symbol: string, callback: any) => {},
            unsubscribeServiceData: (symbol: string) => {}
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
          // Minimalist config for small views (optional, DXChart usually handles this via config file but we pass basic override)
          settings: {
              // We might want to disable some UI elements if it's too small
          }
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
