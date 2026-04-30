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
    LeaderboardEntry,
    EstimatedValueRange,
    VolumeUpdate,
} from '../types';

import { useAuth } from './AuthContext';
import { fetchLeaderboard, fetchPortfolio, getOrderData } from '../api';
import ToastMessages from '../components/game/toast';

const WebSocketContext = createContext<WebSocketContextValue | null>(null);
const MIN_TOAST_VISIBLE_MS = 3000;

export const WebSocketProvider = () => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [prices, setPrices] = useState<Record<string, number>>({});
    const pricesRef = useRef<Record<string, number>>({});
    const [userOrders, setUserOrders] = useState<Order[]>([]);
    const [ordersLoading, setOrdersLoading] = useState(true)
    const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [latestNews, setLatestNews] = useState<NewsData | null>(null);
    const [volume24hByTicker, setVolume24hByTicker] = useState<Partial<Record<Ticker, number>>>({});
    const [estimatedValues, setEstimatedValues] = useState<Partial<Record<Ticker, EstimatedValueRange>>>({});
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

    function applyPositionPrice(position: Portfolio['positions'][number], currentPrice: number) {
        const currentValue = position.shares * currentPrice;
        const gainLoss = currentValue - position.totalCost;

        return {
            ...position,
            currentPrice,
            currentValue,
            gainLoss,
            gainLossPercent: position.totalCost > 0 ? (gainLoss / position.totalCost) * 100 : 0,
        };
    }

    function applyPortfolioPrices(portfolio: Portfolio, latestPrices: Record<string, number>): Portfolio {
        return {
            ...portfolio,
            positions: portfolio.positions.map(position => {
                const currentPrice = latestPrices[position.ticker];
                return currentPrice > 0 ? applyPositionPrice(position, currentPrice) : position;
            }),
        };
    }

    function applyPortfolioUpdate(prev: Portfolio, update: PortfolioUpdate, prices: Record<string, number>): Portfolio {
        const updatedPositions = prev.positions
            .map(p => {
                const delta = update.positions[p.ticker];
                if (!delta) return p;

                const newShares = p.shares + delta.sharesDelta;
                const newCost = p.totalCost + delta.costDelta;
                const currentPrice = delta.currentPrice ?? prices[p.ticker] ?? p.currentPrice;
                const currentValue = newShares * currentPrice;

                return {
                    ...p,
                    shares: newShares,
                    totalCost: newCost,
                    averagePrice: newShares > 0 ? newCost / newShares : 0,
                    currentPrice,
                    currentValue,
                    gainLoss: currentValue - newCost,
                    gainLossPercent: newCost > 0 ? (currentValue - newCost) / newCost * 100 : 0,
                };
            })
            .filter(p => p.shares > 0);

        // Handle new positions (buying something not previously held)
        for (const [ticker, delta] of Object.entries(update.positions)) {
            if (delta.sharesDelta > 0 && !prev.positions.find(p => p.ticker === ticker)) {
                const currentPrice = delta.currentPrice ?? prices[ticker] ?? 0;
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
                const [ordersData, portfolioData, leaderboardData] = await Promise.all([
                    getOrderData(),
                    fetchPortfolio(),
                    fetchLeaderboard()
                ]);
                setUserOrders(ordersData.orders || []);
                setPortfolio(applyPortfolioPrices(portfolioData, pricesRef.current));
                setLeaderboard(leaderboardData);
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
                pricesRef.current = newPrice;
                return newPrice;
            });
            setPortfolio(prev => {
                if (!prev || data.lastPrice <= 0) return prev;

                return {
                    ...prev,
                    positions: prev.positions.map(position =>
                        position.ticker === data.ticker
                            ? applyPositionPrice(position, data.lastPrice)
                            : position
                    ),
                };
            });
            setLastMessageAt(Date.now());
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
                return applyPortfolioUpdate(prev, update, pricesRef.current);
            });
        });

        newSocket.on('VOLUME_UPDATE', (data: VolumeUpdate) => {
            setVolume24hByTicker(prev => ({
                ...prev,
                [data.ticker]: (prev[data.ticker] ?? 0) + data.volumeDelta,
            }));
            setLastMessageAt(Date.now());
        });

        newSocket.on('ESTIMATED_VALUE_UPDATE', (data: Partial<Record<Ticker, EstimatedValueRange>>) => {
            console.log(data)
            setEstimatedValues(prev => ({
                ...prev,
                ...data,
            }));
            setLastMessageAt(Date.now());
        });

        newSocket.on('LEADERBOARD_UPDATE', (data: LeaderboardEntry[] | { rankings: LeaderboardEntry[] }) => {
            const rankings = Array.isArray(data) ? data : data.rankings;
            setLeaderboard(rankings ?? []);
            setLastMessageAt(Date.now());
        });

        newSocket.on('NEWS', (data: NewsData) => {
            setLatestNews(data);
            setLastMessageAt(Date.now());
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
            leaderboard,
            latestNews,
            volume24hByTicker,
            estimatedValues,
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
