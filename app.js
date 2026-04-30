import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { startNewsGenerator } from './news/newsEngine.js';
import { createBotManager } from './bots/BotManager.js';
import { createWebsocketServer } from './websocket.js';
import { createRedisLayer } from './redis.js';
import { createMarketServices, tickers } from './helpers.js';

dotenv.config();

const app = express();
const SERVER_PORT = process.env.SERVER_PORT || 3000;
const SOCKET_PORT = process.env.SOCKET_PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET;

app.use(express.json());

const corsOptions = {
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cookieParser());
app.use(cors(corsOptions));

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

const marketServices = createMarketServices({ db });
let latestGeneratedNews = null;

const websocket = createWebsocketServer(app, {
    socketPort: SOCKET_PORT,
    getEstimatedValueEntries: marketServices.getEstimatedValueEntries,
    getLatestGeneratedNews: () => latestGeneratedNews,
    getLatestLeaderboard: marketServices.getLatestLeaderboard,
    broadcastLeaderboardUpdate: marketServices.broadcastLeaderboardUpdate,
    getDepth: marketServices.getDepth,
    verifyOrderOwnership: marketServices.verifyOrderOwnership,
    publishCancelOrder: marketServices.publishCancelOrder
});

marketServices.setIo(websocket.io);
marketServices.setUserToSocket(websocket.userToSocket);

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
        const [existingUser] = await db.query(
            'SELECT user_id FROM users WHERE username = ?',
            [username]
        );

        if (existingUser.length > 0) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const hash = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO users (username, p_hash) VALUES (?, ?)',
            [username, hash]
        );

        const [newUser] = await db.query(
            'SELECT user_id, username FROM users WHERE username = ?',
            [username]
        );

        const user = newUser[0];
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

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const [users] = await db.query(
            'SELECT user_id, username, p_hash FROM users WHERE username = ?',
            [username]
        );

        const user = users[0];
        const dummyHash = '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123';
        const hashToCompare = user ? user.p_hash : dummyHash;
        const validPassword = await bcrypt.compare(password, hashToCompare);

        if (!user || !validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

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

        res.json({
            message: 'Login successful',
            user: { user_id: user.user_id, username: user.username }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

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

        let timeFilter;
        let sampleInterval;

        switch (range) {
            case '1m':
                timeFilter = "INTERVAL 1 MINUTE";
                sampleInterval = 1;
                break;
            case '5m':
                timeFilter = "INTERVAL 5 MINUTE";
                sampleInterval = 5;
                break;
            case '1h':
                timeFilter = "INTERVAL 1 HOUR";
                sampleInterval = 60;
                break;
            case '1d':
                timeFilter = "INTERVAL 24 HOUR";
                sampleInterval = 300;
                break;
            case '1w':
                timeFilter = "INTERVAL 7 DAY";
                sampleInterval = 3600;
                break;
            default:
                timeFilter = "INTERVAL 24 HOUR";
                sampleInterval = 300;
        }

        const [priceRows] = await db.query(`
            SELECT
                price,
                timestamp
            FROM price_history
            WHERE stock_id = ?
            AND timestamp > NOW() - ${timeFilter}
            AND UNIX_TIMESTAMP(timestamp) % ? = 0
            ORDER BY timestamp ASC
        `, [stock.id, sampleInterval]);

        const [volumeRows] = await db.query(`
            SELECT COALESCE(SUM(filled), 0) as volume24h
            FROM price_history
            WHERE stock_id = ?
            AND timestamp > NOW() - INTERVAL 24 HOUR
        `, [stock.id]);

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
            `, [stock.id, stock.id]);

            const current = Number(allRows[0]?.current ?? stock.price ?? 0);
            const estimatedValue = marketServices.estimatedValueByTicker.get(ticker)
                ?? marketServices.createEstimatedValueRange(current, marketServices.getCompanyProfile(ticker)?.archetype);

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

        const prices = priceRows.map(p => Number(p.price));
        const current = Number(priceRows[priceRows.length - 1]?.price ?? stock.price ?? 0);
        const estimatedValue = marketServices.estimatedValueByTicker.get(ticker)
            ?? marketServices.createEstimatedValueRange(current, marketServices.getCompanyProfile(ticker)?.archetype);

        res.json({
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
        });
    } catch (err) {
        console.error('Error in price-data:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/auth/logout', (req, res) => {
    res.clearCookie('paper-trader-session');
    res.json({ message: 'Logged out successfully' });
});

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

    const result = await marketServices.placeOrder({ userId, ticker, side, type, quantity, price });
    return res.status(result.statusCode).json(result);
});

app.get('/api/portfolio', async (req, res) => {
    try {
        const token = req.cookies?.["paper-trader-session"];

        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const userId = jwt.verify(token, process.env.JWT_SECRET).id;

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
        const positions = rows
            .filter(row => row.ticker !== null)
            .map(row => {
                const shares = parseFloat(row.shares) || 0;
                const totalCost = parseFloat(row.total_cost) || 0;
                const currentPrice = marketServices.getPortfolioCurrentPrice(row.ticker, row.current_price);
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
        const token = req.cookies?.["paper-trader-session"];

        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const userId = jwt.verify(token, process.env.JWT_SECRET).id;
        const [rows] = await db.query(`
            SELECT * from orders WHERE user_id = ?;
        `, [userId]);

        if (rows.length === 0) {
            return res.json({
                orders: []
            });
        }

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

        res.json({ orders });
    } catch (error) {
        console.error('Error fetching portfolio:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio data' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const rankings = await marketServices.buildLeaderboard();
        res.json(rankings);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard data' });
    }
});

app.listen(SERVER_PORT, () => {
    console.log(`Server running on port ${SERVER_PORT}`);
});

websocket.listen();

const redisLayer = await createRedisLayer({
    tickers,
    io: websocket.io,
    depthCache: marketServices.depthCache,
    convertDepth: marketServices.convertDepth,
    cancelOrderInDatabase: marketServices.cancelOrderInDatabase,
    enqueueFillTrades: marketServices.enqueueFillTrades,
    normalizeRejectedOrdersPayload: marketServices.normalizeRejectedOrdersPayload,
    applyOrderRejectionToDatabase: marketServices.applyOrderRejectionToDatabase,
    toNormalUnits: marketServices.toNormalUnits,
    userToSocket: websocket.userToSocket,
    getBotManager: marketServices.getBotManager
});

marketServices.setPublisher(redisLayer.publisher);
marketServices.setRedisClient(redisLayer.redisClient);

await marketServices.loadTickerMap();
await marketServices.initializeDepthCache();
await marketServices.recoverUnfilledOrders();

const botManager = createBotManager({
    db,
    placeOrder: marketServices.placeOrder,
    cancelOrder: marketServices.cancelOrder,
    getDepth: marketServices.getDepth,
    logger: console
});

marketServices.setBotManager(botManager);
await botManager.start();
marketServices.startLeaderboardBroadcasts();

startNewsGenerator(websocket.io, {
    intervalMs: 30_000,
    emitOnStart: true,
    onEmit: (payload) => {
        latestGeneratedNews = payload;
        const estimatedValueUpdates = marketServices.updateEstimatedValuesForNews(payload);
        if (Object.keys(estimatedValueUpdates).length > 0) {
            websocket.io.emit('ESTIMATED_VALUE_UPDATE', estimatedValueUpdates);
        }
        void marketServices.applyStimulusCashForNews(payload).catch(error => {
            console.error('Failed to apply stimulus cash:', error);
        });
        void botManager?.onNews(payload);
    }
});
