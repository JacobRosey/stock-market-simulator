// websocket-context.jsx
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import type {
    Order,
    Portfolio,
    PriceUpdate,
    NewsData,
    WebSocketContextValue,
    Ticker,
    OrderDepth,
    OrderType,
    OrderSide
} from '../types';

import { useAuth } from './AuthContext';
import { fetchPortfolio, getOrderData } from '../api';

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export const WebSocketProvider = () => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [prices, setPrices] = useState<Record<string, number>>({});
    const [userOrders, setUserOrders] = useState<Order[]>([]);
    const [ordersLoading, setOrdersLoading] = useState(true)
    const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
    const [latestNews, setLatestNews] = useState<NewsData | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);

    const [depthData, setDepthData] = useState<Record<string, OrderDepth>>({}); // Store depth per ticker

    const { user, loading } = useAuth();

    useEffect(() => {
        if (!user?.user_id || loading) return;

        const loadInitialOrders = async () => {
            try {
                const data = await getOrderData();
                setUserOrders(data.orders || []);
            } finally {
                setOrdersLoading(false);
            }
        };

        loadInitialOrders();
    }, [user?.user_id, loading])

    useEffect(() => {

        console.log("Websocket Provider Mounted")

        console.log("WebSocket effect running", {
            loading,
            hasUser: !!user,
            userId: user?.user_id
        });

        if (loading) {
            console.log("Still loading auth, waiting...");
            return;
        }

        if (!user?.user_id) {
            console.log("No user ID available");
            return;
        }

        const newSocket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:8080', {
            transports: ['websocket', 'polling'], //fallback to polling
            reconnectionAttempts: 5
        });

        newSocket.on('connect', () => {
            setIsConnected(true);
            newSocket.emit('register', user.user_id);

        });

        // Update orderbook data
        newSocket.on('depth', (data: OrderDepth & { ticker: string }) => {

            console.log("Received depth snapshot")

            setDepthData(prev => {
                const newState = {
                    ...prev,
                    [data.ticker]: data
                };
                return newState;
            });
            setPrices(prev => {
                const newPrice = {
                    ...prev,
                    [data.ticker]: data.lastPrice
                }
                return newPrice;
            });
            //setLastMessageAt(Date.now());
        });

        newSocket.on('connect_error', (error) => {
            console.log('Connection error:', error.message);
            setIsConnected(false);
        });

        newSocket.on('CANCEL_UPDATE', (data) => {
            console.log(data)
            // Update the cancelled order - this just removes it

            // setUserOrders(prev => prev.filter(order => order.orderId !== data.orderId));
        })

        newSocket.on('ORDER_FILLED', (data: Order) => {

            console.log("Order fill data in websocket context: ", data)
            console.log('Filled quantity: ', data.filledQuantity)
            console.log("filled price: ", data.filledPrice)
            setUserOrders(prev => prev.map(order =>
                order.orderId === data.orderId
                    ? {
                        ...order,
                        filledQuantity: data.filledQuantity + order.filledQuantity,
                        remainingQuantity: data.remainingQuantity,
                        status: data.remainingQuantity === 0 ? 'FILLED' : 'PARTIALLY_FILLED',
                        updatedAt: new Date().toISOString()
                    }
                    : order
            ));

            // toast message should be shown to client on order fill (and cancellation status - any non-immediate update that may or may not occur in the future)

            // send message saying "Order for x of ticker y (partially if remaining > 0) filled with z quantity at price: "
            // or something to that effect

        });

        newSocket.on('PORTFOLIO_UPDATE', (data: Portfolio) => {
            setPortfolio(data);
            //setLastMessageAt(Date.now());
        });

        setSocket(newSocket);

        return () => {
            console.log("Websocket Provider unmounted")
            setIsConnected(false);
            newSocket.close();
        };
    }, [user?.user_id, loading]);


    const subscribeToTicker = useCallback((ticker: Ticker) => {
        if (socket) {
            console.log('Context subscribing to:', ticker);
            socket.emit('subscribe', ticker);
        }
    }, [socket]);

    const attemptOrderCancellation = useCallback((orderId: Number, ticker: Ticker, type: OrderType, side: OrderSide) => {
        // Backend uses socketId to get userId which is used to verify that this cancel request
        // is actually coming from the person who submitted the order
        if (socket) {
            console.log(`Attemping to cancel order ${orderId} `)
            socket.emit('cancel-order', { orderId, ticker, type, side })
        }
    }, [socket])

    const addOrder = useCallback(async (order: Order) => {
        setUserOrders(prev => [order, ...prev]);
    }, []);

    const getDepthForTicker = useCallback((ticker: Ticker) => {
        return depthData[ticker];
    }, [depthData]);

    return (
        <WebSocketContext.Provider value={{
            prices,
            userOrders,
            ordersLoading,
            latestNews,
            portfolio,
            isConnected,
            lastMessageAt,
            addOrder,
            subscribeToTicker,
            getDepthForTicker,
            attemptOrderCancellation
        }}>
            <Outlet />
        </WebSocketContext.Provider>
    );
};

export const useWebSocket = () => {
    const context = useContext(WebSocketContext);
    if (!context) {
        throw new Error('useWebSocket must be used within WebSocketProvider');
    }
    return context;
};