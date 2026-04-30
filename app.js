import express from 'express';
import path from 'path';
import mysql from 'mysql2';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { startNewsGenerator } from './news/newsEngine.js';
import { COMPANY_TYPES } from './news/headlineLibrary.js';
import { createBotManager } from './bots/BotManager.js';

dotenv.config();

const app = express();
const SERVER_PORT = process.env.SERVER_PORT || 3000;
const SOCKET_PORT = process.env.SOCKET_PORT || 8080

// Look into how to rotate JWT secrets periodically (security best practice)
const JWT_SECRET = process.env.JWT_SECRET;

app.use(express.json());

const corsOptions = {
    origin: 'http://localhost:5173',
    credentials: true, // Allow cookies to be sent/received
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cookieParser())

app.use(cors(corsOptions));

// MySQL connection
const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}).promise();

// Verify JWT
const authenticateToken = (req, res, next) => {
    const token = req.cookies?.['paper-trader-session'] || req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Check if username exists
        const [existingUser] = await db.query(
            'SELECT user_id FROM users WHERE username = ?',
            [username]
        );

        if (existingUser.length > 0) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const hash = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            'INSERT INTO users (username, p_hash) VALUES (?, ?)',
            [username, hash]
        );

        // Get the newly created user to get the UUID (for JWT)
        const [newUser] = await db.query(
            'SELECT user_id, username FROM users WHERE username = ?',
            [username]
        );

        const user = newUser[0];

        // Generate JWT token 
        const token = jwt.sign(
            { id: user.user_id, username: user.username },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.cookie('paper-trader-session', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000
        });

        res.status(201).json({
            message: 'User created successfully',
            user: { id: user.id, username: user.username }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login endpoint
app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;

    try {

        // Find user
        const [users] = await db.query(
            'SELECT user_id, username, p_hash FROM users WHERE username = ?',
            [username]
        );

        const user = users[0];

        // Create a dummy hash for non-existent users
        // to prevent timing attacks
        const dummyHash = '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123';

        // Use the real hash if user exists, otherwise use dummy
        const hashToCompare = user ? user.p_hash : dummyHash;

        const validPassword = await bcrypt.compare(password, hashToCompare);

        if (!user || !validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user.user_id, username: user.username },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Set token in HTTP-only cookie
        res.cookie('paper-trader-session', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000
        });

        res.json({
            message: 'Login successful',
            user: { user_id: user.user_id, username: user.username }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get current user 
app.get('/auth/me', async (req, res) => {
    try {

        const token = req.cookies?.["paper-trader-session"];

        if (!token) {
            return res.json({ user: null });
        }

        jwt.verify(token, JWT_SECRET, async (err, decoded) => {
            if (err) {
                console.log('Token verification failed:', err.message);
                return res.status(401).json({ user: null });
            }

            const [users] = await db.query(
                'SELECT user_id, username FROM users WHERE user_id = ?',
                [decoded.id]
            );

            if (users.length === 0) {
                console.log('User not found in database');
                return res.json({ user: null });
            }

            res.json({ user: users[0] });
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/stocks', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT ticker, name, sector, description, price FROM stocks ORDER BY sector, ticker');
        return res.json(rows);
    } catch (error) {
        console.error('Error fetching stocks:', error);
        return res.status(500).json({ error: 'Failed to fetch stocks' });
    }
});

app.get('/api/stocks/:ticker/price-data', async (req, res) => {
    const { ticker } = req.params;
    const { range = '1d' } = req.query;

    try {
        const [stockRows] = await db.query(
            'SELECT id, name, description, price FROM stocks WHERE ticker = ?',
            [ticker]
        );
        const stock = stockRows[0];
        if (!stock) {
            return res.status(404).json({ error: 'Stock not found' });
        }
        const stockId = stock.id;

        // Determine time range and sample interval
        let timeFilter;
        let sampleInterval;

        switch (range) {
            case '1m':
                timeFilter = "INTERVAL 1 MINUTE";
                sampleInterval = 1; // every 1 second
                break;
            case '5m':
                timeFilter = "INTERVAL 5 MINUTE";
                sampleInterval = 5; // every 5 seconds
                break;
            case '1h':
                timeFilter = "INTERVAL 1 HOUR";
                sampleInterval = 60; // every 1 minute
                break;
            case '1d':
                timeFilter = "INTERVAL 24 HOUR";
                sampleInterval = 300; // every 5 minutes
                break;
            case '1w':
                timeFilter = "INTERVAL 7 DAY";
                sampleInterval = 3600; // every 1 hour
                break;
            default:
                timeFilter = "INTERVAL 24 HOUR";
                sampleInterval = 300;
        }

        // Get sampled price data
        const [priceRows] = await db.query(`
            SELECT 
                price,
                timestamp
            FROM price_history
            WHERE stock_id = ? 
            AND timestamp > NOW() - ${timeFilter}
            AND UNIX_TIMESTAMP(timestamp) % ? = 0
            ORDER BY timestamp ASC
        `, [stockId, sampleInterval]);

        // If no sampled data, fall back to first and last points
        if (priceRows.length < 2) {
            const [allRows] = await db.query(`
                SELECT 
                    MIN(price) as low,
                    MAX(price) as high,
                    (SELECT price FROM price_history 
                     WHERE stock_id = ? 
                     ORDER BY timestamp DESC LIMIT 1) as current
                FROM price_history
                WHERE stock_id = ? 
                AND timestamp > NOW() - ${timeFilter}
            `, [stockId, stockId]);

            const [volumeRows] = await db.query(`
                SELECT COALESCE(SUM(filled), 0) as volume24h
                FROM price_history
                WHERE stock_id = ?
                AND timestamp > NOW() - INTERVAL 24 HOUR
            `, [stockId]);

            const current = Number(allRows[0]?.current ?? stock.price ?? 0);
            const estimatedValue = estimatedValueByTicker.get(ticker)
                ?? createEstimatedValueRange(current, getCompanyProfile(ticker)?.archetype);

            return res.json({
                name: stock.name,
                description: stock.description,
                current,
                estimatedValue,
                volume24h: Number(volumeRows[0]?.volume24h ?? 0),
                high: Number(allRows[0]?.high ?? current),
                low: Number(allRows[0]?.low ?? current),
                chart: []
            });
        }

        const [volumeRows] = await db.query(`
            SELECT COALESCE(SUM(filled), 0) as volume24h
            FROM price_history
            WHERE stock_id = ?
            AND timestamp > NOW() - INTERVAL 24 HOUR
        `, [stockId]);

        // Calculate stats from sampled data
        const prices = priceRows.map(p => Number(p.price));
        const current = Number(priceRows[priceRows.length - 1]?.price ?? stock.price ?? 0);
        const estimatedValue = estimatedValueByTicker.get(ticker)
            ?? createEstimatedValueRange(current, getCompanyProfile(ticker)?.archetype);
        const stats = {
            name: stock.name,
            description: stock.description,
            current,
            estimatedValue,
            volume24h: Number(volumeRows[0]?.volume24h ?? 0),
            high: Math.max(...prices),
            low: Math.min(...prices),
            chart: priceRows.map(row => ({
                price: Number(row.price),
                timestamp: row.timestamp
            }))
        };

        res.json(stats);
    }
    catch (err) {
        console.error('Error in price-data:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/auth/logout', (req, res) => {
    res.clearCookie('paper-trader-session');
    res.json({ message: 'Logged out successfully' });
});

// Protected route example
app.get('/auth/protected', authenticateToken, (req, res) => {
    res.json({ message: 'This is protected data', user: req.user });
});

app.post('/api/place-order', async (req, res) => {
    const token = req.cookies?.["paper-trader-session"];
    if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const userId = jwt.verify(token, process.env.JWT_SECRET).id;
    const quantity = parseFloat(req.body.quantity);

    const { ticker, side, type, price } = req.body;
    if (!type || !side || !ticker || !quantity) {
        return res.status(400).json({ success: false, error: 'Missing field in order placement request' });
    }

    if (type === 'LIMIT' && !price) {
        return res.status(400).json({ success: false, error: 'Limit orders require a price' });
    }

    const result = await placeOrder({ userId, ticker, side, type, quantity, price });

    // Use the result to send the appropriate response
    return res.status(result.statusCode).json(result);
});

app.get('/api/portfolio', async (req, res) => {
    try {

        // Get token from cookie
        const token = req.cookies?.["paper-trader-session"];

        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const userId = jwt.verify(token, process.env.JWT_SECRET).id;

        // Get portfolio data
        const [rows] = await db.query(`
            SELECT 
                u.cash,
                p.ticker,
                p.shares,
                p.total_cost,
                (p.total_cost / p.shares) as average_price,
                COALESCE((
                    SELECT ph.price
                    FROM price_history ph
                    WHERE ph.stock_id = s.id
                    ORDER BY ph.timestamp DESC, ph.id DESC
                    LIMIT 1
                ), s.price, 0) as current_price
            FROM users u
            LEFT JOIN portfolio p ON u.user_id = p.user_id
            LEFT JOIN stocks s ON p.ticker = s.ticker
            WHERE u.user_id = ?
        `, [userId]);

        if (rows.length === 0) {
            // User exists but has no portfolio rows
            const [userRows] = await db.query(
                'SELECT cash FROM users WHERE user_id = ?',
                [userId]
            );
            return res.json({
                cash: userRows[0].cash,
                positions: []
            });
        }

        const cash = rows[0].cash;

        // Filter out null positions
        const positions = rows
            .filter(row => row.ticker !== null)
            .map(row => {
                const shares = parseFloat(row.shares) || 0;
                const totalCost = parseFloat(row.total_cost) || 0;
                const currentPrice = getPortfolioCurrentPrice(row.ticker, row.current_price);
                const currentValue = shares * currentPrice;

                return {
                    ticker: row.ticker,
                    shares,
                    averagePrice: parseFloat(row.average_price) || 0,
                    totalCost,
                    currentPrice,
                    currentValue,
                    gainLoss: currentValue - totalCost,
                    gainLossPercent: totalCost > 0
                        ? ((currentValue - totalCost) / totalCost) * 100
                        : 0
                };
            });

        res.json({
            cash: parseFloat(cash),
            positions
        });

    } catch (error) {
        console.error('Error fetching portfolio:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio data' });
    }
});


app.get('/api/order-data', async (req, res) => {
    try {

        // Get token from cookie
        const token = req.cookies?.["paper-trader-session"];

        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const userId = jwt.verify(token, process.env.JWT_SECRET).id;

        // Get order data
        const [rows] = await db.query(`
            SELECT * from orders WHERE user_id = ?;
        `, [userId]);

        if (rows.length === 0) {
            // User exists but has no order rows
            return res.json({
                orders: []
            });
        }

        // This doesn't handle market fills properly
        // just shows "market" for price, but i could just use filled_cost / filled_quantity if filled_quantity != 0

        const orders = rows
            .map(row => ({
                orderId: row.id,
                ticker: row.ticker,
                type: row.type,
                side: row.side,
                price: parseFloat(row.price),
                quantity: parseFloat(row.quantity),
                filledQuantity: parseFloat(row.filled_quantity),
                status: row.status,
                created_at: row.created_at
            }));

        res.json({
            orders
        });

    } catch (error) {
        console.error('Error fetching portfolio:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio data' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const rankings = await buildLeaderboard();
        res.json(rankings);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard data' });
    }
});

app.listen(SERVER_PORT, () => {
    console.log(`Server running on port ${SERVER_PORT}`);
});

/* 
================================ SOCKET STUFF ======================================
*/

// I need to use redis for the layer between matching engine and node backend
// but still need websocket server to push updates to specific clients on order fill

const server = createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

const userToSocket = new Map();
const socketToUser = new Map();
let latestGeneratedNews = null;
let botManager = null;

io.on('connection', (socket) => {

    socket.on('register', (userId) => {
        userToSocket.set(userId, socket);
        socketToUser.set(socket.id, userId)
        console.log(`User ${socketToUser.get(socket.id)} registered with socket ${userToSocket.get(userId).id}`);

        if (latestGeneratedNews) {
            socket.emit('NEWS', latestGeneratedNews);
        }

        socket.emit('ESTIMATED_VALUE_UPDATE', Object.fromEntries(estimatedValueByTicker));

        if (latestLeaderboard.length > 0) {
            socket.emit('LEADERBOARD_UPDATE', latestLeaderboard);
        } else {
            void broadcastLeaderboardUpdate();
        }
    });

    // Handle ticker subscription
    socket.on('subscribe', (ticker) => {
        // Leave previous ticker room
        const rooms = Array.from(socket.rooms);
        rooms.forEach(room => {
            if (room.startsWith('ticker:')) {
                socket.leave(room);
            }
        });

        // Join new ticker room
        socket.join(`ticker:${ticker}`);

        // Send cached depth immediately - add initial prices to cachedDepth on app start
        const cachedDepth = depthCache.get(ticker);
        if (cachedDepth) {
            socket.emit('depth', {
                ...cachedDepth,
                ticker: ticker
            });
        }
    });

    socket.on('cancel-order', async (data) => {
        try {
            // This path can only be accessed by real users - bots will need to call order cancel function directly

            /* 
               Every authenticated client registers their userId on connection, so socketToUser should always have an entry.
               If this fails, something went seriously wrong (client somehow connected but never registered, or the map was corrupted).
               This is just a defensive check, but it *should* never happen
            */
            const userId = socketToUser.get(socket.id);
            if (!userId) {
                console.log("Something very weird happened with a cancel-order websocket message!")
                return socket.emit('error', 'Not authenticated');
            }

            const result = await verifyOrderOwnership(data.orderId);

            if (result.user_id !== userId) {
                return socket.emit('error', 'Not your order');
            }
            if (result.status != "OPEN") {
                return socket.emit('error', 'Order is already filled')
            }

            data.userId = userId;
            publisher.publish("orders:cancel", JSON.stringify(data));
            socket.emit('order-cancelling', { orderId: data.orderId });

        } catch (error) {
            console.error('Cancel error:', error);
            socket.emit('error', 'Failed to cancel order');
        }
    });

    socket.on('disconnect', () => {
        const userId = socketToUser.get(socket.id)
        userToSocket.delete(userId)
        socketToUser.delete(socket.id)
    });

    socket.on('connect_error', (error) => {
        console.log('Connection error:', error);
    });
});

server.listen(SOCKET_PORT, () => {
    console.log(`Websocket server running on port ${SOCKET_PORT}`);
});

/*
    =============================== REDIS STUFF ================================== 
*/

import redis from 'ioredis'

const Redis = new redis()

const publisher = Redis.duplicate();
const subscriber = Redis.duplicate();

subscriber.subscribe('orders:filled');
subscriber.subscribe('orders:rejected');
subscriber.subscribe('orders:cancel')


const tickers = [
    'NEXUS', 'QCI', 'CLSE', 'NSMC',
    'AGB', 'CRC', 'SGI', 'FINT',
    'MEGA', 'TREND', 'GLG', 'CLICK',
    'IDYN', 'AUTO', 'AERO', 'GSYS',
    'GMED', 'BIOV', 'GENH', 'NEURO'
];

const tickerToId = new Map();
const stockMetaByTicker = new Map();
const estimatedValueByTicker = new Map();

for (const ticker of tickers) {
    await subscriber.subscribe(`orders:depth:${ticker}`);
    console.log(`Subscribed to orders:depth:${ticker}`);
}

const depthCache = new Map(); // ticker -> latest depth snapshot

const FAIR_VALUE_SPREAD_BY_ARCHETYPE = {
    defensive: 0.03,
    stable: 0.04,
    moderate: 0.07,
    cyclical: 0.09,
    risky: 0.11
};

const FAIR_VALUE_SENTIMENT_MULTIPLIER_BY_ARCHETYPE = {
    defensive: 0.25,
    stable: 0.375,
    moderate: 0.45,
    cyclical: 0.5,
    risky: 0.625
};

function roundMoney(value) {
    return Number(Number(value).toFixed(2));
}

function getCompanyProfile(ticker) {
    return COMPANY_TYPES.find(company => company.ticker === ticker);
}

function createEstimatedValueRange(price, archetype = 'moderate') {
    const basePrice = Number(price ?? 0);
    const spread = FAIR_VALUE_SPREAD_BY_ARCHETYPE[archetype] ?? FAIR_VALUE_SPREAD_BY_ARCHETYPE.moderate;
    const halfRange = Math.max(0.5, basePrice * spread);

    return {
        low: roundMoney(Math.max(0.01, basePrice - halfRange)),
        high: roundMoney(basePrice + halfRange)
    };
}

function getAffectedTickersForNews(news) {
    if (news.global) return [...tickers];

    if (Array.isArray(news.affectedTickers) && news.affectedTickers.length > 0) {
        return news.affectedTickers.filter(ticker => tickers.includes(ticker));
    }

    const affected = new Set();
    const affectedSectors = new Set(news.affectedSectors ?? []);

    if (affectedSectors.size > 0) {
        for (const company of COMPANY_TYPES) {
            if (affectedSectors.has(company.sector)) {
                affected.add(company.ticker);
            }
        }
    }

    return [...affected].filter(ticker => tickers.includes(ticker));
}

function updateEstimatedValuesForNews(news) {
    const updates = {};

    for (const ticker of getAffectedTickersForNews(news)) {
        const profile = getCompanyProfile(ticker);
        const archetype = profile?.archetype ?? 'moderate';
        const currentRange = estimatedValueByTicker.get(ticker)
            ?? createEstimatedValueRange(stockMetaByTicker.get(ticker)?.price, archetype);
        const multiplier = FAIR_VALUE_SENTIMENT_MULTIPLIER_BY_ARCHETYPE[archetype]
            ?? FAIR_VALUE_SENTIMENT_MULTIPLIER_BY_ARCHETYPE.moderate;
        const shift = Number(news.sentiment ?? 0) * multiplier;
        const nextRange = {
            low: roundMoney(Math.max(0.01, currentRange.low + shift)),
            high: roundMoney(Math.max(0.01, currentRange.high + shift))
        };

        if (nextRange.high < nextRange.low) {
            nextRange.high = nextRange.low;
        }

        estimatedValueByTicker.set(ticker, nextRange);
        updates[ticker] = nextRange;
    }

    return updates;
}

function getStimulusCashAmount(news) {
    if (news?.isStimulus !== true && news?.stimulus !== true) return 0;

    const amount = Number(news.stimulusCashAmount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return 0;

    return roundMoney(amount);
}

async function applyStimulusCashForNews(news) {
    const cashAmount = getStimulusCashAmount(news);
    if (cashAmount <= 0) return;

    const [users] = await db.query(
        `SELECT user_id
         FROM users
         WHERE username NOT LIKE 'bot_%'`
    );

    if (users.length === 0) return;

    const userIds = users.map(user => user.user_id);

    await db.query(
        `UPDATE users
         SET cash = COALESCE(cash, 0) + ?,
             deposited_cash = COALESCE(deposited_cash, 0) + ?
         WHERE user_id IN (?)`,
        [cashAmount, cashAmount, userIds]
    );

    for (const userId of userIds) {
        const socket = userToSocket.get(userId);
        if (!socket) continue;

        socket.emit('PORTFOLIO_UPDATE', {
            cashDelta: cashAmount,
            reservedCashDelta: 0,
            depositedCashDelta: cashAmount,
            positions: {},
        });
    }

    void broadcastLeaderboardUpdate();
}

const convertDepth = (depth) => ({
    asks: (Array.isArray(depth?.asks) ? depth.asks : []).map(ask => ({
        price: ask.price / MICRO_UNIT,
        quantity: ask.quantity / MICRO_UNIT
    })),
    bids: (Array.isArray(depth?.bids) ? depth.bids : []).map(bid => ({
        price: bid.price / MICRO_UNIT,
        quantity: bid.quantity / MICRO_UNIT
    })),
    lastPrice: (depth?.lastPrice ?? 0) / MICRO_UNIT
});

const LEADERBOARD_BROADCAST_INTERVAL_MS = 5_000;
let latestLeaderboard = [];
let leaderboardBroadcastTimer = null;
let leaderboardBuildInFlight = false;

function getDepthPrice(ticker) {
    const price = Number(depthCache.get(ticker)?.lastPrice ?? 0);
    return Number.isFinite(price) && price > 0 ? price : 0;
}

function getPortfolioCurrentPrice(ticker, fallbackPrice = 0) {
    const depthPrice = getDepthPrice(ticker);
    if (depthPrice > 0) return depthPrice;

    const price = Number(fallbackPrice ?? 0);
    return Number.isFinite(price) && price > 0 ? price : 0;
}

function calculatePortfolioValue({ cash = 0, positions = [] }) {
    const holdingsValue = positions.reduce((total, position) => {
        const shares = Number(position.shares ?? 0);
        return total + shares * getDepthPrice(position.ticker);
    }, 0);

    return Number(cash ?? 0) + holdingsValue;
}

function toLeaderboardEntry(account) {
    const value = calculatePortfolioValue(account);
    const depositedCash = Number(account.depositedCash ?? 0);
    const gain = depositedCash > 0 ? ((value - depositedCash) / depositedCash) * 100 : 0;

    return {
        username: account.username,
        displayName: account.displayName,
        type: account.type,
        gain,
        value,
    };
}

async function getHumanLeaderboardAccounts() {
    const [rows] = await db.query(`
        SELECT
            u.user_id,
            u.username,
            u.cash,
            u.reserved_cash,
            u.deposited_cash,
            p.ticker,
            p.shares,
            p.reserved_shares,
            p.total_cost
        FROM users u
        LEFT JOIN portfolio p ON p.user_id = u.user_id
        WHERE u.username NOT LIKE 'bot_%'
        ORDER BY u.username, p.ticker
    `);

    const accounts = new Map();
    for (const row of rows) {
        if (!accounts.has(row.user_id)) {
            accounts.set(row.user_id, {
                userId: row.user_id,
                username: row.username,
                type: 'human',
                cash: Number(row.cash ?? 0),
                reservedCash: Number(row.reserved_cash ?? 0),
                depositedCash: Number(row.deposited_cash ?? 0),
                positions: [],
            });
        }

        if (row.ticker) {
            accounts.get(row.user_id).positions.push({
                ticker: row.ticker,
                shares: Number(row.shares ?? 0),
                reservedShares: Number(row.reserved_shares ?? 0),
                totalCost: Number(row.total_cost ?? 0),
            });
        }
    }

    return [...accounts.values()];
}

async function buildLeaderboard() {
    const humanAccounts = await getHumanLeaderboardAccounts();
    const botAccounts = botManager?.getPortfolios?.() ?? [];
    const entries = [...humanAccounts, ...botAccounts]
        .map(toLeaderboardEntry)
        .sort((a, b) => b.gain - a.gain || b.value - a.value || a.username.localeCompare(b.username));

    return entries.map((entry, index) => ({
        rank: index + 1,
        username: entry.username,
        displayName: entry.displayName,
        type: entry.type,
        gain: entry.gain,
        value: entry.value,
    }));
}

async function broadcastLeaderboardUpdate() {
    if (leaderboardBuildInFlight) return;
    leaderboardBuildInFlight = true;

    try {
        latestLeaderboard = await buildLeaderboard();
        io.emit('LEADERBOARD_UPDATE', latestLeaderboard);
    } catch (error) {
        console.error('Failed to broadcast leaderboard update:', error);
    } finally {
        leaderboardBuildInFlight = false;
    }
}

function startLeaderboardBroadcasts() {
    if (leaderboardBroadcastTimer) {
        clearInterval(leaderboardBroadcastTimer);
    }

    void broadcastLeaderboardUpdate();
    leaderboardBroadcastTimer = setInterval(() => {
        void broadcastLeaderboardUpdate();
    }, LEADERBOARD_BROADCAST_INTERVAL_MS);
}

let totalFills = 0;
let totalTimeNs = 0
const FILL_BATCH_WINDOW_MS = 20;
const MAX_FILL_BATCH_RETRIES = 3;
const DEADLOCK_ERROR_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const pendingFillTrades = [];
let fillBatchTimer = null;
let fillBatchInFlight = false;

const sortStableIds = (ids) => [...ids].sort((a, b) => {
    const aNum = Number(a);
    const bNum = Number(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
        return aNum - bNum;
    }
    return String(a).localeCompare(String(b));
});
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function scheduleFillBatchProcessing() {
    if (fillBatchTimer !== null || fillBatchInFlight) return;
    fillBatchTimer = setTimeout(() => {
        fillBatchTimer = null;
        void flushFillBatchQueue();
    }, FILL_BATCH_WINDOW_MS);
}

function enqueueFillTrades(trades) {
    if (!Array.isArray(trades) || trades.length === 0) return;
    pendingFillTrades.push(...trades);
    scheduleFillBatchProcessing();
}

async function flushFillBatchQueue() {
    if (fillBatchInFlight) return;
    fillBatchInFlight = true;

    try {
        while (pendingFillTrades.length > 0) {
            const trades = pendingFillTrades.splice(0, pendingFillTrades.length);
            try {
                await processFillBatchWithRetry(trades);
            } catch (err) {
                // Put failed work back on the front of the queue to avoid dropping fills.
                pendingFillTrades.unshift(...trades);
                console.error('Fill batch processing failed. Keeping trades queued for retry.', err);
                await sleep(50);
                break;
            }
        }
    } finally {
        fillBatchInFlight = false;
        if (pendingFillTrades.length > 0) {
            scheduleFillBatchProcessing();
        }
    }
}

async function processFillBatchWithRetry(trades) {
    for (let attempt = 1; attempt <= MAX_FILL_BATCH_RETRIES; attempt++) {
        try {
            await processFillBatch(trades);
            return;
        } catch (err) {
            const isDeadlock = DEADLOCK_ERROR_CODES.has(err?.code);
            const shouldRetry = isDeadlock && attempt < MAX_FILL_BATCH_RETRIES;

            if (!shouldRetry) {
                throw err;
            }

            console.log(`Attempt ${attempt} failed. isDeadlock=${isDeadlock}, code=${err?.code}, message=${err?.message}`);

            const backoffMs = attempt * 25;
            console.warn(`Fill batch deadlock/timeout on attempt ${attempt}. Retrying in ${backoffMs}ms.`);
            await sleep(backoffMs);
        }
    }
}

async function processFillBatch(trades) {
    if (!Array.isArray(trades) || trades.length === 0) return;

    const firstTimestamp = trades[0].timestamp;
    const lastTimestamp = trades[trades.length - 1].timestamp;
    const fillCount = trades.length;

    const timeDiffNs = Math.max(0, lastTimestamp - firstTimestamp);
    const timeDiffMs = timeDiffNs / 1_000_000;
    const fillsPerSec = timeDiffNs > 0
        ? (fillCount / timeDiffNs) * 1_000_000_000
        : fillCount;

    totalFills += fillCount;
    totalTimeNs += timeDiffNs;
    const avgFillsPerSec = totalTimeNs > 0
        ? (totalFills / totalTimeNs) * 1_000_000_000
        : totalFills;

    console.log(`Batch: ${fillCount} fills in ${timeDiffMs.toFixed(2)}ms -> ${fillsPerSec.toFixed(0)} fills/sec | Avg: ${avgFillsPerSec.toFixed(0)} fills/sec`);
    //console.log(`Last fill: ${new Date(Date.now())}`)

    const fillMap = new Map();
    const priceHistoryData = [];
    const userUpdates = new Map();

    for (const trade of trades) {
        const {
            askOrderId, askRemainingQuantity, askUserId,
            bidOrderId, bidRemainingQuantity, bidUserId,
            filledPrice, filledQuantity, ticker, timestamp
        } = trade;

        priceHistoryData.push({
            ticker,
            price: filledPrice / MICRO_UNIT,
            filled: filledQuantity / MICRO_UNIT,
            timestamp,
            tradeId: bidOrderId
        });

        updateFillMap(bidOrderId, bidRemainingQuantity / MICRO_UNIT, filledQuantity / MICRO_UNIT, filledPrice / MICRO_UNIT, timestamp, {
            userId: bidUserId,
            ticker,
            side: 'bid'
        }, fillMap);

        updateFillMap(askOrderId, askRemainingQuantity / MICRO_UNIT, filledQuantity / MICRO_UNIT, filledPrice / MICRO_UNIT, timestamp, {
            userId: askUserId,
            ticker,
            side: 'ask'
        }, fillMap);
    }

    const getOrCreateUser = (userId) => {
        if (!userUpdates.has(userId)) {
            userUpdates.set(userId, { cashDelta: 0, reservedCashDelta: 0, positions: new Map() });
        }
        return userUpdates.get(userId);
    };

    const getOrCreatePosition = (userEntry, ticker) => {
        if (!userEntry.positions.has(ticker)) {
            userEntry.positions.set(ticker, { sharesDelta: 0, costDelta: 0, reservedSharesDelta: 0 });
        }
        return userEntry.positions.get(ticker);
    };

    for (const [, data] of fillMap) {
        if (data.bidUserId) {
            const user = getOrCreateUser(data.bidUserId);
            user.cashDelta -= data.totalCost;
            user.reservedCashDelta -= data.totalCost;

            const pos = getOrCreatePosition(user, data.ticker);
            pos.sharesDelta += data.totalQuantity;
            pos.costDelta += data.totalCost;
        }

        if (data.askUserId) {
            const user = getOrCreateUser(data.askUserId);
            user.cashDelta += data.totalCost;

            const pos = getOrCreatePosition(user, data.ticker);
            pos.sharesDelta -= data.totalQuantity;
            pos.costDelta -= data.totalCost;
            pos.reservedSharesDelta -= data.totalQuantity;
        }
    }

    let connection;
    let committed = false;
    const sortedUserIds = sortStableIds([...userUpdates.keys()]);

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        if (priceHistoryData.length > 0) {
            const priceHistoryInserts = priceHistoryData.map(trade => [
                tickerToId.get(trade.ticker),
                trade.price,
                trade.filled,
                new Date(trade.timestamp / 1000000).toISOString().slice(0, 19).replace('T', ' '),
                trade.tradeId
            ]);

            await connection.query(
                `INSERT INTO price_history (stock_id, price, filled, timestamp, trade_id) 
                 VALUES ?`,
                [priceHistoryInserts]
            );

            const latestPrices = new Map();
            for (const trade of priceHistoryData) {
                const existing = latestPrices.get(trade.ticker);
                if (!existing || trade.timestamp >= existing.timestamp) {
                    latestPrices.set(trade.ticker, {
                        price: trade.price,
                        timestamp: trade.timestamp
                    });
                }
            }

            const sortedTickers = [...latestPrices.keys()].sort();
            if (sortedTickers.length > 0) {
                const priceCases = sortedTickers.map(() => `WHEN ticker = ? THEN ?`).join(' ');
                const priceValues = sortedTickers.flatMap(ticker => [ticker, latestPrices.get(ticker).price]);

                await connection.query(
                    `UPDATE stocks SET price = CASE ${priceCases} ELSE price END
                     WHERE ticker IN (?)`,
                    [...priceValues, sortedTickers]
                );
            }
        }

        const sortedOrderIds = sortStableIds([...fillMap.keys()]);
        if (sortedOrderIds.length > 0) {
            const quantityCases = sortedOrderIds.map(() => `WHEN id = ? THEN filled_quantity + ?`).join(' ');
            const costCases = sortedOrderIds.map(() => `WHEN id = ? THEN filled_cost + ?`).join(' ');
            const statusCases = sortedOrderIds.map(() => `WHEN id = ? THEN ?`).join(' ');
            const timestampCases = sortedOrderIds.map(() => `WHEN id = ? THEN FROM_UNIXTIME(?)`).join(' ');

            const quantityValues = sortedOrderIds.flatMap(id => [id, fillMap.get(id).totalQuantity]);
            const costValues = sortedOrderIds.flatMap(id => [id, fillMap.get(id).totalCost]);
            const statusValues = sortedOrderIds.flatMap(id => [id, fillMap.get(id).remainingQuantity === 0 ? 'FILLED' : 'PARTIALLY_FILLED']);
            const timestampValues = sortedOrderIds.flatMap(id => [id, fillMap.get(id).lastTimestamp / 1_000_000_000]);

            await connection.query(
                `UPDATE orders SET
                    filled_quantity = CASE ${quantityCases} ELSE filled_quantity END,
                    filled_cost     = CASE ${costCases} ELSE filled_cost END,
                    status          = CASE ${statusCases} ELSE status END,
                    updated_at      = CASE ${timestampCases} ELSE updated_at END
                WHERE id IN (?)
                ORDER BY id`,
                [...quantityValues, ...costValues, ...statusValues, ...timestampValues, sortedOrderIds]
            );
        }

        if (sortedUserIds.length > 0) {
            const userCashCases = sortedUserIds.map(() => `WHEN user_id = ? THEN cash + ?`).join(' ');
            const userReservedCashCases = sortedUserIds.map(() => `WHEN user_id = ? THEN reserved_cash + ?`).join(' ');
            const userCashValues = sortedUserIds.flatMap(userId => [userId, userUpdates.get(userId).cashDelta]);
            const userReservedCashValues = sortedUserIds.flatMap(userId => [userId, userUpdates.get(userId).reservedCashDelta]);

            await connection.query(
                `UPDATE users SET
                    cash = CASE ${userCashCases} ELSE cash END,
                    reserved_cash = CASE ${userReservedCashCases} ELSE reserved_cash END
                WHERE user_id IN (?)`,
                [...userCashValues, ...userReservedCashValues, sortedUserIds]
            );
        }

        const positionRows = [];
        for (const userId of sortedUserIds) {
            const positions = userUpdates.get(userId).positions;
            const sortedTickers = [...positions.keys()].sort();

            for (const ticker of sortedTickers) {
                const { sharesDelta, costDelta, reservedSharesDelta } = positions.get(ticker);
                positionRows.push([userId, ticker, sharesDelta, costDelta, reservedSharesDelta]);
            }
        }

        if (positionRows.length > 0) {
            await connection.query(
                `INSERT INTO portfolio (user_id, ticker, shares, total_cost, reserved_shares)
                    VALUES ?
                    ON DUPLICATE KEY UPDATE
                        shares = shares + VALUES(shares),
                        total_cost = total_cost + VALUES(total_cost),
                        reserved_shares = reserved_shares + VALUES(reserved_shares)`,
                [positionRows]
            );

            const positionPairPlaceholders = positionRows.map(() => '(?, ?)').join(', ');
            const positionPairValues = positionRows.flatMap(([userId, ticker]) => [userId, ticker]);
            await connection.query(
                `DELETE FROM portfolio
                 WHERE (user_id, ticker) IN (${positionPairPlaceholders})
                 AND shares <= 0`,
                positionPairValues
            );
        }

        await connection.commit();
        committed = true;
    } catch (err) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackErr) {
                console.error('Rollback failed:', rollbackErr);
            }
        }
        throw err;
    } finally {
        connection?.release();
    }

    if (!committed) return;

    const volumeUpdates = {};
    for (const trade of priceHistoryData) {
        volumeUpdates[trade.ticker] = (volumeUpdates[trade.ticker] ?? 0) + trade.filled;
    }

    for (const [ticker, volumeDelta] of Object.entries(volumeUpdates)) {
        io.to(`ticker:${ticker}`).emit('VOLUME_UPDATE', {
            ticker,
            volumeDelta
        });
    }

    for (const [userId, update] of userUpdates) {
        const socket = userToSocket.get(userId);
        if (!socket) continue;

        const positions = Object.fromEntries(
            [...update.positions].map(([ticker, position]) => [
                ticker,
                {
                    ...position,
                    currentPrice: Math.abs(position.sharesDelta) > 0
                        ? Math.abs(position.costDelta / position.sharesDelta)
                        : getPortfolioCurrentPrice(ticker)
                }
            ])
        );
        socket.emit('PORTFOLIO_UPDATE', {
            cashDelta: update.cashDelta,
            reservedCashDelta: update.reservedCashDelta,
            positions,
        });
    }

    for (const [orderId, data] of fillMap) {
        const userId = data.bidUserId || data.askUserId;
        const socket = userToSocket.get(userId);
        if (!socket) continue;

        socket.emit('ORDER_FILLED', {
            orderId,
            ticker: data.ticker,
            filledQuantity: data.totalQuantity,
            filledPrice: data.filledPrice,
            remainingQuantity: data.remainingQuantity,
            status: data.remainingQuantity === 0 ? 'FILLED' : 'PARTIALLY_FILLED'
        });
    }

    void broadcastLeaderboardUpdate();

    function updateFillMap(orderId, remainingQuantity, filledQuantity, filledPrice, timestamp, meta, map) {
        const entry = map.get(orderId) || {
            bidUserId: null,
            askUserId: null,
            totalQuantity: 0,
            totalCost: 0,
            remainingQuantity: 0,
            filledQuantity: 0,
            filledPrice: 0,
            lastTimestamp: 0,
            side: meta.side,
            ticker: meta.ticker
        };

        entry.totalQuantity += filledQuantity;
        entry.totalCost += filledQuantity * filledPrice;
        entry.filledPrice = filledPrice;
        entry.remainingQuantity = remainingQuantity;
        entry.filledQuantity = filledQuantity;

        if (meta.side === 'bid') {
            entry.bidUserId = meta.userId;
        } else {
            entry.askUserId = meta.userId;
        }

        if (timestamp > entry.lastTimestamp) {
            entry.lastTimestamp = timestamp;
        }

        map.set(orderId, entry);
    }
}

subscriber.on('message', async (channel, message) => {
    if (channel.startsWith('orders:depth:')) {
        const ticker = channel.replace('orders:depth:', '');

        try {
            const depth = JSON.parse(message);
            const cached = depthCache.get(ticker);

            // Convert all micro-units back to normal units 
            const convertedDepth = convertDepth(depth);

            // Determine effective price (use engine price if > 0, otherwise use cached)
            const effectivePrice = convertedDepth.lastPrice > 0
                ? convertedDepth.lastPrice
                : (cached?.lastPrice || 0);

            // Create final depth with effective price
            const finalDepth = {
                ...convertedDepth,
                lastPrice: effectivePrice
            };

            // Only send if something actually changed
            if (!cached || JSON.stringify(cached) !== JSON.stringify(finalDepth)) {
                depthCache.set(ticker, finalDepth);
                io.to(`ticker:${ticker}`).emit('depth', {
                    ...finalDepth,
                    ticker: ticker
                });
            }

        } catch (e) {
            console.error('❌ Failed to parse depth:', e);
        }
    }

    if (channel == "orders:cancel") {
        try {

            const data = JSON.parse(message);

            const result = await cancelOrderInDatabase(data.orderId);

            botManager?.onOrderCanceled(data.orderId);
            // Send cancel confirmation to user via websocket
            // Need access to user id for that
        }
        catch (e) {
            console.error(e)
        }
    }

    if (channel === 'orders:filled') {
        try {
            const trades = JSON.parse(message);
            botManager?.onTrades(trades);
            enqueueFillTrades(trades);
        } catch (err) {
            console.error('Failed to parse orders:filled payload:', err);
        }
    }

    // Should only be used for market orders that could not be filled
    // Or limit orders that somehow reached engine while missing required data
    if (channel == 'orders:rejected') {
        try {
            const parsed = JSON.parse(message);
            const rejectedOrders = normalizeRejectedOrdersPayload(parsed);
            console.log("Rejected orders: ", rejectedOrders.length)
            for (const rejected of rejectedOrders) {
                const orderStatus = await applyOrderRejectionToDatabase(rejected);
                botManager?.onOrderRejected(rejected);

                const socket = userToSocket.get(rejected.userId);
                socket?.emit('ORDER_REJECTED', {
                    orderId: rejected.orderId,
                    userId: rejected.userId,
                    ticker: rejected.ticker,
                    side: rejected.side,
                    rejectedQuantity: toNormalUnits(rejected.rejectedQuantity),
                    reason: rejected.reason,
                    timestamp: rejected.timestamp,
                    status: 'REJECTED',
                    orderStatus: orderStatus ?? 'REJECTED'
                });
            }
        } catch (err) {
            console.error('Failed to process orders:rejected payload:', err);
        }
    }
});

/*
===================================== HELPER FUNCTIONS ===============================================
                                Move to utils folder later
*/

async function getCurrentStockPrice(ticker) {
    try {
        const [rows] = await db.query(`SELECT price FROM stocks WHERE ticker = ?;`, [ticker]);
        return parseFloat(rows[0]?.price) || null;
    }
    catch (err) {
        console.error('Error fetching stock price:', err);
        throw new Error('Failed to fetch current price');
    }
}

async function cancelOrderInDatabase(orderId) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [orders] = await connection.query(
            `SELECT user_id, ticker, side, quantity, filled_quantity, estimated_amount, filled_cost, status
             FROM orders
             WHERE id = ?
             FOR UPDATE`,
            [orderId]
        );

        const order = orders[0];
        if (!order || !['OPEN', 'PARTIALLY_FILLED'].includes(order.status)) {
            await connection.rollback();
            return null;
        }

        if (order.side === 'BUY') {
            const remainingReservedCash = Math.max(
                0,
                Number(order.estimated_amount ?? 0) - Number(order.filled_cost ?? 0)
            );

            await connection.query(
                `UPDATE users
                 SET reserved_cash = GREATEST(0, reserved_cash - ?)
                 WHERE user_id = ?`,
                [remainingReservedCash, order.user_id]
            );
        } else {
            const remainingShares = Math.max(
                0,
                Number(order.quantity ?? 0) - Number(order.filled_quantity ?? 0)
            );

            await connection.query(
                `UPDATE portfolio
                 SET reserved_shares = GREATEST(0, reserved_shares - ?)
                 WHERE user_id = ?
                 AND ticker = ?`,
                [remainingShares, order.user_id, order.ticker]
            );
        }

        const [result] = await connection.query(
            `UPDATE orders
             SET status = 'CANCELED'
             WHERE id = ?`,
            [orderId]
        );

        await connection.commit();
        return result;
    } catch (err) {
        await connection.rollback();
        console.error('Error in cancelOrderInDatabase: ', err);
        throw new Error('Failed to cancel order in database')
    } finally {
        connection.release();
    }
}

function normalizeRejectedOrdersPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.rejected)) return payload.rejected;
    if (Array.isArray(payload?.rejectedOrders)) return payload.rejectedOrders;
    if (Array.isArray(payload?.rejections)) return payload.rejections;
    if (Array.isArray(payload?.orders)) return payload.orders;
    return payload ? [payload] : [];
}

function toNormalUnits(microValue) {
    const value = Number(microValue ?? 0);
    return Number.isFinite(value) ? value / MICRO_UNIT : 0;
}

function isSameQuantity(left, right) {
    return Math.abs(Number(left ?? 0) - Number(right ?? 0)) < 0.0001;
}

function timestampSecondsFromNanoseconds(timestamp) {
    const value = Number(timestamp);
    return Number.isFinite(value) && value > 0 ? value / 1_000_000_000 : null;
}

async function applyOrderRejectionToDatabase(rejected) {
    if (!rejected?.orderId) return null;

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [orders] = await connection.query(
            `SELECT quantity, status
             FROM orders
             WHERE id = ?
             FOR UPDATE`,
            [rejected.orderId]
        );

        const order = orders[0];
        if (!order || !['OPEN', 'PARTIALLY_FILLED'].includes(order.status)) {
            await connection.rollback();
            return null;
        }

        const rejectedQuantity = toNormalUnits(rejected.rejectedQuantity);
        const orderQuantity = Number(order.quantity ?? 0);
        const nextStatus = isSameQuantity(rejectedQuantity, orderQuantity) || rejectedQuantity > orderQuantity
            ? 'REJECTED'
            : 'PARTIALLY_FILLED';

        const timestampSeconds = timestampSecondsFromNanoseconds(rejected.timestamp);
        if (timestampSeconds) {
            await connection.query(
                `UPDATE orders
                 SET status = ?, updated_at = FROM_UNIXTIME(?)
                 WHERE id = ?`,
                [nextStatus, timestampSeconds, rejected.orderId]
            );
        } else {
            await connection.query(
                `UPDATE orders
                 SET status = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [nextStatus, rejected.orderId]
            );
        }

        await connection.commit();
        return nextStatus;
    } catch (err) {
        try {
            await connection.rollback();
        } catch (rollbackErr) {
            console.error('Rollback failed while rejecting order:', rollbackErr);
        }
        throw err;
    } finally {
        connection.release();
    }
}

async function verifyOrderOwnership(orderId) {
    try {
        const [rows] = await db.query('SELECT user_id, status FROM orders WHERE id = ?;', [orderId])
        return rows[0] || null;
    } catch (err) {
        console.error('Error in verifyOrderOwnership: ', err);
        throw new Error('Failed to verify order ownership')
    }
}

const MICRO_UNIT = 1e6;

// In Node startup
async function recoverUnfilledOrders() {
    try {
        // Clear redis cache
        await publisher.del('orders:recovery');
        await publisher.del('orders:filled');
        await publisher.del('orders:new')
        // Load unfilled orders
        const [rows] = await db.query(
            `SELECT * FROM orders WHERE status = 'OPEN' ORDER BY created_at ASC`
        );

        if (rows.length === 0) {
            console.log('No unfilled orders to recover');
            return;
        }

        console.log(`Queueing ${rows.length} orders for recovery`);

        for (const row of rows) {
            const remainingQuantity = Math.round(row.quantity * MICRO_UNIT - row.filled_quantity * MICRO_UNIT);

            const order = {
                id: row.id,
                userId: row.user_id,
                type: row.type,
                ticker: row.ticker,
                side: row.side,
                quantity: remainingQuantity,  // already in micro-units
                price: row.price ? Math.round(row.price * MICRO_UNIT) : null,
                estimatedCost: Math.round(row.estimated_amount * MICRO_UNIT),
                timestamp: new Date(row.created_at).getTime()
            };
            await Redis.lpush('orders:recovery', JSON.stringify(order));
        }

        console.log('Recovery orders queued in Redis');

    } catch (error) {
        console.error('Recovery failed:', error);
    }
}

// In your Node.js server startup
async function initializeDepthCache() {
    const [rows] = await db.query('SELECT ticker, price FROM stocks');

    for (const row of rows) {
        // Create a default depth snapshot with just the price
        const defaultDepth = {
            asks: [],  // Empty order book initially
            bids: [],
            lastPrice: parseFloat(row.price)
        };

        depthCache.set(row.ticker, defaultDepth);
    }
}

async function loadTickerMap() {
    const [rows] = await db.query('SELECT id, ticker, price FROM stocks');
    for (const row of rows) {
        tickerToId.set(row.ticker, row.id);
        stockMetaByTicker.set(row.ticker, {
            id: row.id,
            price: Number(row.price ?? 0)
        });

        const profile = getCompanyProfile(row.ticker);
        estimatedValueByTicker.set(
            row.ticker,
            createEstimatedValueRange(row.price, profile?.archetype)
        );
    }
    console.log(`Loaded ${tickerToId.size} ticker mappings`);
}

async function handleLimitOrder(order) {
    const price = parseFloat(order.price);
    return await executeOrder({
        ...order,
        price: price,
        estimatedCost: price * order.quantity
    });
}

async function handleMarketOrder(order) {

    const currentPrice = await getCurrentStockPrice(order.ticker);
    const buffer = 1.01; // 1% slippage buffer
    const estimatedCost = currentPrice * order.quantity * buffer;

    return await executeOrder({
        ...order,
        estimatedCost,
        price: null  // Market orders have no price
    });
}

async function executeOrder(order) {
    const connection = await db.getConnection();
    const { userId, ticker, side, type, quantity, price, estimatedCost } = order;

    try {
        await connection.beginTransaction();
        const [user] = await connection.query(
            'SELECT cash, reserved_cash FROM users WHERE user_id = ? FOR UPDATE',
            [userId]
        );

        if (side === 'BUY') {

            const availableCash = user[0].cash - user[0].reserved_cash;

            if (availableCash < estimatedCost) {
                await connection.rollback();
                return {
                    success: false,
                    error: 'Insufficient funds',
                    statusCode: 400
                };
            }

            await connection.query(
                'UPDATE users SET reserved_cash = reserved_cash + ? WHERE user_id = ?',
                [estimatedCost, userId]
            );

        } else { // SELL
            const [portfolio] = await connection.query(
                'SELECT shares, reserved_shares FROM portfolio WHERE user_id = ? AND ticker = ? FOR UPDATE',
                [userId, ticker]
            );

            if (!portfolio[0]) {
                await connection.rollback();
                return {
                    success: false,
                    error: 'No shares owned',
                    statusCode: 400
                };
            }

            const availableShares = portfolio[0].shares - portfolio[0].reserved_shares;

            if (availableShares < quantity) {
                await connection.rollback();
                return {
                    success: false,
                    error: 'Insufficient shares',
                    available: availableShares,
                    needed: quantity,
                    statusCode: 400
                };
            }

            await connection.query(
                'UPDATE portfolio SET reserved_shares = reserved_shares + ? WHERE user_id = ? AND ticker = ?',
                [quantity, userId, ticker]
            );
        }

        // Create order
        const [result] = await connection.query(
            `INSERT INTO orders (user_id, ticker, side, type, price, quantity, status, estimated_amount)
             VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
            [userId, ticker, side, type, price, quantity, estimatedCost]
        );

        await connection.commit();

        const toMicro = (normal) => { return normal * MICRO_UNIT }

        const orderForEngine = {
            id: result.insertId,
            userId,
            ticker,
            side,
            type,
            price: toMicro(price),
            quantity: toMicro(quantity),
            estimatedCost: toMicro(estimatedCost),
            timestamp: Date.now()
        };

        const orderForClient = {
            orderId: result.insertId,
            userId,
            ticker,
            side,
            type,
            price: price,
            quantity: quantity,
            filledQuantity: 0,
            remainingQuantity: quantity,
            status: "OPEN",
            filledPrice: 0,
            estimatedCost: estimatedCost,
            timestamp: Date.now()
        }

        await publisher.publish('orders:new', JSON.stringify(orderForEngine));

        const socket = userToSocket.get(userId)

        socket?.emit("ORDER_PLACED", orderForClient)

        return {
            success: true,
            orderId: result.insertId,
            estimatedCost,
            message: 'Order submitted successfully!',
            statusCode: 200
        };

    } catch (error) {
        await connection.rollback();
        console.error('Order placement error:', error);
        return {
            success: false,
            error: 'Failed to place order',
            statusCode: 500
        };
    } finally {
        connection.release();
    }
}

async function placeOrder(order) {
    const { type } = order;

    if (type === 'LIMIT') {
        if (!order.price) {
            return {
                success: false,
                error: 'Limit orders require a price',
                statusCode: 400
            };
        }
        return await handleLimitOrder(order);
    }

    if (type === 'MARKET') {
        return await handleMarketOrder(order);
    }

    return {
        success: false,
        error: 'Invalid order type',
        statusCode: 400
    };
}

async function cancelOrder(order) {
    if (!order?.orderId || !order?.ticker || !order?.side) {
        return { success: false, error: 'Missing cancel order fields' };
    }

    await publisher.publish('orders:cancel', JSON.stringify(order));
    return { success: true };
}

await loadTickerMap();
await initializeDepthCache();
await recoverUnfilledOrders();
botManager = createBotManager({
    db,
    placeOrder,
    cancelOrder,
    getDepth: (ticker) => depthCache.get(ticker),
    logger: console
});
await botManager.start();
startLeaderboardBroadcasts();
startNewsGenerator(io, {
    intervalMs: 30_000,
    emitOnStart: true,
    onEmit: (payload) => {
        latestGeneratedNews = payload;
        const estimatedValueUpdates = updateEstimatedValuesForNews(payload);
        if (Object.keys(estimatedValueUpdates).length > 0) {
            io.emit('ESTIMATED_VALUE_UPDATE', estimatedValueUpdates);
        }
        void applyStimulusCashForNews(payload).catch(error => {
            console.error('Failed to apply stimulus cash:', error);
        });
        void botManager?.onNews(payload);
    }
});
