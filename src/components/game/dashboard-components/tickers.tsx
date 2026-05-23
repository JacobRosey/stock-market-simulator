import { useState, useEffect, useRef } from 'react';
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

const IMPACT_CLASSES = [
    'global-impact-positive',
    'global-impact-negative',
    'sector-impact-positive',
    'sector-impact-negative',
    'news-impact-positive',
    'news-impact-negative',
];

function clearImpactClasses(element: HTMLElement | null | undefined) {
    element?.classList.remove(...IMPACT_CLASSES);
}

function applyImpactClass(element: HTMLElement | null | undefined, className: string) {
    if (!element) return;

    clearImpactClasses(element);
    void element.offsetWidth;
    element.classList.add(className);
}

export default function TickerSelector({ selectedTicker, onSelectTicker }: TickerSelectorProps) {
    const [groupedBySector, setGroupedBySector] = useState<GroupedStocks>({});
    const { latestNews } = useWebSocket();
    const selectorRef = useRef<HTMLDivElement | null>(null);
    const sectorRefs = useRef(new Map<string, HTMLDivElement>());
    const tickerRefs = useRef(new Map<Ticker, HTMLButtonElement>());

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

    useEffect(() => {
        clearImpactClasses(selectorRef.current);
        sectorRefs.current.forEach(clearImpactClasses);
        tickerRefs.current.forEach(clearImpactClasses);

        const direction = (latestNews?.sentiment ?? 0) > 0
            ? 'positive'
            : (latestNews?.sentiment ?? 0) < 0
                ? 'negative'
                : null;

        if (!latestNews || !direction) return;

        if (latestNews.global) {
            applyImpactClass(selectorRef.current, `global-impact-${direction}`);
            return;
        }

        for (const sector of latestNews.affectedSectors ?? []) {
            applyImpactClass(sectorRefs.current.get(sector), `sector-impact-${direction}`);
        }

        for (const ticker of latestNews.affectedTickers ?? []) {
            applyImpactClass(tickerRefs.current.get(ticker), `news-impact-${direction}`);
        }

        return () => {
            clearImpactClasses(selectorRef.current);
            sectorRefs.current.forEach(clearImpactClasses);
            tickerRefs.current.forEach(clearImpactClasses);
        };
    }, [latestNews, groupedBySector]);

    return (
    <div ref={selectorRef} className="ticker-selector">
        {Object.entries(groupedBySector).map(([sector, stocks]) => (
            <div
                key={sector}
                ref={(element) => {
                    if (element) {
                        sectorRefs.current.set(sector, element);
                    } else {
                        sectorRefs.current.delete(sector);
                    }
                }}
                className="sector-group"
            >
                <h4 className="sector-title">{sector}</h4>
                <div className="sector-buttons">
                    {stocks.map((stock) => (
                        <button
                            key={stock.ticker}
                            ref={(element) => {
                                if (element) {
                                    tickerRefs.current.set(stock.ticker, element);
                                } else {
                                    tickerRefs.current.delete(stock.ticker);
                                }
                            }}
                            onClick={() => onSelectTicker(stock.ticker)}
                            className={selectedTicker === stock.ticker ? 'active' : ''}
                        >
                            {stock.ticker}
                        </button>
                    ))}
                </div>
            </div>
        ))}
    </div>
);
}
