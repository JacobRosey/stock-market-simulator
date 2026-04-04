import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useWebSocket } from '../../context/WebSocketContext.tsx';
import type { OrderSide, OrderType, Ticker } from '../../types'; 
import './orders.css';

export default function Orders() {
    const { logout } = useAuth();
    const { attemptOrderCancellation, userOrders, ordersLoading } = useWebSocket();

    if (ordersLoading) return <div>Loading...</div>;

    const cancelOrder = async (orderId: number, ticker: Ticker, type: OrderType, side: OrderSide) => {
        attemptOrderCancellation(orderId, ticker, type, side);
    };
    const handleLogout = async () => {
        await logout();
    };

    console.log("user orders in orders.tsx: ", userOrders);

    if (ordersLoading) return <div>Loading...</div>;

    return (
        <div className="orders-container">
            <nav className="top-nav">
                <h1 className="title">Paper Trader</h1>
                <Link to="/">Back to Trading</Link>
                <Link to="/portfolio">View Portfolio</Link>
                <button onClick={handleLogout}>Logout</button>
            </nav>

            <div className="open-orders">
                <h2>Open Orders</h2>
                {userOrders.length === 0 ? (
                    <p>No open orders</p>
                ) : (
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Ticker</th>
                                    <th>Side</th>
                                    <th>Price</th>
                                    <th>Ordered</th>
                                    <th>Filled</th>
                                    <th>Status</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {userOrders.map(order => (
                                    <tr key={order.orderId.toString()}>
                                        <td>{order.ticker}</td>
                                        <td className={order.side.toLowerCase()}>
                                            {order.side}
                                        </td>
                                        <td>{order.price || 'Market'}</td>
                                        <td>{order.quantity}</td>
                                        <td>{order.filledQuantity}</td>
                                        <td>{order.status}</td>
                                        <td>
                                            <button 
                                                onClick={() => cancelOrder(order.orderId, order.ticker, order.type, order.side)}
                                                className="cancel-btn"
                                            >
                                                Cancel
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}