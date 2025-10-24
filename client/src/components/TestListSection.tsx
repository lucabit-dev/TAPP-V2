import React from 'react';
import ToplistWidget from './ToplistWidget';

const TestListSection: React.FC = () => {
  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      {/* Header */}
      <div className="p-4 border-b border-[#3e3e42] bg-[#252526]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#cccccc]">Test List</h1>
            <p className="text-sm text-[#969696] mt-1">
              Real-time stock data from ChartsWatcher Toplist
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <div className="text-xs text-[#808080]">Config ID</div>
              <div className="text-sm font-mono text-[#cccccc]">68a9bbebb2c5294077710db4</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4">
        <ToplistWidget
          height="100%"
          theme="dark"
          showHeader={false}
        />
      </div>
    </div>
  );
};

export default TestListSection;


