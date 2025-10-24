import React, { useEffect, useRef } from 'react';

interface TradingViewWidgetProps {
  symbol: string;
  interval?: string;
  height?: number | string;
  width?: number | string;
  theme?: 'light' | 'dark';
  hide_side_toolbar?: boolean;
  hide_top_toolbar?: boolean;
}

const TradingViewWidget: React.FC<TradingViewWidgetProps> = ({
  symbol,
  interval = 'D',
  height = '100%',
  width = '100%',
  theme = 'light',
  hide_side_toolbar = true,
  hide_top_toolbar = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !symbol) return;

    // Clear container
    containerRef.current.innerHTML = '';

    // Create the widget HTML structure
    const widgetHTML = `
      <div class="tradingview-widget-container" style="width:100%">
        <div class="tradingview-widget-container__widget" style="height:calc(100% - 32px);width:100%"></div>
        <div class="tradingview-widget-copyright">
          <a href="https://www.tradingview.com/symbols/NASDAQ-${symbol}/" rel="noopener nofollow" target="_blank">
            <span class="blue-text">${symbol} stock chart</span>
          </a>
          <span class="trademark"> by TradingView</span>
        </div>
        <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>
        {
          "allow_symbol_change": true,
          "calendar": false,
          "details": false,
          "hide_side_toolbar": ${hide_side_toolbar},
          "hide_top_toolbar": true,
          "hide_legend": false,
          "hide_volume": false,
          "hotlist": false,
          "interval": "${interval}",
          "locale": "en",
          "save_image": true,
          "style": "1",
          "symbol": "NASDAQ:${symbol}",
          "theme": "${theme}",
          "timezone": "Etc/UTC",
                 "backgroundColor": "#1e1e1e",
                 "gridColor": "rgba(204, 204, 204, 0.1)",
          "watchlist": [],
          "withdateranges": false,
          "compareSymbols": [],
          "studies": [],
          "autosize": true
        }
        </script>
      </div>
    `;

    // Insert the HTML
    containerRef.current.innerHTML = widgetHTML;

    // Execute any scripts in the inserted HTML
    const scripts = containerRef.current.querySelectorAll('script');
    scripts.forEach(script => {
      const newScript = document.createElement('script');
      newScript.type = script.type;
      newScript.src = script.src;
      newScript.async = script.async;
      newScript.innerHTML = script.innerHTML;
      
      // Remove the old script
      script.remove();
      
      // Append the new script
      containerRef.current?.appendChild(newScript);
    });

  }, [symbol, interval, theme, hide_side_toolbar, hide_top_toolbar]);

  return (
    <div 
      ref={containerRef} 
      className="h-full w-full"
      style={{ 
        height: typeof height === 'number' ? `${height}px` : height,
        width: typeof width === 'number' ? `${width}px` : width,
        position: 'relative',
        overflow: 'hidden'
      }}
    />
  );
};

export default TradingViewWidget;
