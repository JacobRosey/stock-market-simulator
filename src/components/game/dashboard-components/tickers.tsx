import { useMemo, useState, useEffect } from 'react';
import { type Stock, type Ticker } from '../../../types'
import { fetchStocks } from '../../../api'
import { useWebSocket } from '../../../context/WebSocketContext';
import './tickers.css'

interface GroupedStocks {
    [sector: string]: Stock[];
}

interface TickerSelectorProps {
    selectedTicker: Ticker;
    onSelectTicker: (ticker: Ticker) => void;
}

export default function TickerSelector({ selectedTicker, onSelectTicker }: TickerSelectorProps) {
    const [groupedBySector, setGroupedBySector] = useState<GroupedStocks>({});
    const { latestNews } = useWebSocket();

    const newsImpact = useMemo(() => {
        const direction = (latestNews?.sentiment ?? 0) > 0
            ? 'positive'
            : (latestNews?.sentiment ?? 0) < 0
                ? 'negative'
                : null;

        return {
            direction,
            affectedTickers: new Set(latestNews?.affectedTickers ?? []),
            affectedSectors: new Set<string>(latestNews?.affectedSectors ?? []),
            isGlobal: Boolean(latestNews?.global && direction),
            timestamp: latestNews?.timestamp ?? 'idle',
        };
    }, [latestNews]);

    useEffect(() => {
        fetchStocks().then((data: Stock[]) => {
            // Group by sector
            const grouped = data.reduce<GroupedStocks>((acc, stock) => {
                if (!acc[stock.sector]) {
                    acc[stock.sector] = [];
                }
                acc[stock.sector].push(stock);
                return acc;
            }, {});
            setGroupedBySector(grouped);
        });
    }, []);

    const selectorClasses = [
        'ticker-selector',
        newsImpact.isGlobal && newsImpact.direction ? `global-impact-${newsImpact.direction}` : '',
    ].filter(Boolean).join(' ');

    return (
    <div key={newsImpact.timestamp} className={selectorClasses}>
        {Object.entries(groupedBySector).map(([sector, stocks]) => (
            <div
                key={sector}
                className={[
                    'sector-group',
                    !newsImpact.isGlobal && newsImpact.direction && newsImpact.affectedSectors.has(sector)
                        ? `sector-impact-${newsImpact.direction}`
                        : '',
                ].filter(Boolean).join(' ')}
            >
                <h4 className="sector-title">{sector}</h4>
                <div className="sector-buttons">
                    {stocks.map((stock) => {
                        const tickerImpactClass = newsImpact.direction && newsImpact.affectedTickers.has(stock.ticker)
                            ? `news-impact-${newsImpact.direction}`
                            : '';

                        return (
                            <button
                                key={stock.ticker}
                                onClick={() => onSelectTicker(stock.ticker)}
                                className={[
                                    selectedTicker === stock.ticker ? 'active' : '',
                                    tickerImpactClass,
                                ].filter(Boolean).join(' ')}
                            >
                                {stock.ticker}
                            </button>
                        );
                    })}
                </div>
            </div>
        ))}
    </div>
);
}
