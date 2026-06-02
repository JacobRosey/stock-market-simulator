import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useState, useEffect } from 'react'
import Leaderboard from './dashboard-components/leaderboard'
import Chart from './dashboard-components/chart'
import OrderBook from './dashboard-components/orderbook'
import Headlines from './dashboard-components/headlines'
import TickerSelector from './dashboard-components/tickers'

import { TICKERS, type Ticker } from '../../types'

import './dashboard.css'
import { useSearchParams } from 'react-router-dom';


export default function Dashboard() {
    const [searchParams] = useSearchParams();
    const tickerFromUrl = searchParams.get('ticker');

    const { logout } = useAuth()

     // Validate that the URL ticker is actually a valid Ticker
    const initialTicker = (tickerFromUrl && TICKERS.includes(tickerFromUrl as Ticker)) 
        ? tickerFromUrl as Ticker 
        : "AGB";
    
    const [selectedTicker, setSelectedTicker] = useState<Ticker>(initialTicker);

    // Update if URL changes to a valid ticker
    useEffect(() => {
        if (tickerFromUrl && TICKERS.includes(tickerFromUrl as Ticker)) {
            setSelectedTicker(tickerFromUrl as Ticker);
        }
    }, [tickerFromUrl]);

    const handleLogout = async () => {
        await logout()
    }

    return (
        <div className="dashboard-container">
            <nav className="top-nav">
                <h1 className="title">Paper Trader</h1>
                <Link to="/orders">View Orders</Link>
                <Link to="/portfolio">View Portfolio</Link>
                <button onClick={handleLogout}>Logout</button>
            </nav>

            <div className="headlines-banner">
                <Headlines />
            </div>

            <div className="main-content">
                <div className="left-column">
                    <div className="chart-container">
                        <Chart ticker={selectedTicker} />
                    </div>
                    <div className="ticker-container">
                        <TickerSelector
                            selectedTicker={selectedTicker}
                            onSelectTicker={setSelectedTicker}
                        />
                    </div>
                </div>

                <section className="mobile-dashboard-tabs" aria-label="Dashboard panels">
                    <input
                        className="mobile-tab-input"
                        type="radio"
                        name="dashboard-mobile-panel"
                        id="mobile-tab-trade"
                        defaultChecked
                    />
                    <input
                        className="mobile-tab-input"
                        type="radio"
                        name="dashboard-mobile-panel"
                        id="mobile-tab-rankings"
                    />
                    <input
                        className="mobile-tab-input"
                        type="radio"
                        name="dashboard-mobile-panel"
                        id="mobile-tab-news"
                    />

                    <div className="mobile-tab-list" role="tablist" aria-label="Dashboard sections">
                        <label htmlFor="mobile-tab-trade" className="mobile-tab-label">Trade</label>
                        <label htmlFor="mobile-tab-rankings" className="mobile-tab-label">Rankings</label>
                        <label htmlFor="mobile-tab-news" className="mobile-tab-label">News</label>
                    </div>

                    <div className="mobile-tab-panels">
                        <div className="mobile-tab-panel trade-panel">
                            <div className="middle-column">
                                <OrderBook selectedTicker={selectedTicker} />
                            </div>
                        </div>

                        <div className="mobile-tab-panel rankings-panel">
                            <div className="right-column">
                                <Leaderboard />
                            </div>
                        </div>

                        <div className="mobile-tab-panel news-panel">
                            <div className="mobile-news-panel">
                                <Headlines />
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    )
}
