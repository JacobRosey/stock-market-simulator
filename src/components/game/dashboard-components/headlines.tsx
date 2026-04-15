import { useMemo, useState, useEffect } from 'react';
import { useWebSocket } from '../../../context/WebSocketContext';
import './headlines.css';

export default function Headlines() {
  const { latestNews } = useWebSocket();
  const [now, setNow] = useState(Date.now());

  // Update "now" every second
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer); // Cleanup on unmount
  }, []);

  // Calculate seconds elapsed
  const secondsAgo = useMemo(() => {
    if (!latestNews?.timestamp) return null;
    const elapsed = Math.floor((now - latestNews.timestamp) / 1000);
    return elapsed < 0 ? 0 : elapsed; 
  }, [latestNews, now]);

  const subtitle = useMemo(() => {
    if (!latestNews) return 'Waiting for next market headline...';
    
    // Create the timer string
    const timeString = secondsAgo !== null ? `(${secondsAgo}s ago) ` : '';
    
    let context = 'Company update';
    if (latestNews.isStimulus) context = 'Stimulus event';
    else if (latestNews.global) context = 'Global market update';
    else if (latestNews.affectedTickers?.length) {
      context = `Impacts: ${latestNews.affectedTickers.join(', ')}`;
    } else if (latestNews.affectedSectors?.length) {
      const label = latestNews.affectedSectors.length > 1 ? 'Sectors' : 'Sector';
      context = `${label}: ${latestNews.affectedSectors.join(', ')}`;
    }

    return `${timeString}${context}`;
  }, [latestNews, secondsAgo]);

  return (
    <div className="headlines-content">
      <div className="headlines-header">
        <span className="headlines-title">Market Wire</span>
      </div>
      <span className="headlines-text">
        {latestNews?.headline ?? 'No breaking news yet.'}
      </span>
      <span className="headlines-subtext">{subtitle}</span>
    </div>
  );
}
