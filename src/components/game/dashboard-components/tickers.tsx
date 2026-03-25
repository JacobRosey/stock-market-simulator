import { useState, useEffect } from 'react';
import { type Ticker } from '../../../types'
import { fetchStocks } from '../../../api'
import './tickers.css'

interface Stock {
    ticker: Ticker;
    name: string;
    sector: string;
    description: string;
    price: number;
}

interface GroupedStocks {
    [sector: string]: Stock[];
}

interface TickerSelectorProps {
    selectedTicker: Ticker;
    onSelectTicker: (ticker: Ticker) => void;
}

export default function TickerSelector({ selectedTicker, onSelectTicker }: TickerSelectorProps) {
    const [groupedBySector, setGroupedBySector] = useState<GroupedStocks>({});

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

    return (
    <div className="ticker-selector">
        {Object.entries(groupedBySector).map(([sector, stocks]) => (
            <div key={sector} className="sector-group">
                <h4 className="sector-title">{sector}</h4>
                <div className="sector-buttons">
                    {stocks.map((stock) => (
                        <button
                            key={stock.ticker}
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