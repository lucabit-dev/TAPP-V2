import { useState } from 'react';
import AlertsSidebar from './AlertsSidebar';
import ChartWidget from './ChartWidget';
import SymbolInfoWidget from './SymbolInfoWidget';
import CompanyProfileWidget from './CompanyProfileWidget';

interface Alert {
  ticker: string;
  timestamp: string;
  price?: number;
  volume?: number;
  indicators: {
    ema1m18: number | null;
    ema1m200: number | null;
    ema5m18: number | null;
    ema5m200: number | null;
    macd1m: {
      macd: number;
      signal: number;
      histogram: number;
    } | null;
    macd5m: {
      macd: number;
      signal: number;
      histogram: number;
    } | null;
    vwap1m: number | null;
  };
  evaluation: {
    score: string;
    allConditionsMet: boolean;
    failedConditions?: Array<{
      name: string;
      expected: string;
      actual: string;
    }>;
  };
  lastCandle: {
    close: number;
    volume: number;
  } | null;
}

interface TradingDashboardProps {
  alerts: Alert[];
  loading?: boolean;
}

const TradingDashboard: React.FC<TradingDashboardProps> = ({
  alerts,
  loading = false
}) => {
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);

  const handleAlertSelect = (alert: Alert) => {
    setSelectedAlert(alert);
  };

  const validAlerts = alerts.filter(alert => alert.evaluation.allConditionsMet);

  return (
    <div className="trading-dashboard h-full flex bg-[#14130e] overflow-hidden">
      {/* Left Panel - TradingView Charts */}
      <div className="flex-1 flex flex-col p-4 min-w-0">
        {selectedAlert ? (
          <>
            {/* Top Row - Symbol Info and Company Profile - Larger for readability */}
            <div className="h-48 grid grid-cols-2 gap-4 mb-4">
                    {/* Symbol Info Widget */}
                    <div className="bg-[#14130e] rounded-lg border border-[#2a2820] overflow-hidden">
                      <SymbolInfoWidget
                        symbol={selectedAlert.ticker}
                        height="100%"
                        theme="dark"
                      />
                    </div>

                    {/* Company Profile Widget */}
                    <div className="bg-[#14130e] rounded-lg border border-[#2a2820] overflow-hidden">
                      <CompanyProfileWidget
                        symbol={selectedAlert.ticker}
                        height="100%"
                        theme="dark"
                      />
                    </div>
            </div>

            {/* Charts Section - Takes most of the space */}
            <div className="flex-1 flex flex-col gap-4 min-h-0">
              {/* Top Charts Row - Daily and 5m */}
              <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
                {/* Daily Chart - 1/3 width */}
                <div className="col-span-1 min-h-0">
                        <ChartWidget
                          symbol={selectedAlert.ticker}
                          interval="1D"
                          height="100%"
                          theme="dark"
                          hideSideToolbar={true}
                        />
                </div>

                {/* 5m Chart - 2/3 width */}
                <div className="col-span-2 min-h-0">
                  <ChartWidget
                    symbol={selectedAlert.ticker}
                    interval="5"
                    height="100%"
                    theme="dark"
                    hideSideToolbar={true}
                  />
                </div>
              </div>

              {/* Bottom Chart - 1m - Takes more space */}
              <div className="flex-1 min-h-0">
                <ChartWidget
                  symbol={selectedAlert.ticker}
                  interval="1"
                  height="100%"
                  theme="dark"
                  hideSideToolbar={true}
                />
              </div>
            </div>

          </>
        ) : (
          /* No Selection State */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#2d2d30] rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-[#808080]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-[#cccccc] mb-2">Select an Alert</h3>
              <p className="text-[#969696] mb-3 text-sm">
                Choose a valid trading signal from the sidebar to view detailed charts and analysis
              </p>
              <div className="text-xs text-[#808080]">
                {validAlerts.length > 0 
                  ? `${validAlerts.length} valid signals available`
                  : 'No valid signals available'
                }
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Alerts Sidebar */}
      <AlertsSidebar
        alerts={alerts}
        selectedAlert={selectedAlert}
        onAlertSelect={handleAlertSelect}
        loading={loading}
      />
    </div>
  );
};

export default TradingDashboard;
