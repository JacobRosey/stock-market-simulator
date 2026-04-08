// ===== STOCK TYPES =====
export type Sector = 'TECH' | 'FINANCE' | 'RETAIL' | 'MANUFACTURING' | 'PHARMA';

export type Ticker = 
    | 'NEXUS' | 'QCI' | 'CLSE' | 'NSMC'      // TECH
    | 'AGB' | 'CRC' | 'SGI' | 'FINT'          // FINANCE
    | 'MEGA' | 'TREND' | 'GLG' | 'CLICK'      // RETAIL
    | 'IDYN' | 'AUTO' | 'AERO' | 'GSYS'        // MANUFACTURING
    | 'GMED' | 'BIOV' | 'GENH' | 'NEURO';      // PHARMA

// Use const assertion to create a tuple of all tickers
export const TICKERS = [
    'NEXUS', 'QCI', 'CLSE', 'NSMC',
    'AGB', 'CRC', 'SGI', 'FINT',
    'MEGA', 'TREND', 'GLG', 'CLICK',
    'IDYN', 'AUTO', 'AERO', 'GSYS',
    'GMED', 'BIOV', 'GENH', 'NEURO'
] as const;

export interface Stock {
    ticker: Ticker;
    companyName: string;
    sector: Sector;
    description: string;
    currentPrice: number;
    initialPrice: number;
}

// Response from /api/stocks endpoint
export type StocksResponse = Stock[];

// ===== MARKET DATA TYPES =====
export interface PriceHistory {
    price: number;
    timestamp: string;  // ISO date string from backend
}

export interface PriceUpdate {
    ticker: Ticker;
    price: number;
    timestamp: number;
}

// ===== ORDER TYPES =====
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = "MARKET" | "LIMIT";
export type OrderStatus = 'OPEN' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'REJECTED';

export interface Order {
    orderId: number;
    userId: string;
    ticker: Ticker;
    side: OrderSide;
    type: OrderType;
    price: number | null;           // null for market orders
    quantity: number;               // original quantity
    filledQuantity: number;         // 0 for open orders
    remainingQuantity: number;      // quantity - filledQuantity; just needed on recovery to place correct # of shares to fill in matching engine
    status: OrderStatus;
    createdAt: string;
    updatedAt: string;
    estimatedAmount: number;
    filledPrice: number;             // total cost of filled portion
}

export interface OrderFillUpdate {
    orderId: number;
    filledQuantity: number;
    filledPrice: number;
    remainingQuantity: number;
    status: OrderStatus;
}

export interface OrderRequestData {
    ticker: Ticker;
    side: OrderSide;
    type: OrderType;
    price?: number;
    quantity: number;
}

interface DepthLevel {
    price: number;
    quantity: number;
}

export interface OrderDepth {
    bids: DepthLevel[];
    asks: DepthLevel[];   
    lastPrice: number; 
}

// ===== PORTFOLIO TYPES =====
export interface Holding {
    ticker: Ticker;
    shares: number;
    averageEntryPrice: number;
    currentValue?: number;
    totalReturn?: number;
    returnPercentage?: number;
}

export interface Portfolio {
    cash: number;
    positions: Position[];
}

export interface PositionDelta {
    sharesDelta: number;
    costDelta: number;
    reservedSharesDelta: number;
}

export interface PortfolioUpdate {
    cashDelta: number;
    reservedCashDelta: number;
    positions: Record<string, PositionDelta>; // ticker -> deltas
}

export interface Position {
    ticker: string;
    shares: number;
    averagePrice: number;
    totalCost: number;
    currentPrice: number;
    currentValue: number;
    gainLoss: number;
    gainLossPercent: number;
}

export interface LeaderboardEntry {
    rank: number;
    username: string;
    type: 'human' | 'bot';
    gain: number; // Portfolio % gain (e.g., 15.4 for +15.4%, -2.3 for -2.3%)
    value?: number; // Optional absolute value for sorting
}

// ===== BOT TYPES =====
export type BotStrategy = 'value' | 'momentum' | 'contrarian' | 'marketMaker' | 'boomer';

export interface Bot {
    id: string;
    name: string;
    strategy: BotStrategy;
    description: string;
    avatar?: string;
}

// ===== WEBSOCKET TYPES =====
export interface WebSocketMessage<T = any> {
    type: 'PRICE_UPDATE' | 'ORDER_FILLED' | 'PORTFOLIO_UPDATE' | 'NEWS' | 'TRADE_EXECUTED';
    data: T;
    timestamp: number;
}

export interface NewsData {
    headline: string;
    sentiment: number;  // -10 to 10 : avoid floating point operations
    affectedTickers?: Ticker[];
    affectedSectors?: Sector[];
    global: boolean;
}

// ===== API RESPONSE TYPES =====
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

// ===== WEBSOCKET CONTEXT VALUE =====
export interface WebSocketContextValue {
    // State
    prices: Record<Ticker, number>;
    userOrders: Order[];
    portfolio: Portfolio | null;
    latestNews: NewsData | null;
    subscribeToTicker: (ticker: Ticker) => void;  
    getDepthForTicker: (ticker: Ticker) => OrderDepth | undefined; 
    attemptOrderCancellation: (orderId: Number, ticker: Ticker, type: OrderType, side: OrderSide) => void;
    addOrder: (order: Order) => void;
    
    // Connection status
    portfolioLoading: boolean;
    isConnected: boolean;
    ordersLoading: boolean;
    lastMessageAt: number | null;
}