// websocket-context.jsx
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import type {
    Order,
    Portfolio,
    NewsData,
    WebSocketContextValue,
    Ticker,
    OrderDepth,
    OrderType,
    OrderSide,
    PortfolioUpdate,
    OrderFillUpdate,
    OrderRejectionUpdate,
    ToastMessage,
} from '../types';

import { useAuth } from './AuthContext';
import { fetchPortfolio, getOrderData } from '../api';
import ToastMessages from '../components/game/toast';

const WebSocketContext = createContext<WebSocketContextValue | null>(null);
const MIN_TOAST_VISIBLE_MS = 3000;

export const WebSocketProvider = () => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [prices, setPrices] = useState<Record<string, number>>({});
    const [userOrders, setUserOrders] = useState<Order[]>([]);
    const [ordersLoading, setOrdersLoading] = useState(true)
    const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
    const [latestNews, setLatestNews] = useState<NewsData | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);

    const [depthData, setDepthData] = useState<Record<string, OrderDepth>>({});

    const { user, loading } = useAuth();
    const [portfolioLoading, setPortfolioLoading] = useState(true);

    const [toast, setToast] = useState<ToastMessage | null>(null);
    const toastShownAtRef = useRef<number | null>(null);
    const currentToastRef = useRef<ToastMessage | null>(null);
    const queuedToastsRef = useRef<ToastMessage[]>([]);
    const queuedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((message: ToastMessage) => {
        currentToastRef.current = message;
        toastShownAtRef.current = Date.now();
        setToast(message);
    }, []);

    const scheduleQueuedToastDrain = useCallback(() => {
        if (queuedToastTimerRef.current || !currentToastRef.current || queuedToastsRef.current.length === 0) {
            return;
        }

        const elapsed = Date.now() - (toastShownAtRef.current ?? Date.now());
        const delay = Math.max(0, MIN_TOAST_VISIBLE_MS - elapsed);

        queuedToastTimerRef.current = setTimeout(() => {
            queuedToastTimerRef.current = null;
            const nextToast = queuedToastsRef.current.shift();
            if (!nextToast) return;

            showToast(nextToast);
            scheduleQueuedToastDrain();
        }, delay);
    }, [showToast]);

    const enqueueToast = useCallback((message: ToastMessage) => {
        if (!currentToastRef.current) {
            showToast(message);
            return;
        }

        queuedToastsRef.current.push(message);
        scheduleQueuedToastDrain();
    }, [scheduleQueuedToastDrain, showToast]);

    const clearToast = useCallback(() => {
        if (queuedToastTimerRef.current) {
            clearTimeout(queuedToastTimerRef.current);
            queuedToastTimerRef.current = null;
        }

        const nextToast = queuedToastsRef.current.shift();
        if (nextToast) {
            showToast(nextToast);
            scheduleQueuedToastDrain();
            return;
        }

        currentToastRef.current = null;
        toastShownAtRef.current = null;
        setToast(null);
    }, [scheduleQueuedToastDrain, showToast]);

    useEffect(() => {
        return () => {
            if (queuedToastTimerRef.current) {
                clearTimeout(queuedToastTimerRef.current);
            }
        };
    }, []);

    function applyPortfolioUpdate(prev: Portfolio, update: PortfolioUpdate, prices: Record<string, number>): Portfolio {
        const updatedPositions = prev.positions
            .map(p => {
                const delta = update.positions[p.ticker];
                if (!delta) return p;

                const newShares = p.shares + delta.sharesDelta;
                const newCost = p.totalCost + delta.costDelta;
                const currentPrice = prices[p.ticker] ?? p.currentPrice;
                const currentValue = newShares * currentPrice;

                return {
                    ...p,
                    shares: newShares,
                    totalCost: newCost,
                    averagePrice: newCost / newShares,
                    currentPrice,
                    currentValue,
                    gainLoss: currentValue - newCost,
                    gainLossPercent: (currentValue - newCost) / newCost * 100,
                };
            })
            .filter(p => p.shares > 0);

        // Handle new positions (buying something not previously held)
        for (const [ticker, delta] of Object.entries(update.positions)) {
            if (delta.sharesDelta > 0 && !prev.positions.find(p => p.ticker === ticker)) {
                const currentPrice = prices[ticker] ?? 0;
                const currentValue = delta.sharesDelta * currentPrice;
                updatedPositions.push({
                    ticker,
                    shares: delta.sharesDelta,
                    totalCost: delta.costDelta,
                    averagePrice: delta.costDelta / delta.sharesDelta,
                    currentPrice,
                    currentValue,
                    gainLoss: currentValue - delta.costDelta,
                    gainLossPercent: (currentValue - delta.costDelta) / delta.costDelta * 100,
                });
            }
        }

        return {
            ...prev,
            cash: prev.cash + update.cashDelta,
            positions: updatedPositions,
        };
    }

    // Load initial user data on component mount
    useEffect(() => {
        if (!user?.user_id || loading) return;

        const loadInitialData = async () => {
            try {
                const [ordersData, portfolioData] = await Promise.all([
                    getOrderData(),
                    fetchPortfolio()
                ]);
                setUserOrders(ordersData.orders || []);
                setPortfolio(portfolioData);
            } finally {
                setOrdersLoading(false);
                setPortfolioLoading(false);
            }
        };

        loadInitialData();
    }, [user?.user_id, loading]);

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

        newSocket.on('ORDER_PLACED', (newOrder: Order) => {
            setUserOrders(prev => [newOrder, ...prev]);
        });

        newSocket.on('ORDER_FILLED', (data: OrderFillUpdate) => {
            const filledQuantity = data.filledQuantity;

            setUserOrders(prev => prev.map(order =>
                order.orderId === data.orderId
                    ? {
                        ...order,
                        filledQuantity: order.filledQuantity + filledQuantity,
                        remainingQuantity: data.remainingQuantity,
                        status: data.remainingQuantity == 0 ? "FILLED" : "PARTIALLY_FILLED",
                        updatedAt: new Date().toISOString()
                    }
                    : order
            ));

            const toastPayload: OrderFillUpdate = {
                ...data,
                filledQuantity,
                status: data.remainingQuantity > 0 ? 'PARTIALLY_FILLED' : 'FILLED',
            };
            enqueueToast(toastPayload);

        });

        newSocket.on('ORDER_REJECTED', (data: OrderRejectionUpdate) => {
            setUserOrders(prev => prev.map(order =>
                order.orderId === data.orderId
                    ? {
                        ...order,
                        remainingQuantity: data.rejectedQuantity,
                        status: 'REJECTED',
                        updatedAt: new Date().toISOString()
                    }
                    : order
            ));

            setTimeout(() => {
                enqueueToast({
                    ...data,
                    status: 'REJECTED',
                });
            }, 50); // small delay to let fill toast appear first
        });

        newSocket.on('PORTFOLIO_UPDATE', (update: PortfolioUpdate) => {
            setPortfolio(prev => {
                if (!prev) return prev;
                return applyPortfolioUpdate(prev, update, prices);
            });
        });

        setSocket(newSocket);

        return () => {
            console.log("Websocket Provider unmounted")
            setIsConnected(false);
            newSocket.close();
        };
    }, [user?.user_id, loading, enqueueToast]);


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
            portfolioLoading,
            toast,
            clearToast,
            addOrder,
            subscribeToTicker,
            getDepthForTicker,
            attemptOrderCancellation
        }}>
            <ToastMessages />
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
