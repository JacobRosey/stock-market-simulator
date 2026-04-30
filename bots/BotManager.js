import { BOT_NAME_TO_STRATEGY } from './strategies/index.js';
import { COMPANY_TYPES } from '../news/headlineLibrary.js';
import { getReferencePrice, roundPrice } from './strategies/shared.js';

const MICRO_UNIT = 1e6;
const MIN_SENTIMENT = -10;
const MAX_SENTIMENT = 10;
const SENTIMENT_DECAY_INTERVAL_MS = 20_000;
const MIN_SENTIMENT_ACTION_COOLDOWN_MS = 45_000;
const MAX_SENTIMENT_ACTION_COOLDOWN_MS = 60_000;
const LIMIT_ORDER_MAX_AGE_MS = 120_000;
const LIMIT_ORDER_MAX_DISTANCE_FROM_REFERENCE = 0.12;
const EXIT_TRIGGER_STEP = 0.05;
const EXIT_CHECK_COOLDOWN_MS = 15_000;
const EXIT_BASE_PROBABILITY = 0.25;
const EXIT_PROBABILITY_PER_STEP = 0.2;
const EXIT_MAX_PROBABILITY = 0.85;
const EXIT_MAX_POSITION_SHARE = 0.2;
const EXIT_MAX_OPEN_SELL_SHARE = 0.3;
const TAKE_PROFIT_LIMIT_OFFSET = 0.03;
const STOP_LOSS_LIMIT_OFFSET = 0.03;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toNormal(microValue) {
    return (microValue ?? 0) / MICRO_UNIT;
}

function getSentimentActionCooldownMs(sentiment, strategy) {
    if (Number.isFinite(strategy?.sentimentCooldownMs)) {
        return strategy.sentimentCooldownMs;
    }

    const conviction = clamp(Math.abs(sentiment ?? 0) / MAX_SENTIMENT, 0, 1);
    return Math.round(MAX_SENTIMENT_ACTION_COOLDOWN_MS - conviction * (
        MAX_SENTIMENT_ACTION_COOLDOWN_MS - MIN_SENTIMENT_ACTION_COOLDOWN_MS
    ));
}

function resolveNewsTickers(news) {
    if (!news) return [];

    if (Array.isArray(news.affectedTickers) && news.affectedTickers.length > 0) {
        return [...new Set(news.affectedTickers)];
    }

    if (Array.isArray(news.affectedSectors) && news.affectedSectors.length > 0) {
        const sectorSet = new Set(news.affectedSectors);
        return COMPANY_TYPES
            .filter((company) => sectorSet.has(company.sector))
            .map((company) => company.ticker);
    }

    if (news.global) {
        return COMPANY_TYPES.map((company) => company.ticker);
    }

    return [];
}

class BotRuntime {
    constructor(user, strategy, dependencies) {
        this.userId = user.user_id;
        this.username = user.username;
        this.strategy = strategy;
        this.placeOrder = dependencies.placeOrder;
        this.cancelOrder = dependencies.cancelOrder;
        this.getDepth = dependencies.getDepth;
        this.tickers = dependencies.tickers;
        this.logger = dependencies.logger;
        this.sentimentByTicker = dependencies.sentimentByTicker;
        this.sentimentSignalVersionByTicker = dependencies.sentimentSignalVersionByTicker;

        this.cash = Number(user.cash ?? 0);
        this.reservedCash = Number(user.reserved_cash ?? 0);
        this.depositedCash = Number(user.deposited_cash ?? 0);
        this.positions = new Map();
        this.openOrders = new Map();
        this.consumedSignalVersionByTicker = new Map();
        this.sentimentCooldownUntilByTicker = new Map();
        this.exitCooldownUntilByTicker = new Map();

        this._busy = false;
        this._tickTimer = null;
    }

    startTicking(runTick) {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
        }

        this._tickTimer = setInterval(() => {
            void runTick(this);
        }, this.strategy.intervalMs);
    }

    stopTicking() {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = null;
        }
    }

    hydratePosition(row) {
        this.positions.set(row.ticker, {
            shares: Number(row.shares ?? 0),
            reservedShares: Number(row.reserved_shares ?? 0),
            totalCost: Number(row.total_cost ?? 0),
        });
    }

    hydrateOrder(row) {
        const remainingQuantity = Math.max(0, Number(row.quantity ?? 0) - Number(row.filled_quantity ?? 0));
        this.openOrders.set(row.id, {
            orderId: row.id,
            ticker: row.ticker,
            side: row.side,
            type: row.type,
            remainingQuantity,
            reservedRemaining: Number(row.estimated_amount ?? 0) - Number(row.filled_cost ?? 0),
            price: Number(row.price ?? 0),
            createdAt: new Date(row.created_at ?? Date.now()).getTime(),
            status: row.status,
        });
    }

    getPosition(ticker) {
        if (!this.positions.has(ticker)) {
            this.positions.set(ticker, { shares: 0, reservedShares: 0, totalCost: 0 });
        }
        return this.positions.get(ticker);
    }

    getAvailableShares(ticker) {
        const position = this.positions.get(ticker);
        if (!position) return 0;
        return Math.max(0, position.shares - position.reservedShares);
    }

    getShares(ticker) {
        const position = this.positions.get(ticker);
        return Math.max(0, Number(position?.shares ?? 0));
    }

    getOpenOrderCount(ticker, side) {
        let count = 0;
        for (const order of this.openOrders.values()) {
            if (order.ticker === ticker && order.side === side && order.remainingQuantity > 0) {
                count += order.remainingQuantity;
            }
        }
        return count;
    }

    async reactToNews(news) {
        if (!this.strategy.onNews) return;
        await this._execute((context) => this.strategy.onNews(context), news);
    }

    async runTick() {
        if (!this.strategy.onTick) return;
        await this._execute((context) => this.strategy.onTick(context));
    }

    async _execute(intentBuilder, news = null) {
        if (this._busy) return;
        this._busy = true;

        try {
            await this._cancelStaleLimitOrders();

            const context = {
                bot: this,
                news,
                tickers: this.tickers,
                getDepth: this.getDepth,
                getOpenOrderCount: (ticker, side) => this.getOpenOrderCount(ticker, side),
                getAvailableShares: (ticker) => this.getAvailableShares(ticker),
                getShares: (ticker) => this.getShares(ticker),
                sentimentByTicker: this._getActionableSentimentSnapshot(),
                getSentiment: (ticker) => this._isSentimentActionable(ticker)
                    ? this.sentimentByTicker.get(ticker) ?? 0
                    : 0,
            };

            const intents = [
                ...this._buildExitIntents(),
                ...(intentBuilder(context) ?? []),
            ];
            for (const intent of intents) {
                await this._placeIntent(intent);
                if (intent?.consumeSentimentScope === 'all') {
                    this._consumeAllSentimentSignals();
                    continue;
                }
                if (intent?.consumeSentiment) {
                    this._consumeSentimentSignal(intent.ticker);
                }
            }
        } catch (error) {
            this.logger.warn(`[${this.strategy.displayName}] strategy execution failed`, error);
        } finally {
            this._busy = false;
        }
    }

    _getActionableSentimentSnapshot() {
        const snapshot = new Map();
        for (const ticker of this.tickers) {
            if (!this._isSentimentActionable(ticker)) continue;
            const sentiment = this.sentimentByTicker.get(ticker) ?? 0;
            if (sentiment !== 0) {
                snapshot.set(ticker, sentiment);
            }
        }
        return snapshot;
    }

    _isSentimentActionable(ticker) {
        const currentVersion = this.sentimentSignalVersionByTicker?.get(ticker) ?? 0;
        const currentSentiment = this.sentimentByTicker.get(ticker) ?? 0;
        if (currentVersion <= 0 || currentSentiment === 0) return false;

        const consumedVersion = this.consumedSignalVersionByTicker.get(ticker) ?? 0;
        if (consumedVersion < currentVersion) return true;

        const cooldownUntil = this.sentimentCooldownUntilByTicker.get(ticker) ?? 0;
        return Date.now() >= cooldownUntil;
    }

    _consumeSentimentSignal(ticker) {
        if (!ticker) return;

        const currentVersion = this.sentimentSignalVersionByTicker?.get(ticker) ?? 0;
        if (currentVersion > 0) {
            this.consumedSignalVersionByTicker.set(ticker, currentVersion);
        }

        const sentiment = this.sentimentByTicker.get(ticker) ?? 0;
        if (sentiment !== 0) {
            this.sentimentCooldownUntilByTicker.set(
                ticker,
                Date.now() + getSentimentActionCooldownMs(sentiment, this.strategy)
            );
        }
    }

    _consumeAllSentimentSignals() {
        for (const ticker of this.tickers) {
            this._consumeSentimentSignal(ticker);
        }
    }

    async _placeIntent(intent) {
        const quantity = Number(intent.quantity ?? 0);
        if (!intent?.ticker || !intent?.side || !intent?.type || quantity <= 0) return;

        if (intent.side === 'SELL' && this.getAvailableShares(intent.ticker) < quantity) {
            return;
        }

        const orderInput = {
            userId: this.userId,
            ticker: intent.ticker,
            side: intent.side,
            type: intent.type,
            quantity,
            price: intent.type === 'LIMIT' ? Number(intent.price) : null,
        };

        const result = await this.placeOrder(orderInput);

        if (!result?.success) {
            return;
        }

        const order = {
            orderId: result.orderId,
            ticker: orderInput.ticker,
            side: orderInput.side,
            type: orderInput.type,
            remainingQuantity: orderInput.quantity,
            reservedRemaining: Number(result.estimatedCost ?? 0),
            price: orderInput.price,
            createdAt: Date.now(),
            status: 'OPEN',
        };

        this.openOrders.set(order.orderId, order);

        if (order.side === 'SELL') {
            const position = this.getPosition(order.ticker);
            position.reservedShares += order.remainingQuantity;
        }

        if (order.side === 'BUY') {
            this.reservedCash += order.reservedRemaining;
        }
    }

    _buildExitIntents() {
        const intents = [];
        const now = Date.now();

        for (const [ticker, position] of this.positions.entries()) {
            const shares = Number(position.shares ?? 0);
            const totalCost = Number(position.totalCost ?? 0);
            const averageCost = shares > 0 ? totalCost / shares : 0;
            if (shares <= 0 || averageCost <= 0) continue;

            const availableShares = this.getAvailableShares(ticker);
            if (availableShares < 1) continue;

            const cooldownUntil = this.exitCooldownUntilByTicker.get(ticker) ?? 0;
            if (now < cooldownUntil) continue;

            const referencePrice = getReferencePrice(this.getDepth, ticker);
            if (!Number.isFinite(referencePrice) || referencePrice <= 0) continue;

            const gainPercent = (referencePrice - averageCost) / averageCost;
            const isTakeProfit = gainPercent >= EXIT_TRIGGER_STEP;
            const isStopLoss = gainPercent <= -EXIT_TRIGGER_STEP;
            if (!isTakeProfit && !isStopLoss) continue;

            const openSellQuantity = this.getOpenOrderCount(ticker, 'SELL');
            const maxOpenSellQuantity = Math.max(1, Math.floor(shares * EXIT_MAX_OPEN_SELL_SHARE));
            if (openSellQuantity >= maxOpenSellQuantity) continue;

            const triggerSteps = Math.floor(Math.abs(gainPercent) / EXIT_TRIGGER_STEP);
            const probability = Math.min(
                EXIT_MAX_PROBABILITY,
                EXIT_BASE_PROBABILITY + Math.max(0, triggerSteps - 1) * EXIT_PROBABILITY_PER_STEP
            );

            if (Math.random() > probability) {
                this.exitCooldownUntilByTicker.set(ticker, now + EXIT_CHECK_COOLDOWN_MS);
                continue;
            }

            const maxPositionQuantity = Math.max(1, Math.floor(shares * EXIT_MAX_POSITION_SHARE));
            const desiredQuantity = Math.min(
                availableShares,
                maxPositionQuantity,
                maxOpenSellQuantity - openSellQuantity
            );
            const quantity = Math.floor(desiredQuantity);
            if (quantity < 1) continue;

            const priceOffset = isTakeProfit ? TAKE_PROFIT_LIMIT_OFFSET : -STOP_LOSS_LIMIT_OFFSET;
            const price = roundPrice(referencePrice + priceOffset);
            if (!price) continue;

            this.exitCooldownUntilByTicker.set(ticker, now + EXIT_CHECK_COOLDOWN_MS);
            intents.push({
                ticker,
                side: 'SELL',
                type: 'LIMIT',
                price,
                quantity,
            });
        }

        return intents;
    }

    applyFill({ orderId, side, ticker, filledQuantity, filledPrice, remainingQuantity }) {
        const order = this.openOrders.get(orderId);
        const fillCost = filledQuantity * filledPrice;

        if (side === 'BUY') {
            const position = this.getPosition(ticker);
            position.shares += filledQuantity;
            position.totalCost += fillCost;

            this.cash = Math.max(0, this.cash - fillCost);
            this.reservedCash = Math.max(0, this.reservedCash - fillCost);

            if (order) {
                order.remainingQuantity = remainingQuantity;
                order.reservedRemaining = Math.max(0, order.reservedRemaining - fillCost);
                if (remainingQuantity <= 0) {
                    this.reservedCash = Math.max(0, this.reservedCash - order.reservedRemaining);
                    this.openOrders.delete(orderId);
                }
            }
            return;
        }

        const position = this.getPosition(ticker);
        position.shares = Math.max(0, position.shares - filledQuantity);
        position.totalCost = Math.max(0, position.totalCost - fillCost);
        position.reservedShares = Math.max(0, position.reservedShares - filledQuantity);
        this.cash += fillCost;

        if (order) {
            order.remainingQuantity = remainingQuantity;
            if (remainingQuantity <= 0) {
                this.openOrders.delete(orderId);
            }
        }

        if (position.shares <= 0 && position.reservedShares <= 0) {
            this.positions.delete(ticker);
        }
    }

    applyRejectedOrCanceled(orderId) {
        const order = this.openOrders.get(orderId);
        if (!order) return;

        if (order.side === 'BUY') {
            this.reservedCash = Math.max(0, this.reservedCash - order.reservedRemaining);
        } else {
            const position = this.getPosition(order.ticker);
            position.reservedShares = Math.max(0, position.reservedShares - order.remainingQuantity);
        }

        this.openOrders.delete(orderId);
    }

    async _cancelStaleLimitOrders() {
        if (!this.cancelOrder || this.openOrders.size === 0) return;

        const now = Date.now();

        for (const order of this.openOrders.values()) {
            if (order.type !== 'LIMIT' || order.remainingQuantity <= 0 || order.cancelRequested) continue;

            const ageMs = now - Number(order.createdAt ?? now);
            const referencePrice = getReferencePrice(this.getDepth, order.ticker);
            const orderPrice = Number(order.price ?? 0);
            const distanceFromReference = Number.isFinite(referencePrice) && referencePrice > 0 && orderPrice > 0
                ? Math.abs(orderPrice - referencePrice) / referencePrice
                : 0;

            if (
                ageMs < LIMIT_ORDER_MAX_AGE_MS
                && distanceFromReference <= LIMIT_ORDER_MAX_DISTANCE_FROM_REFERENCE
            ) {
                continue;
            }

            order.cancelRequested = true;
            try {
                await this.cancelOrder({
                    orderId: order.orderId,
                    userId: this.userId,
                    ticker: order.ticker,
                    side: order.side,
                    type: order.type,
                });
            } catch (error) {
                order.cancelRequested = false;
                this.logger.warn(`[${this.strategy.displayName}] failed to request stale order cancel`, error);
            }
        }
    }

    getPortfolioSnapshot() {
        return {
            userId: this.userId,
            username: this.username,
            displayName: this.strategy.displayName,
            type: 'bot',
            cash: this.cash,
            reservedCash: this.reservedCash,
            depositedCash: this.depositedCash,
            positions: [...this.positions.entries()].map(([ticker, position]) => ({
                ticker,
                shares: Number(position.shares ?? 0),
                reservedShares: Number(position.reservedShares ?? 0),
                totalCost: Number(position.totalCost ?? 0),
            })),
        };
    }
}

export class BotManager {
    constructor({ db, placeOrder, cancelOrder, getDepth, logger = console }) {
        this.db = db;
        this.placeOrder = placeOrder;
        this.cancelOrder = cancelOrder;
        this.getDepth = getDepth;
        this.logger = logger;
        this.runtimes = [];
        this.byUserId = new Map();
        this.sentimentByTicker = new Map(COMPANY_TYPES.map((company) => [company.ticker, 0]));
        this.sentimentSignalVersionByTicker = new Map(COMPANY_TYPES.map((company) => [company.ticker, 0]));
        this._sentimentDecayTimer = null;
    }

    async start() {
        const runtimes = await this._buildRuntimes();

        if (runtimes.length === 0) {
            this.logger.warn('No bot users found for configured bot strategies.');
            return;
        }

        this.runtimes = runtimes;
        this.byUserId = new Map(runtimes.map((runtime) => [runtime.userId, runtime]));

        for (const runtime of this.runtimes) {
            runtime.startTicking(async (rt) => {
                await rt.runTick();
            });
        }

        this._startSentimentDecayTimer();
        this.logger.log(`Started ${this.runtimes.length} bot runtimes.`);
    }

    stop() {
        for (const runtime of this.runtimes) {
            runtime.stopTicking();
        }
        if (this._sentimentDecayTimer) {
            clearInterval(this._sentimentDecayTimer);
            this._sentimentDecayTimer = null;
        }
        this.runtimes = [];
        this.byUserId.clear();
    }

    async onNews(news) {
        if (!news) return;
        this._applyNewsSentiment(news);

        const reactions = this.runtimes.map((runtime) => runtime.reactToNews(news));
        await Promise.all(reactions);
    }

    _startSentimentDecayTimer() {
        if (this._sentimentDecayTimer) {
            clearInterval(this._sentimentDecayTimer);
        }

        this._sentimentDecayTimer = setInterval(() => {
            this._decaySentimentTowardNeutral();
        }, SENTIMENT_DECAY_INTERVAL_MS);
    }

    _applyNewsSentiment(news) {
        const rawSentiment = Number(news?.sentiment ?? 0);
        if (!Number.isFinite(rawSentiment) || rawSentiment === 0) {
            return;
        }

        const sentimentDelta = Math.round(rawSentiment);
        if (sentimentDelta === 0) {
            return;
        }

        const affectedTickers = resolveNewsTickers(news);
        for (const ticker of affectedTickers) {
            const previous = this.sentimentByTicker.get(ticker) ?? 0;
            const next = clamp(previous + sentimentDelta, MIN_SENTIMENT, MAX_SENTIMENT);
            this.sentimentByTicker.set(ticker, next);
            this.sentimentSignalVersionByTicker.set(
                ticker,
                (this.sentimentSignalVersionByTicker.get(ticker) ?? 0) + 1
            );
        }
    }

    _decaySentimentTowardNeutral() {
        for (const [ticker, sentiment] of this.sentimentByTicker.entries()) {
            if (sentiment > 0) {
                this.sentimentByTicker.set(ticker, sentiment - 1);
            } else if (sentiment < 0) {
                this.sentimentByTicker.set(ticker, sentiment + 1);
            }
        }
    }

    onTrades(trades) {
        if (!Array.isArray(trades) || trades.length === 0) return;

        for (const trade of trades) {
            const buyRuntime = this.byUserId.get(trade.bidUserId);
            if (buyRuntime) {
                buyRuntime.applyFill({
                    orderId: trade.bidOrderId,
                    side: 'BUY',
                    ticker: trade.ticker,
                    filledQuantity: toNormal(trade.filledQuantity),
                    filledPrice: toNormal(trade.filledPrice),
                    remainingQuantity: toNormal(trade.bidRemainingQuantity),
                });
            }

            const sellRuntime = this.byUserId.get(trade.askUserId);
            if (sellRuntime) {
                sellRuntime.applyFill({
                    orderId: trade.askOrderId,
                    side: 'SELL',
                    ticker: trade.ticker,
                    filledQuantity: toNormal(trade.filledQuantity),
                    filledPrice: toNormal(trade.filledPrice),
                    remainingQuantity: toNormal(trade.askRemainingQuantity),
                });
            }
        }
    }

    onOrderRejected(rejected) {
        if (!rejected?.userId || !rejected?.orderId) return;
        const runtime = this.byUserId.get(rejected.userId);
        runtime?.applyRejectedOrCanceled(rejected.orderId);
    }

    onOrderCanceled(orderId) {
        if (!orderId) return;

        for (const runtime of this.runtimes) {
            if (runtime.openOrders.has(orderId)) {
                runtime.applyRejectedOrCanceled(orderId);
                break;
            }
        }
    }

    getPortfolios() {
        return this.runtimes.map((runtime) => runtime.getPortfolioSnapshot());
    }


    async _buildRuntimes() {
        // Query only users with bot_ prefix
        const [users] = await this.db.query(
            `SELECT user_id, username, cash, reserved_cash, deposited_cash
         FROM users 
         WHERE username LIKE 'bot_%'`
        );

        if (!users.length) {
            this.logger.warn('No bot users found');
            return [];
        }

        // Map each user to its strategy using the lookup table
        const botUsersWithStrategy = [];
        for (const user of users) {
            const strategy = BOT_NAME_TO_STRATEGY[user.username];
            if (!strategy) {
                this.logger.warn(`No strategy found for bot user: ${user.username}`);
                continue;
            }
            botUsersWithStrategy.push({ ...user, strategy });
        }

        // Fetch positions and orders for these users
        const userIds = botUsersWithStrategy.map(u => u.user_id);

        const [positions] = await this.db.query(
            'SELECT user_id, ticker, shares, reserved_shares, total_cost FROM portfolio WHERE user_id IN (?)',
            [userIds]
        );

        const [openOrders] = await this.db.query(
            `SELECT id, user_id, ticker, side, type, price, quantity, filled_quantity, status, estimated_amount, filled_cost, created_at
         FROM orders
         WHERE user_id IN (?) AND status IN ('OPEN', 'PARTIALLY_FILLED')`,
            [userIds]
        );

        // Build runtimes
        const runtimes = [];
        for (const user of botUsersWithStrategy) {
            const runtime = new BotRuntime(user, user.strategy, {
                placeOrder: this.placeOrder,
                cancelOrder: this.cancelOrder,
                getDepth: this.getDepth,
                tickers: COMPANY_TYPES.map(c => c.ticker),
                logger: this.logger,
                sentimentByTicker: this.sentimentByTicker,
                sentimentSignalVersionByTicker: this.sentimentSignalVersionByTicker,
            });
            runtimes.push(runtime);
        }

        // Hydrate positions and orders
        const runtimeMap = new Map(runtimes.map(r => [r.userId, r]));

        for (const row of positions) {
            runtimeMap.get(row.user_id)?.hydratePosition(row);
        }

        for (const row of openOrders) {
            runtimeMap.get(row.user_id)?.hydrateOrder(row);
        }

        return runtimes;
    }
}

export function createBotManager(dependencies) {
    return new BotManager(dependencies);
}
