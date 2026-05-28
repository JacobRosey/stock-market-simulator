import dotenv from 'dotenv';
import Redis from 'ioredis';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import { ensureDatabaseReady } from './db-bootstrap.js';

dotenv.config();

const BOT_STARTING_ACCOUNT_VALUE = 6_855_000.00;
const HUMAN_STARTING_CASH = 50_000.00;
const GUEST_USERNAME = 'guest';
const GUEST_PASSWORD_HASH = '$2b$10$.CZVOmm3NE6RhOHcObuq3uGPP7SpizQlQGQuUGpSQJpKr6v/z9bIu';
const MARKET_MAKER_USERNAME = 'bot_market_maker';
const MARKET_MAKER_STARTING_ORDER_SIZE = 50;
const MARKET_MAKER_STARTING_SPREAD = 0.25;
const REDIS_SEASON_KEYS = [
    'orders:recovery',
    'orders:new',
    'orders:filled',
    'orders:rejected',
    'orders:cancel',
];

const BOT_USERNAMES = [
    'bot_market_maker',
    'bot_contrarian',
    'bot_whale',
    'bot_news_junkie',
    'bot_trend_rider',
    'bot_value_hunter',
    'bot_noise_trader',
    'bot_skeptic',
    'bot_optimist',
];

const STARTING_STOCKS = [
    { ticker: 'NEXUS', price: 250.00 },
    { ticker: 'QCI', price: 45.00 },
    { ticker: 'CLSE', price: 85.00 },
    { ticker: 'NSMC', price: 65.00 },
    { ticker: 'AGB', price: 180.00 },
    { ticker: 'CRC', price: 55.00 },
    { ticker: 'SGI', price: 120.00 },
    { ticker: 'FINT', price: 40.00 },
    { ticker: 'MEGA', price: 90.00 },
    { ticker: 'TREND', price: 35.00 },
    { ticker: 'GLG', price: 75.00 },
    { ticker: 'CLICK', price: 60.00 },
    { ticker: 'IDYN', price: 150.00 },
    { ticker: 'AUTO', price: 45.00 },
    { ticker: 'AERO', price: 130.00 },
    { ticker: 'GSYS', price: 70.00 },
    { ticker: 'GMED', price: 200.00 },
    { ticker: 'BIOV', price: 25.00 },
    { ticker: 'GENH', price: 40.00 },
    { ticker: 'NEURO', price: 95.00 },
];

const BOT_STARTING_PORTFOLIOS = {
    bot_market_maker: {
        cashShare: 0.35,
        weights: {
            NEXUS: 0.08,
            QCI: 0.035,
            CLSE: 0.045,
            NSMC: 0.04,
            AGB: 0.075,
            CRC: 0.035,
            SGI: 0.045,
            FINT: 0.035,
            MEGA: 0.075,
            TREND: 0.035,
            GLG: 0.045,
            CLICK: 0.035,
            IDYN: 0.075,
            AUTO: 0.04,
            AERO: 0.075,
            GSYS: 0.035,
            GMED: 0.075,
            BIOV: 0.035,
            GENH: 0.05,
            NEURO: 0.035,
        },
    },
    bot_contrarian: {
        cashShare: 0.40,
        weights: {
            BIOV: 0.16,
            QCI: 0.13,
            CRC: 0.12,
            TREND: 0.10,
            AUTO: 0.09,
            NSMC: 0.09,
            AGB: 0.08,
            GMED: 0.08,
            MEGA: 0.07,
            FINT: 0.04,
            GSYS: 0.04,
        },
    },
    bot_whale: {
        cashShare: 0.75,
        weights: {
            NEXUS: 0.24,
            AGB: 0.18,
            GMED: 0.18,
            AERO: 0.14,
            MEGA: 0.12,
            QCI: 0.05,
            BIOV: 0.05,
            FINT: 0.04,
        },
    },
    bot_news_junkie: {
        cashShare: 0.30,
        weights: {
            QCI: 0.12,
            FINT: 0.11,
            TREND: 0.10,
            CLICK: 0.10,
            GSYS: 0.10,
            BIOV: 0.12,
            NEURO: 0.10,
            NSMC: 0.08,
            AUTO: 0.07,
            NEXUS: 0.04,
            GMED: 0.03,
            MEGA: 0.03,
        },
    },
    bot_trend_rider: {
        cashShare: 0.25,
        weights: {
            QCI: 0.14,
            FINT: 0.13,
            CLICK: 0.12,
            TREND: 0.12,
            GSYS: 0.11,
            BIOV: 0.14,
            NEURO: 0.10,
            NSMC: 0.08,
            AUTO: 0.06,
        },
    },
    bot_value_hunter: {
        cashShare: 0.50,
        weights: {
            AGB: 0.16,
            SGI: 0.14,
            GMED: 0.16,
            GENH: 0.10,
            IDYN: 0.13,
            AERO: 0.13,
            CLSE: 0.10,
            GLG: 0.08,
        },
    },
    bot_noise_trader: {
        cashShare: 0.20,
        weights: {
            BIOV: 0.17,
            MEGA: 0.04,
            QCI: 0.13,
            GENH: 0.05,
            CLICK: 0.11,
            AERO: 0.03,
            CRC: 0.09,
            CLSE: 0.06,
            TREND: 0.10,
            GMED: 0.04,
            NSMC: 0.07,
            FINT: 0.08,
            GLG: 0.03,
        },
    },
    bot_skeptic: {
        cashShare: 0.45,
        weights: {
            AGB: 0.17,
            SGI: 0.15,
            MEGA: 0.14,
            AERO: 0.15,
            GMED: 0.17,
            GENH: 0.10,
            IDYN: 0.12,
        },
    },
    bot_optimist: {
        cashShare: 0.20,
        weights: {
            QCI: 0.15,
            FINT: 0.14,
            CLICK: 0.13,
            GSYS: 0.13,
            BIOV: 0.16,
            NEURO: 0.12,
            TREND: 0.10,
            NEXUS: 0.03,
            CLSE: 0.02,
            GLG: 0.02,
        },
    },
};

const STARTING_STOCK_PRICE_BY_TICKER = new Map(
    STARTING_STOCKS.map(({ ticker, price }) => [ticker, price])
);

function roundPrice(price) {
    return Math.max(0.01, Math.round(price * 100) / 100);
}

function roundMoney(amount) {
    return Math.round(amount * 100) / 100;
}

function assertPortfolioConfig(username, profile) {
    if (!profile) {
        throw new Error(`Missing starting portfolio config for ${username}.`);
    }

    const cashShare = Number(profile.cashShare);
    if (!Number.isFinite(cashShare) || cashShare < 0 || cashShare >= 1) {
        throw new Error(`Invalid cash share for ${username}: ${profile.cashShare}.`);
    }

    const weightTotal = Object.values(profile.weights ?? {})
        .reduce((total, weight) => total + Number(weight), 0);
    if (Math.abs(weightTotal - 1) > 0.000001) {
        throw new Error(`Starting portfolio weights for ${username} must total 1. Found ${weightTotal}.`);
    }

    for (const ticker of Object.keys(profile.weights ?? {})) {
        if (!STARTING_STOCK_PRICE_BY_TICKER.has(ticker)) {
            throw new Error(`Starting portfolio for ${username} references unknown ticker ${ticker}.`);
        }
    }
}

function buildBotStartingPortfolio(username) {
    const profile = BOT_STARTING_PORTFOLIOS[username];
    assertPortfolioConfig(username, profile);

    const targetStockValue = BOT_STARTING_ACCOUNT_VALUE * (1 - profile.cashShare);
    const rows = Object.entries(profile.weights)
        .map(([ticker, weight]) => {
            const price = STARTING_STOCK_PRICE_BY_TICKER.get(ticker);
            const targetValue = targetStockValue * weight;
            const shares = Math.floor(targetValue / price);

            return {
                ticker,
                shares,
                totalCost: roundMoney(shares * price),
            };
        })
        .filter(({ shares }) => shares > 0);

    const stockValue = rows.reduce((total, row) => total + row.totalCost, 0);
    const cash = roundMoney(BOT_STARTING_ACCOUNT_VALUE - stockValue);

    return { cash, rows };
}

function validateBotStartingPortfolios() {
    for (const username of BOT_USERNAMES) {
        buildBotStartingPortfolio(username);
    }

    const marketMakerPortfolio = buildBotStartingPortfolio(MARKET_MAKER_USERNAME);
    const marketMakerRowsByTicker = new Map(
        marketMakerPortfolio.rows.map(({ ticker, shares }) => [ticker, shares])
    );
    const underfundedTickers = STARTING_STOCKS
        .filter(({ ticker }) => (
            (marketMakerRowsByTicker.get(ticker) ?? 0) < MARKET_MAKER_STARTING_ORDER_SIZE
        ))
        .map(({ ticker }) => ticker);

    if (underfundedTickers.length > 0) {
        throw new Error(`Market maker needs at least ${MARKET_MAKER_STARTING_ORDER_SIZE} shares for: ${underfundedTickers.join(', ')}.`);
    }
}

validateBotStartingPortfolios();

async function ensureBotUsers(connection) {
    const botPasswordHash = '$2b$10$VJ3zD8n9xlEMvE4y.z4Vlu.NFjWqz7F5gqRZkNQY2ksPJ4p5z7X0e';
    let createdBots = 0;

    for (const username of BOT_USERNAMES) {
        const [existingUsers] = await connection.query(
            'SELECT user_id FROM users WHERE username = ?',
            [username]
        );

        if (existingUsers.length === 0) {
            await connection.query(
                `INSERT INTO users (username, p_hash, cash, reserved_cash, deposited_cash)
                 VALUES (?, ?, 0.00, 0.00, 0.00)`,
                [username, botPasswordHash]
            );

            createdBots += 1;
        } else if (existingUsers.length > 1) {
            throw new Error(`Expected at most one user for ${username}, found ${existingUsers.length}.`);
        }
    }

    return createdBots;
}

async function ensureGuestUser(connection) {
    const [existingUsers] = await connection.query(
        'SELECT user_id FROM users WHERE username = ?',
        [GUEST_USERNAME]
    );

    if (existingUsers.length === 0) {
        await connection.query(
            `INSERT INTO users (username, p_hash, cash, reserved_cash, deposited_cash)
             VALUES (?, ?, 0.00, 0.00, 0.00)`,
            [GUEST_USERNAME, GUEST_PASSWORD_HASH]
        );

        return true;
    }

    if (existingUsers.length > 1) {
        throw new Error(`Expected at most one user for ${GUEST_USERNAME}, found ${existingUsers.length}.`);
    }

    await connection.query(
        'UPDATE users SET p_hash = ? WHERE username = ?',
        [GUEST_PASSWORD_HASH, GUEST_USERNAME]
    );

    return false;
}

function createDbConnection() {
    return mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });
}

function createRedisClient() {
    const options = {
        lazyConnect: true,
        connectTimeout: 1000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
    };

    return process.env.REDIS_URL
        ? new Redis(process.env.REDIS_URL, options)
        : new Redis(options);
}

async function clearRedisSeasonState() {
    const redis = createRedisClient();

    try {
        await redis.connect();
        const keysDeleted = await redis.del(...REDIS_SEASON_KEYS);
        return {
            attempted: true,
            cleared: true,
            keysDeleted,
        };
    } catch (error) {
        console.warn(`Skipped Redis season state clear: ${error.message}`);
        return {
            attempted: true,
            cleared: false,
            error: error.message,
        };
    } finally {
        redis.disconnect();
    }
}

async function resetBotPortfolio(connection, username) {
    const [users] = await connection.query(
        'SELECT user_id FROM users WHERE username = ?',
        [username]
    );

    if (users.length !== 1) {
        throw new Error(`Expected one user for ${username}, found ${users.length}.`);
    }

    const userId = users[0].user_id;
    const startingPortfolio = buildBotStartingPortfolio(username);

    await connection.query(
        `UPDATE users
         SET cash = ?, reserved_cash = 0.00, deposited_cash = ?
         WHERE user_id = ?`,
        [startingPortfolio.cash, BOT_STARTING_ACCOUNT_VALUE, userId]
    );

    const portfolioRows = startingPortfolio.rows.map(({ ticker, shares, totalCost }) => [
        userId,
        ticker,
        shares,
        totalCost,
        0,
    ]);

    await connection.query(
        `INSERT INTO portfolio (user_id, ticker, shares, total_cost, reserved_shares)
         VALUES ?`,
        [portfolioRows]
    );

    return userId;
}

async function seedMarketMakerLiquidity(connection) {
    const [users] = await connection.query(
        'SELECT user_id FROM users WHERE username = ?',
        [MARKET_MAKER_USERNAME]
    );

    if (users.length !== 1) {
        throw new Error(`Expected one user for ${MARKET_MAKER_USERNAME}, found ${users.length}.`);
    }

    const userId = users[0].user_id;
    const halfSpread = MARKET_MAKER_STARTING_SPREAD / 2;
    const orderRows = [];
    let reservedCash = 0;

    for (const { ticker, price } of STARTING_STOCKS) {
        const bidPrice = roundPrice(price - halfSpread);
        const askPrice = roundPrice(price + halfSpread);
        console.log(ticker, bidPrice, askPrice)
        const bidEstimatedAmount = roundMoney(bidPrice * MARKET_MAKER_STARTING_ORDER_SIZE);
        const askEstimatedAmount = roundMoney(askPrice * MARKET_MAKER_STARTING_ORDER_SIZE);

        reservedCash += bidEstimatedAmount;

        orderRows.push([
            userId,
            ticker,
            'BUY',
            'LIMIT',
            bidPrice,
            MARKET_MAKER_STARTING_ORDER_SIZE,
            'OPEN',
            bidEstimatedAmount,
        ]);

        orderRows.push([
            userId,
            ticker,
            'SELL',
            'LIMIT',
            askPrice,
            MARKET_MAKER_STARTING_ORDER_SIZE,
            'OPEN',
            askEstimatedAmount,
        ]);
    }

    await connection.query(
        `INSERT INTO orders (user_id, ticker, side, type, price, quantity, status, estimated_amount)
         VALUES ?`,
        [orderRows]
    );

    await connection.query(
        `UPDATE users
         SET reserved_cash = reserved_cash + ?
         WHERE user_id = ?`,
        [reservedCash, userId]
    );

    await connection.query(
        `UPDATE portfolio
         SET reserved_shares = reserved_shares + ?
         WHERE user_id = ?
         AND ticker IN (?)`,
        [MARKET_MAKER_STARTING_ORDER_SIZE, userId, STARTING_STOCKS.map(({ ticker }) => ticker)]
    );

    return {
        ordersSeeded: orderRows.length,
        reservedCash,
        reservedSharesPerTicker: MARKET_MAKER_STARTING_ORDER_SIZE,
    };
}

async function resetStockPrices(connection) {
    const priceCases = STARTING_STOCKS.map(() => 'WHEN ticker = ? THEN ?').join(' ');
    const priceValues = STARTING_STOCKS.flatMap(({ ticker, price }) => [ticker, price]);
    const tickers = STARTING_STOCKS.map(({ ticker }) => ticker);

    await connection.query(
        `UPDATE stocks
         SET price = CASE ${priceCases} ELSE price END
         WHERE ticker IN (?)`,
        [...priceValues, tickers]
    );

    const [rows] = await connection.query(
        'SELECT ticker, price FROM stocks WHERE ticker IN (?)',
        [tickers]
    );

    const storedPrices = new Map(rows.map((row) => [row.ticker, Number(row.price)]));
    const mismatchedTickers = STARTING_STOCKS
        .filter(({ ticker, price }) => storedPrices.get(ticker) !== price)
        .map(({ ticker }) => ticker);

    if (rows.length !== STARTING_STOCKS.length || mismatchedTickers.length > 0) {
        throw new Error(`Stock price reset verification failed for: ${mismatchedTickers.join(', ') || 'missing ticker'}.`);
    }

    return Object.fromEntries(
        STARTING_STOCKS.map(({ ticker }) => [ticker, storedPrices.get(ticker)])
    );
}

async function resetHumanAccounts(connection) {
    await connection.query(
        `UPDATE users
         SET cash = ?, reserved_cash = 0.00, deposited_cash = ?
         WHERE username NOT LIKE 'bot_%'`,
        [HUMAN_STARTING_CASH, HUMAN_STARTING_CASH]
    );
}

async function wipeSeasonActivity(connection) {
    await connection.query('DELETE FROM orders');
    await connection.query('DELETE FROM price_history');
    await connection.query('DELETE FROM portfolio');
}

export async function restartSeason() {
    await ensureDatabaseReady();

    const connection = await createDbConnection();

    try {
        await connection.beginTransaction();

        await wipeSeasonActivity(connection);

        const resetPrices = await resetStockPrices(connection);

        const botsCreated = await ensureBotUsers(connection);
        const guestCreated = await ensureGuestUser(connection);

        await resetHumanAccounts(connection);

        for (const username of BOT_USERNAMES) {
            await resetBotPortfolio(connection, username);
        }
        const marketMakerLiquidity = await seedMarketMakerLiquidity(connection);

        await connection.commit();
        const redisSeasonState = await clearRedisSeasonState();

        return {
            botsCreated,
            guestCreated,
            botsReset: BOT_USERNAMES.length,
            stocksReset: STARTING_STOCKS.length,
            resetPrices,
            marketMakerLiquidity,
            redisSeasonState,
            botStartingAccountValue: BOT_STARTING_ACCOUNT_VALUE,
            humanStartingCash: HUMAN_STARTING_CASH,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
    restartSeason()
        .then((result) => {
            console.log('Season restart completed.');
            console.log(`Bots created: ${result.botsCreated}`);
            console.log(`Guest created: ${result.guestCreated}`);
            console.log(`Bots reset: ${result.botsReset}`);
            console.log(`Stocks reset: ${result.stocksReset}`);
            console.log(`BIOV reset price: ${result.resetPrices.BIOV}`);
            console.log(`Market maker orders seeded: ${result.marketMakerLiquidity.ordersSeeded}`);
            console.log(`Market maker reserved cash: ${result.marketMakerLiquidity.reservedCash.toFixed(2)}`);
            if (result.redisSeasonState.cleared) {
                console.log(`Redis season keys deleted: ${result.redisSeasonState.keysDeleted}`);
            } else {
                console.log(`Redis season keys not cleared: ${result.redisSeasonState.error}`);
            }
            console.log(`Bot starting account value: ${result.botStartingAccountValue.toFixed(2)}`);
            console.log(`Human starting cash: ${result.humanStartingCash.toFixed(2)}`);
        })
        .catch((error) => {
            console.error('Season restart failed.');
            console.error(error);
            process.exitCode = 1;
        });
}
