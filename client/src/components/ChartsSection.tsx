import React, { useState, useEffect } from 'react';
import DXChartWidget from './DXChartWidget';

const ChartsSection: React.FC = () => {
  const [symbol, setSymbol] = useState<string>('');
  const [inputValue, setInputValue] = useState<string>('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      setSymbol(inputValue.trim().toUpperCase());
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#14130e] text-[#eae9e9] overflow-hidden">
      {/* Minimal Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#2a2820] bg-[#1e1e1e]">
        <div className="flex items-center space-x-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#969696]">Chart Analysis</h2>
          {symbol && (
            <div className="flex items-center space-x-2 px-3 py-1 bg-[#2d2d30] rounded text-xs">
              <span className="font-bold text-[#eae9e9]">{symbol}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#4ec9b0] animate-pulse"></span>
            </div>
          )}
        </div>
        
        <form onSubmit={handleSearch} className="flex items-center space-x-2">
          <div className="relative">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="SYMBOL"
              className="w-32 px-3 py-1.5 bg-[#0f0e0a] border border-[#2a2820] rounded text-xs text-[#eae9e9] placeholder-[#505050] focus:outline-none focus:border-[#4ec9b0] uppercase font-mono transition-colors"
            />
            <button 
              type="submit"
              className="absolute right-1 top-1/2 transform -translate-y-1/2 p-1 text-[#969696] hover:text-[#eae9e9]"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </form>
      </div>

      {/* Main Content */}
      <div className="flex-1 relative">
        {symbol ? (
          <DXChartWidget symbol={symbol} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[#14130e]">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-[#1e1e1e] flex items-center justify-center border border-[#2a2820]">
                <svg className="w-8 h-8 text-[#505050]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                </svg>
              </div>
              <p className="text-sm text-[#969696] font-light tracking-wide">ENTER SYMBOL TO LOAD CHART</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChartsSection;
