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

// need to change this when i go to 1 minute intervals
// but that requires bots to trade often
// and will only need to do that after matching engine built
app.get('/api/stocks/:ticker/price-data', async (req, res) => {
    const { ticker } = req.params;
    const { range = '1d' } = req.query;

    try {
        const stockId = tickerToId.get(ticker);
        if (!stockId) {
            return res.status(404).json({ error: 'Stock not found' });
        }

        // Determine time range and sample interval
        let timeFilter;
        let sampleInterval; // in seconds

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
                     ORDER BY timestamp ASC LIMIT 1) as open,
                    (SELECT price FROM price_history 
                     WHERE stock_id = ? 
                     ORDER BY timestamp DESC LIMIT 1) as current
                FROM price_history
                WHERE stock_id = ? 
                AND timestamp > NOW() - ${timeFilter}
            `, [stockId, stockId, stockId]);

            return res.json({
                name: "",
                description: "",
                current: allRows[0]?.current || 0,
                open: allRows[0]?.open || 0,
                high: allRows[0]?.high || 0,
                low: allRows[0]?.low || 0,
                previousClose: 0,
                chart: []
            });
        }

        // Get previous close
        const [prevCloseRows] = await db.query(`
            SELECT price 
            FROM price_history 
            WHERE stock_id = ? 
            AND timestamp < DATE_SUB(NOW(), ${timeFilter})
            ORDER BY timestamp DESC 
            LIMIT 1
        `, [stockId]);

        const previousClose = prevCloseRows[0]?.price || priceRows[0].price;

        // Calculate stats from sampled data
        const prices = priceRows.map(p => p.price);
        const stats = {
            name: "",
            description: "",
            current: priceRows[priceRows.length - 1]?.price || 0,
            open: priceRows[0]?.price || 0,
            high: Math.max(...prices),
            low: Math.min(...prices),
            previousClose: previousClose,
            chart: priceRows.map(row => ({
                price: row.price,
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
                COALESCE(s.price, 0) as current_price,
                (p.shares * COALESCE(s.price, 0)) as current_value
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

        // Extract cash from first row (same for all rows)
        const cash = rows[0].cash;

        // Filter out null positions (from LEFT JOIN with no portfolio rows)
        const positions = rows
            .filter(row => row.ticker !== null)
            .map(row => ({
                ticker: row.ticker,
                shares: parseFloat(row.shares),
                averagePrice: parseFloat(row.average_price) || 0,
                totalCost: parseFloat(row.total_cost) || 0,
                currentPrice: parseFloat(row.current_price),
                currentValue: parseFloat(row.current_value),
                gainLoss: parseFloat(row.current_value) - parseFloat(row.total_cost),
                gainLossPercent: row.total_cost > 0
                    ? ((parseFloat(row.current_value) - parseFloat(row.total_cost)) / parseFloat(row.total_cost)) * 100
                    : 0
            }));

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

io.on('connection', (socket) => {

    socket.on('register', (userId) => {
        userToSocket.set(userId, socket);
        socketToUser.set(socket.id, userId)
        console.log(`User ${socketToUser.get(socket.id)} registered with socket ${userToSocket.get(userId).id}`);
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

for (const ticker of tickers) {
    await subscriber.subscribe(`orders:depth:${ticker}`);
    console.log(`Subscribed to orders:depth:${ticker}`);
}

const depthCache = new Map(); // ticker -> latest depth snapshot

const convertDepth = (depth) => ({
    asks: depth.asks.map(ask => ({
        price: ask.price / MICRO_UNIT,
        quantity: ask.quantity / MICRO_UNIT
    })),
    bids: depth.bids.map(bid => ({
        price: bid.price / MICRO_UNIT,
        quantity: bid.quantity / MICRO_UNIT
    })),
    lastPrice: depth.lastPrice / MICRO_UNIT
});

let totalFills = 0;
let totalTimeNs = 0

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
            console.log(`Order removed from matching engine: `, data);

            const result = await updateOrderStatus("CANCELED", data.orderId);

            console.log(result)

            if (!result) {
                console.log("But could not be updated in the database! ")
            } else {
                console.log("Order successfully canceled!")
            }
            // Send cancel confirmation to user via websocket
            // Need access to user id for that
        }
        catch (e) {
            console.error(e)
        }
    }

    if (channel === 'orders:filled') {

        const trades = JSON.parse(message);

        const firstTimestamp = trades[0].timestamp;
        const lastTimestamp = trades[trades.length - 1].timestamp;
        const fillCount = trades.length;

        const timeDiffNs = lastTimestamp - firstTimestamp;
        const timeDiffMs = timeDiffNs / 1_000_000; // convert to milliseconds
        const fillsPerSec = (fillCount / timeDiffNs) * 1_000_000_000;

        totalFills += fillCount;
        totalTimeNs += timeDiffNs;
        const avgFillsPerSec = (totalFills / totalTimeNs) * 1_000_000_000;

        console.log(`📊 Batch: ${fillCount} fills in ${timeDiffMs.toFixed(2)}ms → ${fillsPerSec.toFixed(0)} fills/sec | Avg: ${avgFillsPerSec.toFixed(0)} fills/sec`);


        const fillMap = new Map(); // orderId -> { totalQuantity, totalCost, remainingQuantity, lastTimestamp }

        // Still need to update price history table for chart rendering
        const priceHistoryData = [];

        // Aggregate all fills by user before touching the DB
        const userUpdates = new Map(); // userId -> { cashDelta, reservedCashDelta, positions: Map<ticker, {sharesDelta, costDelta, reservedSharesDelta}> }

        for (const trade of trades) {
            const {
                askOrderId, askRemainingQuantity, askUserId,
                bidOrderId, bidRemainingQuantity, bidUserId,
                filledPrice, filledQuantity, ticker, timestamp
            } = trade;

            // For price history — store every individual fill
            priceHistoryData.push({
                ticker,
                price: filledPrice / MICRO_UNIT,
                timestamp,
                tradeId: bidOrderId // or askOrderId
            });

            // Process bid side
            updateFillMap(bidOrderId, bidRemainingQuantity / MICRO_UNIT, filledQuantity / MICRO_UNIT, filledPrice / MICRO_UNIT, timestamp, {
                userId: bidUserId,
                ticker,
                side: 'bid'
            }, fillMap);

            // Process ask side  
            updateFillMap(askOrderId, askRemainingQuantity / MICRO_UNIT, filledQuantity / MICRO_UNIT, filledPrice / MICRO_UNIT, timestamp, {
                userId: askUserId,
                ticker,
                side: 'ask'
            }, fillMap);
        }

        let connection;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            if (priceHistoryData.length > 0) {

                const priceHistoryInserts = priceHistoryData.map(trade => [
                    tickerToId.get(trade.ticker),
                    trade.price,
                    new Date(trade.timestamp / 1000000).toISOString().slice(0, 19).replace('T', ' '),
                    trade.tradeId
                ]);

                await connection.query(
                    `INSERT INTO price_history (stock_id, price, timestamp, trade_id) 
                 VALUES ?`,
                    [priceHistoryInserts]
                );
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

            for (const [orderId, data] of fillMap) {
                if (data.bidUserId) {
                    const user = getOrCreateUser(data.bidUserId);
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

            // Sort by userId for consistent lock ordering — prevents deadlocks
            const sortedUserIds = [...userUpdates.keys()].sort();

            // Build order update query using CASE to do it in one shot
            const orderIds = [...fillMap.keys()];

            const quantityCases = orderIds.map(id => `WHEN id = ? THEN filled_quantity + ?`).join(' ');
            const costCases = orderIds.map(id => `WHEN id = ? THEN filled_cost + ?`).join(' ');
            const statusCases = orderIds.map(id => `WHEN id = ? THEN ?`).join(' ');
            const timestampCases = orderIds.map(id => `WHEN id = ? THEN FROM_UNIXTIME(?)`).join(' ');

            const quantityValues = orderIds.flatMap(id => [id, fillMap.get(id).totalQuantity]);
            const costValues = orderIds.flatMap(id => [id, fillMap.get(id).totalCost]);
            const statusValues = orderIds.flatMap(id => [id, fillMap.get(id).remainingQuantity === 0 ? 'FILLED' : 'PARTIALLY_FILLED']);
            const timestampValues = orderIds.flatMap(id => [id, fillMap.get(id).lastTimestamp]);

            await connection.query(
                `UPDATE orders SET
                    filled_quantity = CASE ${quantityCases} ELSE filled_quantity END,
                    filled_cost     = CASE ${costCases} ELSE filled_cost END,
                    status          = CASE ${statusCases} ELSE status END,
                    updated_at      = CASE ${timestampCases} ELSE updated_at END
                WHERE id IN (?)`,
                [...quantityValues, ...costValues, ...statusValues, ...timestampValues, orderIds]
            );

            for (const userId of sortedUserIds) {
                const { cashDelta, reservedCashDelta, positions } = userUpdates.get(userId);

                await connection.query(
                    `UPDATE users SET 
                        cash = cash + ?,
                        reserved_cash = reserved_cash + ?
                    WHERE user_id = ?`,
                    [cashDelta, reservedCashDelta, userId]
                );

                for (const [ticker, { sharesDelta, costDelta, reservedSharesDelta }] of positions) {
                    await connection.query(
                        `INSERT INTO portfolio (user_id, ticker, shares, total_cost, reserved_shares)
                            VALUES (?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE
                                shares = shares + ?,
                                total_cost = total_cost + ?,
                                reserved_shares = reserved_shares + ?`,
                        [userId, ticker, sharesDelta, costDelta, reservedSharesDelta,
                            sharesDelta, costDelta, reservedSharesDelta]
                    );

                    // Clean up zeroed-out positions
                    await connection.query(
                        `DELETE FROM portfolio WHERE user_id = ? AND ticker = ? AND shares <= 0`,
                        [userId, ticker]
                    );
                }
            }
        }

        catch (err) {
            console.error(err)
            connection.rollback();
            // try everything again? notify all users in this batch about an error?
            // can't just let the orders disappear
        }
        finally {
            await connection.commit();
            connection.release();

            for (const [userId, update] of userUpdates) {
                const socket = userToSocket.get(userId);
                if (!socket) continue; // bot or disconnected user

                // Convert positions Map to plain object for serialization
                const positions = Object.fromEntries(update.positions);

                socket.emit('PORTFOLIO_UPDATE', {
                    cashDelta: update.cashDelta,
                    reservedCashDelta: update.reservedCashDelta,
                    positions,
                });
            }

            // Send order fill updates
            for (const [orderId, data] of fillMap) {
                const userId = data.bidUserId || data.askUserId;
                const socket = userToSocket.get(userId);
                socket?.emit('ORDER_FILLED', { orderId, ...data });
            }
        }


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
            entry.remainingQuantity = remainingQuantity;
            entry.filledQuantity = filledQuantity

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

    // Should only be used for market orders that could not be filled
    // Or limit orders that somehow reached engine while missing required data
    if (channel == 'orders:rejected') {
        const rejected = JSON.parse(message);
        const userId = await removeRejectedOrder(rejected.orderId)
        console.log(`Order ${rejected.orderId} rejected for user ${userId} with reason: ${rejected.reason}`)

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

async function updateOrderStatus(newStatus, orderId) {
    try {
        const [rows] = await db.query('UPDATE orders SET status = ? WHERE id = ?;', [newStatus, orderId])
        return rows[0] || null;
    } catch (err) {
        console.error('Error in updateOrderStatus: ', err);
        throw new Error('Failed to update order status')
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
    const [rows] = await db.query('SELECT id, ticker FROM stocks');
    for (const row of rows) {
        tickerToId.set(row.ticker, row.id);
    }
    console.log(`📦 Loaded ${tickerToId.size} ticker mappings`);
}

// I should move everything that needs to happen on server startup to a separate file
// like app.listen, redis setup, websocket setup, etc


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

        if (side === 'BUY') {
            const [user] = await connection.query(
                'SELECT cash, reserved_cash FROM users WHERE user_id = ? FOR UPDATE',
                [userId]
            );

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
async function startBots() {
    const [rows] = await db.query(
        'SELECT user_id FROM users WHERE username = ? OR username = ? OR username LIKE ?',
        ['market_bot', 'orderbot', 'testuser']
    );

    if (!rows[0]) {
        console.error('Bot user not found');
        return;
    }

    setInterval(async () => {
        const BOT_USER_ID = rows[Math.floor(Math.random() * rows.length)].user_id;
        const ticker = tickers[Math.floor(Math.random() * tickers.length)];
        const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
        const type = Math.random() > 0.5 ? "LIMIT" : "MARKET";

        let price = null;
        if (type === "LIMIT") {
            const cache = depthCache.get(ticker);
            if (cache && cache.bids && cache.asks) {
                if (side === "BUY") {
                    // Buy at current price (mid) or slightly below best ask
                    price = cache.asks[0]?.price || cache.lastPrice;
                } else {
                    // Sell at current price or slightly above best bid
                    price = cache.bids[0]?.price || cache.lastPrice;
                }
            } else {
                price = 100; // fallback
            }
        }

        const quantity = Math.round(Math.random() * 10 + 1);

        await placeOrder({
            userId: BOT_USER_ID,
            ticker,
            side,
            type,
            quantity,
            price: type === "LIMIT" ? price : null
        });
    }, 10);
}

await loadTickerMap();
await initializeDepthCache();
await recoverUnfilledOrders();
startBots();
