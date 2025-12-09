import React, { useEffect, useState } from 'react';
import { LineChart, Line, YAxis, ResponsiveContainer, XAxis, Tooltip } from 'recharts';

interface StockChartProps {
  ticker: string;
  height?: number;
  color?: string;
}

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const StockChart: React.FC<StockChartProps> = ({ ticker, height = 100, color = '#4ade80' }) => {
  const [data, setData] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Fetch last 60 minutes
        const res = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/history/${ticker}?limit=60`);
        const result = await res.json();
        
        if (result.success && Array.isArray(result.data)) {
          setData(result.data);
        } else {
          setError('No data');
        }
      } catch (err) {
        setError('Error loading chart');
      } finally {
        setLoading(false);
      }
    };

    if (ticker) {
      fetchData();
    }
  }, [ticker]);

  if (loading) return <div className="animate-pulse h-full w-full bg-[#2a2820]/30 rounded"></div>;
  if (error || data.length === 0) return <div className="text-[10px] opacity-40 flex items-center justify-center h-full">No chart data</div>;

  // Calculate min/max for Y-axis domain
  const prices = data.map(d => d.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const padding = (max - min) * 0.1;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis 
            dataKey="timestamp" 
            hide={true} 
          />
          <YAxis 
            domain={[min - padding, max + padding]} 
            hide={true} 
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#0f0e0a', border: '1px solid #2a2820', borderRadius: '4px', fontSize: '10px' }}
            itemStyle={{ color: '#eae9e9' }}
            labelStyle={{ display: 'none' }}
            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
          />
          <Line 
            type="monotone" 
            dataKey="close" 
            stroke={color} 
            strokeWidth={1.5} 
            dot={false} 
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default StockChart;
