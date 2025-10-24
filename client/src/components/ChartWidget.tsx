import React from 'react';
import TradingViewWidget from './TradingViewWidget';

interface ChartWidgetProps {
  symbol: string;
  interval: '1' | '5' | '15' | '30' | '60' | '240' | '1D' | '1W' | '1M';
  height?: number | string;
  theme?: 'light' | 'dark';
  hideSideToolbar?: boolean;
}

const ChartWidget: React.FC<ChartWidgetProps> = ({
  symbol,
  interval,
  height = 300,
  theme = 'light',
  hideSideToolbar = true,
}) => {

        return (
          <div className="chart-widget bg-[#252526] rounded-lg border border-[#3e3e42] overflow-hidden h-full">
      <div 
        className="h-full w-full"
        style={{ 
          height: typeof height === 'number' ? `${height}px` : height,
          width: '100%'
        }}
      >
        <TradingViewWidget
          symbol={symbol}
          interval={interval}
          height="100%"
          width="100%"
          theme={theme}
          hide_side_toolbar={hideSideToolbar}
          hide_top_toolbar={true}
        />
      </div>
    </div>
  );
};

export default ChartWidget;
