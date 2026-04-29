import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';

dotenv.config();

const STARTING_CASH = 5_000_000.00;
const HUMAN_STARTING_CASH = 50_000.00;
const MARKET_MAKER_USERNAME = 'bot_market_maker';
const MARKET_MAKER_STARTING_ORDER_SIZE = 50;
const MARKET_MAKER_STARTING_SPREAD = 0.25;

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

const BOT_PORTFOLIO_ROWS = STARTING_STOCKS.map(({ ticker, price }) => ({
    ticker,
    shares: 1000,
    totalCost: price * 1000,
}));

const TOTAL_STARTING_POSITION_COST = BOT_PORTFOLIO_ROWS.reduce((total, row) => total + row.totalCost, 0);
const STARTING_DEPOSITED_CASH = STARTING_CASH + TOTAL_STARTING_POSITION_COST;

function roundPrice(price) {
    return Math.max(0.01, Math.round(price * 100) / 100);
}

function roundMoney(amount) {
    return Math.round(amount * 100) / 100;
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

async function resetBotPortfolio(connection, username) {
    const [users] = await connection.query(
        'SELECT user_id FROM users WHERE username = ?',
        [username]
    );

    if (users.length !== 1) {
        throw new Error(`Expected one user for ${username}, found ${users.length}.`);
    }

    const userId = users[0].user_id;

    await connection.query(
        `UPDATE users
         SET cash = ?, reserved_cash = 0.00, deposited_cash = ?
         WHERE user_id = ?`,
        [STARTING_CASH, STARTING_DEPOSITED_CASH, userId]
    );

    const portfolioRows = BOT_PORTFOLIO_ROWS.map(({ ticker, shares, totalCost }) => [
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
}

async function resetHumanAccounts(connection) {
    await connection.query(
        `UPDATE users
         SET cash = ?, reserved_cash = 0.00, deposited_cash = ?
         WHERE username NOT LIKE 'bot_%'`,
        [HUMAN_STARTING_CASH, HUMAN_STARTING_CASH]
    );
}

export async function restartSeason() {
    const connection = await createDbConnection();

    try {
        await connection.beginTransaction();

        await connection.query('DELETE FROM orders');
        await connection.query('DELETE FROM price_history');
        await connection.query('DELETE FROM portfolio');

        await resetStockPrices(connection);
        await resetHumanAccounts(connection);

        for (const username of BOT_USERNAMES) {
            await resetBotPortfolio(connection, username);
        }

        const marketMakerLiquidity = await seedMarketMakerLiquidity(connection);

        await connection.commit();

        return {
            botsReset: BOT_USERNAMES.length,
            stocksReset: STARTING_STOCKS.length,
            marketMakerLiquidity,
            startingCash: STARTING_CASH,
            humanStartingCash: HUMAN_STARTING_CASH,
            startingDepositedCash: STARTING_DEPOSITED_CASH,
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
            console.log(`Bots reset: ${result.botsReset}`);
            console.log(`Stocks reset: ${result.stocksReset}`);
            console.log(`Market maker orders seeded: ${result.marketMakerLiquidity.ordersSeeded}`);
            console.log(`Market maker reserved cash: ${result.marketMakerLiquidity.reservedCash.toFixed(2)}`);
            console.log(`Starting cash: ${result.startingCash.toFixed(2)}`);
            console.log(`Human starting cash: ${result.humanStartingCash.toFixed(2)}`);
            console.log(`Deposited cash: ${result.startingDepositedCash.toFixed(2)}`);
        })
        .catch((error) => {
            console.error('Season restart failed.');
            console.error(error);
            process.exitCode = 1;
        });
}
