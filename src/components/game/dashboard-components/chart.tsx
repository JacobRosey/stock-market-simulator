import { useEffect, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchPriceHistory } from '../../../api';
import { useWebSocket } from '../../../context/WebSocketContext';
import type { Ticker } from '../../../types';
import './chart.css';

interface ChartProps {
  ticker: Ticker;
}
interface PricePoint {
  timestamp: string;
  price: number;
}

export default function Chart({ ticker }: ChartProps) {
  const { prices } = useWebSocket();
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [showInfo, setShowInfo] = useState(false);
  const [range, setRange] = useState('1m');
  const ranges = ['1m', '5m', '1h', '1d', '1w'];

  const getIntervalMs = (range: string) => {
    switch (range) {
      case '1m': return 1000;      // 1 second
      case '5m': return 5000;       // 5 seconds
      case '1h': return 60000;      // 1 minute
      case '1d': return 300000;     // 5 minutes
      case '1w': return 3600000;    // 1 hour
      default: return 1000;
    }
  };

  const getMaxPoints = (range: string) => {
    switch (range) {
      case '1m': return 60;         // 60 seconds
      case '5m': return 60;         // 60 5-second intervals = 5 minutes
      case '1h': return 60;         // 60 minutes
      case '1d': return 288;        // 288 5-minute intervals
      case '1w': return 168;        // 168 hours
      default: return 60;
    }
  };

  const [stats, setStats] = useState({
    name: "",
    description: "",
    current: 0,
    open: 0,
    high: 0,
    low: 0,
    previousClose: 0
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    fetchPriceHistory(ticker, range).then(data => {
      setHistory(data.chart);
      setStats({
        name: data.name,
        description: data.description,
        current: data.current,
        open: data.open,
        high: data.high,
        low: data.low,
        previousClose: data.previousClose
      });
      setLoading(false);
    });
  }, [ticker, range]);

  // Ref to always have the latest price without causing useEffect re-renders
  const latestPriceRef = useRef<number | null>(null);

  // Update the ref whenever a new websocket price arrives
  useEffect(() => {
    const newPrice = prices?.[ticker];
    if (!newPrice) return;
    latestPriceRef.current = newPrice;
    setStats(prev => ({ ...prev, current: newPrice }));
  }, [prices, ticker]);

  // Interval-driven chart updates — runs on a fixed tick regardless of websocket communication
  useEffect(() => {
    const intervalMs = getIntervalMs(range);
    const maxPoints = getMaxPoints(range);
    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
        setHistory(prev => {
            if (prev.length === 0) return prev;

            const lastPoint = prev[prev.length - 1];
            const price = latestPriceRef.current ?? lastPoint.price;

            const newPoint: PricePoint = {
                timestamp: new Date().toISOString(),
                price,
            };

            return [...prev, newPoint].slice(-maxPoints);
        });

        // Schedule next tick 
        const now = Date.now();
        const nextTick = intervalMs - (now % intervalMs);
        timeoutId = setTimeout(tick, nextTick);
    };

    const now = Date.now();
    const firstTick = intervalMs - (now % intervalMs);
    timeoutId = setTimeout(tick, firstTick);

    return () => clearTimeout(timeoutId);
}, [range]); 

  const formatXAxis = (timestamp: string) => {
    const date = new Date(timestamp);
    switch (range) {
      case '1m':
      case '5m':
        return date.toLocaleTimeString('en-US', {
          minute: '2-digit',
          second: '2-digit'
        });
      case '1h':
        return date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit'
        });
      case '1d':
      case '1w':
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      default:
        return date.toLocaleDateString();
    }
  };

  const currentPrice = prices?.[ticker] ?? stats?.current ?? 0;


  const formattedPrice = Number(currentPrice).toFixed(2);
  const change = currentPrice - stats.previousClose;
  const changePercent = (change / stats.previousClose) * 100;
  const isPositive = change >= 0;

  if (loading) return <div className="chart-loading">Loading chart...</div>;

  return (
    <div className="stock-chart-container">
      {/* Header section */}
      <div className="chart-header">
        {/* Left: Ticker and info */}
        <div className="header-left">
          <div className="ticker-section">
            <h2>{ticker}</h2>
            <div className="info-icon-container">
              <span
                className="info-icon"
                onClick={() => setShowInfo(!showInfo)}
              >
                ?
              </span>
              {showInfo && (
                <div className="company-info-panel">
                  {stats.name}: {stats.description || 'No description available'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 
            Not gonna need open or previous close, figure out some better stats to put there
            volume? P/E? High/low needs to be changed to use the min/max within current price history timeframe
          */
        }
        <div className="daily-stats">
          <div className="stat">
            <span className="stat-label">Open</span>
            <span className="stat-value">${stats.open}</span>
          </div>
          <div className="stat">
            <span className="stat-label">High</span>
            <span className="stat-value">${stats.high}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Low</span>
            <span className="stat-value">${stats.low}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Prev Close</span>
            <span className="stat-value">${stats.previousClose}</span>
          </div>
        </div>

        <div className="price-info">
          <div className="current-price">${formattedPrice}</div>
          <div className={`price-change ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '+' : ''}{change.toFixed(2)} ({isPositive ? '+' : ''}{changePercent.toFixed(2)}%)
          </div>
        </div>
      </div>

      <div className="chart-graphic">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={history}>
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatXAxis}
            />
            <YAxis
              domain={['auto', 'auto']}
              tickFormatter={(price: number) => `$${price}`}
            />
            <Tooltip
              labelFormatter={(ts: any) => new Date(ts).toLocaleString()}
              formatter={(price: any) => [`$${price}`, 'Price']}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke="#8884d8"
              dot={false}
              isAnimationActive={true}
              animationDuration={300}
            />
          </LineChart>
        </ResponsiveContainer>
        <div className="range-selector">
          {ranges.map(r => (
            <button
              key={r}
              className={range === r ? 'active' : ''}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
