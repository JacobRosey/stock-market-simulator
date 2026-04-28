import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useWebSocket } from '../../context/WebSocketContext'
import './portfolio.css'
import Headlines from './dashboard-components/headlines'


export default function Portfolio() {
    const { logout } = useAuth();
    const { portfolio, portfolioLoading } = useWebSocket();

    const positions = portfolio?.positions ?? [];
    const cash = portfolio?.cash ?? 0;

  const handleLogout = async () => {
    await logout()
  }

  const totalValue = cash + positions.reduce((sum, pos) => sum + pos.currentValue, 0)
  const totalGainLoss = positions.reduce((sum, pos) => sum + pos.gainLoss, 0)
  const totalGainLossPercent = totalValue > 0 ? (totalGainLoss / (totalValue - totalGainLoss)) * 100 : 0

  if (portfolioLoading) {
    return (
      <div className="dashboard-container">
        <nav className="top-nav">
          <h1 className="title">Paper Trader</h1>
          <Link to="/orders">View Orders</Link>
          <Link to="/">Back to Trading</Link>
          <button onClick={handleLogout}>Logout</button>
        </nav>
        <div className="headlines-banner">
          <Headlines />
        </div>
        <div className="portfolio-loading">Loading portfolio...</div>
      </div>
    )
  }

  return (
    <div className="portfolio-container">
      <nav className="top-nav">
        <h1 className="title">Paper Trader</h1>
        <Link to="/orders">View Orders</Link>
        <Link to="/">Back to Trading</Link>
        <button onClick={handleLogout}>Logout</button>
      </nav>

      <div className="headlines-banner">
        <Headlines />
      </div>

      {/* Portfolio Content */}
      <div className="portfolio-content">
        {/* Summary Cards */}
        <div className="portfolio-summary">
          <div className="summary-card">
            <div className="summary-label">Cash Balance</div>
            <div className="summary-value">${cash.toFixed(2)}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Portfolio Value</div>
            <div className="summary-value">${(totalValue - cash).toFixed(2)}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Total Value</div>
            <div className="summary-value">${totalValue.toFixed(2)}</div>
          </div>
          <div className={`summary-card ${totalGainLoss >= 0 ? 'positive' : 'negative'}`}>
            <div className="summary-label">Total P&L</div>
            <div className="summary-value">
              ${totalGainLoss.toFixed(2)}
              <span className="percent">
                ({totalGainLoss >= 0 ? '+' : ''}{totalGainLossPercent.toFixed(2)}%)
              </span>
            </div>
          </div>
        </div>

        <div className="holdings-table-container">
          <h2>Your Holdings</h2>
          <table className="holdings-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Shares</th>
                <th>Avg Price</th>
                <th>Cost Basis</th>
                <th>Current Price</th>
                <th>Current Value</th>
                <th>Gain/Loss</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="no-holdings">
                    You don't own any stocks yet.
                    <Link to="/">Start trading!</Link>
                  </td>
                </tr>
              ) : (
                positions.map(position => (
                  <tr key={position.ticker}>
                    <td className="ticker-cell">{position.ticker}</td>
                    <td>{position.shares}</td>
                    <td>${position.averagePrice.toFixed(2)}</td>
                    <td>${position.totalCost.toFixed(2)}</td>
                    <td>${position.currentPrice.toFixed(2)}</td>
                    <td>${position.currentValue.toFixed(2)}</td>
                    <td className={position.gainLoss >= 0 ? 'positive' : 'negative'}>
                      ${position.gainLoss.toFixed(2)}
                      <span className="percent">
                        ({position.gainLoss >= 0 ? '+' : ''}{position.gainLossPercent.toFixed(2)}%)
                      </span>
                    </td>
                    <td>
                      <Link to={`/?ticker=${position.ticker}`} className="trade-link">
                        Trade
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
