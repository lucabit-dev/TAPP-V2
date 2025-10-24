import React, { useEffect, useRef } from 'react';

interface CompanyProfileWidgetProps {
  symbol: string;
  height?: number | string;
  width?: number | string;
  theme?: 'light' | 'dark';
}

const CompanyProfileWidget: React.FC<CompanyProfileWidgetProps> = ({
  symbol,
  height = 200,
  width = '100%',
  theme = 'light',
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
            <span class="blue-text">${symbol} key facts</span>
          </a>
          <span class="trademark"> by TradingView</span>
        </div>
        <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-symbol-profile.js" async>
        {
          "symbol": "NASDAQ:${symbol}",
          "colorTheme": "${theme}",
          "isTransparent": false,
          "locale": "en",
          "width": "100%",
          "height": "100%"
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

  }, [symbol, theme]);

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

export default CompanyProfileWidget;
