import { BOT_NAME_TO_STRATEGY } from './strategies/index.js';
import { COMPANY_TYPES } from '../news/headlineLibrary.js';
import { buildTakerLimitPrice, getReferencePrice, roundPrice } from './strategies/shared.js';

const MICRO_UNIT = 1e6;
const MIN_SENTIMENT = -10;
const MAX_SENTIMENT = 10;
const SENTIMENT_DECAY_INTERVAL_MS = 20_000;
const MIN_SENTIMENT_ACTION_COOLDOWN_MS = 45_000;
const MAX_SENTIMENT_ACTION_COOLDOWN_MS = 60_000;
const LIMIT_ORDER_MAX_AGE_MS = 180_000;
const STALE_ORDER_TOP_LEVEL_COUNT = 3;
const EXIT_TRIGGER_STEP = 0.05;
const EXIT_CHECK_COOLDOWN_MS = 15_000;
const EXIT_BASE_PROBABILITY = 0.25;
const EXIT_PROBABILITY_PER_STEP = 0.2;
const EXIT_MAX_PROBABILITY = 0.85;
const EXIT_MAX_POSITION_SHARE = 0.2;
const EXIT_MAX_OPEN_SELL_SHARE = 0.3;
const TAKE_PROFIT_LIMIT_OFFSET = 0.03;
const STOP_LOSS_LIMIT_OFFSET = 0.03;
const BACKGROUND_FLOW_RATE_PER_MINUTE = 1.8;
const BACKGROUND_FLOW_MIN_VOLUME_TARGET = 120;
const BACKGROUND_FLOW_MAX_VOLUME_TARGET = 900;
const BACKGROUND_FLOW_VOLUME_TARGET_MULTIPLIER = 0.65;
const BACKGROUND_FLOW_MIN_QUANTITY = 1;
const BACKGROUND_FLOW_MAX_QUANTITY = 5;
const BACKGROUND_FLOW_MAX_OPEN_TICKER_QUANTITY = 12;
const BACKGROUND_FLOW_RECENT_TRADE_COOLDOWN_MS = 20_000;
const BACKGROUND_FLOW_AGE_WEIGHT_MS = 10 * 60_000;
const TICKER_NEWS_COMPETITOR_MAX_ABS_DELTA = 4;
const TICKER_NEWS_COMPETITOR_MIN_ABS_DELTA = 1;
const SECTOR_NEWS_SENTIMENT_MULTIPLIER = 0.6;
const POSITION_REBALANCE_TRIGGER_SHARE = 0.12;
const POSITION_REBALANCE_TARGET_SHARE = 0.09;
const POSITION_REBALANCE_MAX_POSITION_SHARE = 0.2;
const POSITION_REBALANCE_MAX_OPEN_SELL_SHARE = 0.35;
const POSITION_REBALANCE_COOLDOWN_MS = 25_000;

const BOT_TICKERS = COMPANY_TYPES.map((company) => company.ticker);
const COMPANY_BY_TICKER = new Map(COMPANY_TYPES.map((company) => [company.ticker, company]));
const TICKERS_BY_SECTOR = COMPANY_TYPES.reduce((map, company) => {
    if (!map.has(company.sector)) {
        map.set(company.sector, []);
    }
    map.get(company.sector).push(company.ticker);
    return map;
}, new Map());

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toNormal(microValue) {
    return (microValue ?? 0) / MICRO_UNIT;
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function median(values) {
    const finiteValues = values
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);

    if (finiteValues.length === 0) return 0;

    const middle = Math.floor(finiteValues.length / 2);
    if (finiteValues.length % 2 === 1) {
        return finiteValues[middle];
    }

    return (finiteValues[middle - 1] + finiteValues[middle]) / 2;
}

function roundSentimentDelta(value) {
    if (!Number.isFinite(value) || value === 0) return 0;
    const rounded = Math.round(value);
    if (rounded !== 0) return rounded;
    return value > 0 ? 1 : -1;
}

function dampenSentimentDelta(delta, multiplier) {
    return roundSentimentDelta(delta * multiplier);
}

function getCompetitorSentimentDelta(sentimentDelta) {
    const magnitude = Math.abs(sentimentDelta);
    if (magnitude <= 0) return 0;

    const spilloverMagnitude = clamp(
        Math.ceil(Math.log2(magnitude)),
        TICKER_NEWS_COMPETITOR_MIN_ABS_DELTA,
        TICKER_NEWS_COMPETITOR_MAX_ABS_DELTA
    );

    return Math.sign(sentimentDelta) * -spilloverMagnitude;
}

function addSentimentImpact(impacts, ticker, delta) {
    if (!ticker || !Number.isFinite(delta) || delta === 0) return;
    impacts.set(ticker, clamp((impacts.get(ticker) ?? 0) + delta, MIN_SENTIMENT, MAX_SENTIMENT));
}

function buildNewsSentimentImpacts(news, sentimentDelta) {
    const impacts = new Map();
    if (!news || sentimentDelta === 0) return impacts;

    if (news.global) {
        for (const ticker of BOT_TICKERS) {
            addSentimentImpact(impacts, ticker, sentimentDelta);
        }
        return impacts;
    }

    const affectedTickers = Array.isArray(news.affectedTickers)
        ? [...new Set(news.affectedTickers)]
        : [];
    const affectedSectors = Array.isArray(news.affectedSectors)
        ? [...new Set(news.affectedSectors)]
        : [];

    if (affectedTickers.length > 0) {
        const featuredTickers = new Set(affectedTickers);
        for (const ticker of affectedTickers) {
            addSentimentImpact(impacts, ticker, sentimentDelta);
        }

        const sectors = new Set(affectedSectors);
        for (const ticker of affectedTickers) {
            const sector = COMPANY_BY_TICKER.get(ticker)?.sector;
            if (sector) sectors.add(sector);
        }

        const competitorDelta = getCompetitorSentimentDelta(sentimentDelta);
        for (const sector of sectors) {
            for (const ticker of TICKERS_BY_SECTOR.get(sector) ?? []) {
                if (!featuredTickers.has(ticker)) {
                    addSentimentImpact(impacts, ticker, competitorDelta);
                }
            }
        }

        return impacts;
    }

    const sectorDelta = dampenSentimentDelta(sentimentDelta, SECTOR_NEWS_SENTIMENT_MULTIPLIER);
    for (const sector of affectedSectors) {
        for (const ticker of TICKERS_BY_SECTOR.get(sector) ?? []) {
            addSentimentImpact(impacts, ticker, sectorDelta);
        }
    }

    return impacts;
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
        this.volume24hByTicker = dependencies.volume24hByTicker;
        this.lastTradeAtByTicker = dependencies.lastTradeAtByTicker;
        this.estimatedValueByTicker = dependencies.estimatedValueByTicker;

        this.cash = Number(user.cash ?? 0);
        this.reservedCash = Number(user.reserved_cash ?? 0);
        this.depositedCash = Number(user.deposited_cash ?? 0);
        this.positions = new Map();
        this.openOrders = new Map();
        this.consumedSignalVersionByTicker = new Map();
        this.sentimentCooldownUntilByTicker = new Map();
        this.exitCooldownUntilByTicker = new Map();
        this.positionRebalanceCooldownUntilByTicker = new Map();

        this._busy = false;
        this._tickTimer = null;
    }

    startTicking() {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
        }

        this._tickTimer = setInterval(() => {
            void this.runTick();
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
                estimatedValueByTicker: this.estimatedValueByTicker,
                getSentiment: (ticker) => this._isSentimentActionable(ticker)
                    ? this.sentimentByTicker.get(ticker) ?? 0
                    : 0,
            };

            const intents = [
                ...this._buildExitIntents(),
                ...this._buildPositionRebalanceIntents(),
                ...(intentBuilder(context) ?? []),
                ...this._buildBackgroundFlowIntents(),
            ];

            for (const intent of intents) {
                const placed = await this._placeIntent(intent);
                if (!placed) continue;

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
        if (!intent?.ticker || !intent?.side || !intent?.type) return false;

        let quantity = Math.floor(Number(intent.quantity ?? 0));
        if (quantity <= 0) return false;

        if (intent.side === 'SELL') {
            const availableShares = Math.floor(this.getAvailableShares(intent.ticker));
            if (availableShares < 1) return false;
            quantity = Math.min(quantity, availableShares);
        }

        const price = intent.type === 'LIMIT' ? Number(intent.price) : null;
        if (intent.type === 'LIMIT' && (!Number.isFinite(price) || price <= 0)) {
            return false;
        }

        const orderInput = {
            userId: this.userId,
            ticker: intent.ticker,
            side: intent.side,
            type: intent.type,
            quantity,
            price,
        };

        const result = await this.placeOrder(orderInput);

        if (!result?.success) {
            return false;
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

        return true;
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

    _getPortfolioValue() {
        let value = Math.max(0, Number(this.cash ?? 0));
        for (const [ticker, position] of this.positions.entries()) {
            const shares = Math.max(0, Number(position.shares ?? 0));
            if (shares <= 0) continue;

            const referencePrice = getReferencePrice(this.getDepth, ticker);
            if (Number.isFinite(referencePrice) && referencePrice > 0) {
                value += shares * referencePrice;
            }
        }

        return value;
    }

    _buildPositionRebalanceIntents() {
        if (this.strategy.positionRebalance === false) return [];

        const now = Date.now();
        const portfolioValue = this._getPortfolioValue();
        if (!Number.isFinite(portfolioValue) || portfolioValue <= 0) return [];

        const candidates = [];
        for (const [ticker, position] of this.positions.entries()) {
            const shares = Math.max(0, Number(position.shares ?? 0));
            if (shares <= 0) continue;

            const availableShares = Math.floor(this.getAvailableShares(ticker));
            if (availableShares < 1) continue;

            const cooldownUntil = this.positionRebalanceCooldownUntilByTicker?.get(ticker) ?? 0;
            if (now < cooldownUntil) continue;

            const referencePrice = getReferencePrice(this.getDepth, ticker);
            if (!Number.isFinite(referencePrice) || referencePrice <= 0) continue;

            const positionValue = shares * referencePrice;
            const portfolioShare = positionValue / portfolioValue;
            if (portfolioShare <= POSITION_REBALANCE_TRIGGER_SHARE) continue;

            const openSellQuantity = this.getOpenOrderCount(ticker, 'SELL');
            const maxOpenSellQuantity = Math.max(1, Math.floor(shares * POSITION_REBALANCE_MAX_OPEN_SELL_SHARE));
            if (openSellQuantity >= maxOpenSellQuantity) continue;

            const targetValue = portfolioValue * POSITION_REBALANCE_TARGET_SHARE;
            const excessQuantity = Math.floor((positionValue - targetValue) / referencePrice);
            const maxPositionQuantity = Math.max(1, Math.floor(shares * POSITION_REBALANCE_MAX_POSITION_SHARE));
            const quantity = Math.min(
                availableShares,
                excessQuantity,
                maxPositionQuantity,
                maxOpenSellQuantity - openSellQuantity
            );
            if (quantity < 1) continue;

            candidates.push({
                ticker,
                quantity,
                portfolioShare,
            });
        }

        return candidates
            .sort((a, b) => b.portfolioShare - a.portfolioShare)
            .slice(0, 2)
            .flatMap((candidate) => {
                const price = buildTakerLimitPrice(this.getDepth, candidate.ticker, 'SELL');
                if (!price) return [];

                this.positionRebalanceCooldownUntilByTicker.set(
                    candidate.ticker,
                    now + POSITION_REBALANCE_COOLDOWN_MS
                );

                return [{
                    ticker: candidate.ticker,
                    side: 'SELL',
                    type: 'LIMIT',
                    price,
                    quantity: candidate.quantity,
                }];
            });
    }

    _buildBackgroundFlowIntents() {
        if (this.strategy.backgroundFlow === false) return [];

        const ratePerMinute = Number(this.strategy.backgroundFlowRatePerMinute ?? BACKGROUND_FLOW_RATE_PER_MINUTE);
        const probability = clamp((this.strategy.intervalMs / 60_000) * ratePerMinute, 0, 0.4);
        if (Math.random() > probability) return [];

        const ticker = this._pickBackgroundFlowTicker();
        if (!ticker) return [];

        const side = this._pickBackgroundFlowSide(ticker);
        const price = buildTakerLimitPrice(this.getDepth, ticker, side);
        if (!price) return [];

        let quantity = randomInt(BACKGROUND_FLOW_MIN_QUANTITY, BACKGROUND_FLOW_MAX_QUANTITY);

        if (side === 'SELL') {
            quantity = Math.min(quantity, Math.floor(this.getAvailableShares(ticker)));
        } else {
            const buyingPower = Math.max(0, this.cash - this.reservedCash);
            quantity = Math.min(quantity, Math.floor(buyingPower / price));
        }

        if (quantity < 1) return [];

        return [{
            ticker,
            side,
            type: 'LIMIT',
            price,
            quantity,
        }];
    }

    _pickBackgroundFlowTicker() {
        const now = Date.now();
        const volumes = this.tickers.map((ticker) => this.volume24hByTicker.get(ticker) ?? 0);
        const baselineVolume = median(volumes);
        const targetVolume = clamp(
            baselineVolume * BACKGROUND_FLOW_VOLUME_TARGET_MULTIPLIER,
            BACKGROUND_FLOW_MIN_VOLUME_TARGET,
            BACKGROUND_FLOW_MAX_VOLUME_TARGET
        );

        const candidates = this.tickers
            .map((ticker) => {
                const openQuantity = this.getOpenOrderCount(ticker, 'BUY') + this.getOpenOrderCount(ticker, 'SELL');
                if (openQuantity >= BACKGROUND_FLOW_MAX_OPEN_TICKER_QUANTITY) return null;

                const lastTradeAt = this.lastTradeAtByTicker.get(ticker) ?? 0;
                const ageMs = lastTradeAt > 0 ? now - lastTradeAt : BACKGROUND_FLOW_AGE_WEIGHT_MS;
                if (ageMs < BACKGROUND_FLOW_RECENT_TRADE_COOLDOWN_MS) return null;

                const volume = this.volume24hByTicker.get(ticker) ?? 0;
                const volumeDeficit = Math.max(0, targetVolume - volume);
                const ageWeight = clamp(ageMs / BACKGROUND_FLOW_AGE_WEIGHT_MS, 0.25, 3);
                const sentiment = Math.abs(this.sentimentByTicker.get(ticker) ?? 0);
                const sentimentWeight = 1 / (1 + sentiment * 0.18);
                const jitter = 0.8 + Math.random() * 0.4;
                const score = (10 + volumeDeficit) * ageWeight * sentimentWeight * jitter;

                return { ticker, score };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score);

        return candidates[0]?.ticker ?? null;
    }

    _pickBackgroundFlowSide(ticker) {
        const sentiment = clamp(this.sentimentByTicker.get(ticker) ?? 0, MIN_SENTIMENT, MAX_SENTIMENT);
        const availableShares = Math.floor(this.getAvailableShares(ticker));
        if (availableShares < 1) return 'BUY';

        const referencePrice = getReferencePrice(this.getDepth, ticker);
        const buyingPower = Math.max(0, this.cash - this.reservedCash);
        if (Number.isFinite(referencePrice) && referencePrice > 0 && buyingPower < referencePrice) {
            return 'SELL';
        }

        const buyProbability = clamp(0.5 + sentiment * 0.025, 0.2, 0.8);
        return Math.random() < buyProbability ? 'BUY' : 'SELL';
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
            if (
                ageMs < LIMIT_ORDER_MAX_AGE_MS
                || this._isOrderInTopBookLevels(order, STALE_ORDER_TOP_LEVEL_COUNT)
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

    _isOrderInTopBookLevels(order, levelCount) {
        const orderPrice = Number(order.price ?? 0);
        if (!Number.isFinite(orderPrice) || orderPrice <= 0) return false;

        const depth = this.getDepth(order.ticker);
        const levels = order.side === 'BUY' ? depth?.bids : depth?.asks;
        const topLevels = (Array.isArray(levels) ? levels : [])
            .filter((level) => Number.isFinite(Number(level.price)) && Number(level.price) > 0)
            .slice(0, levelCount);

        if (topLevels.length === 0) return true;

        const roundedOrderPrice = roundPrice(orderPrice);
        if (topLevels.some((level) => roundPrice(Number(level.price)) === roundedOrderPrice)) {
            return true;
        }

        const boundaryPrice = Number(topLevels[topLevels.length - 1].price);
        return order.side === 'BUY'
            ? orderPrice >= boundaryPrice
            : orderPrice <= boundaryPrice;
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
    constructor({ db, placeOrder, cancelOrder, getDepth, estimatedValueByTicker, logger = console }) {
        this.db = db;
        this.placeOrder = placeOrder;
        this.cancelOrder = cancelOrder;
        this.getDepth = getDepth;
        this.estimatedValueByTicker = estimatedValueByTicker ?? new Map();
        this.logger = logger;
        this.runtimes = [];
        this.byUserId = new Map();
        this.sentimentByTicker = new Map(BOT_TICKERS.map((ticker) => [ticker, 0]));
        this.sentimentSignalVersionByTicker = new Map(BOT_TICKERS.map((ticker) => [ticker, 0]));
        this.volume24hByTicker = new Map(BOT_TICKERS.map((ticker) => [ticker, 0]));
        this.lastTradeAtByTicker = new Map(BOT_TICKERS.map((ticker) => [ticker, 0]));
        this._sentimentDecayTimer = null;
    }

    async start() {
        await this._hydrateRecentVolume();
        const runtimes = await this._buildRuntimes();

        if (runtimes.length === 0) {
            this.logger.warn('No bot users found for configured bot strategies.');
            return;
        }

        this.runtimes = runtimes;
        this.byUserId = new Map(runtimes.map((runtime) => [runtime.userId, runtime]));

        for (const runtime of this.runtimes) {
            runtime.startTicking();
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

        const impacts = buildNewsSentimentImpacts(news, sentimentDelta);
        for (const [ticker, delta] of impacts.entries()) {
            const previous = this.sentimentByTicker.get(ticker) ?? 0;
            const next = clamp(previous + delta, MIN_SENTIMENT, MAX_SENTIMENT);
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
            const filledQuantity = toNormal(trade.filledQuantity);
            const now = Date.now();
            this.volume24hByTicker.set(
                trade.ticker,
                (this.volume24hByTicker.get(trade.ticker) ?? 0) + filledQuantity
            );
            this.lastTradeAtByTicker.set(trade.ticker, now);

            if (buyRuntime) {
                buyRuntime.applyFill({
                    orderId: trade.bidOrderId,
                    side: 'BUY',
                    ticker: trade.ticker,
                    filledQuantity,
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
                    filledQuantity,
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

    async _hydrateRecentVolume() {
        try {
            const [rows] = await this.db.query(
                `SELECT
                    s.ticker,
                    COALESCE(SUM(ph.filled), 0) AS volume24h,
                    MAX(ph.timestamp) AS lastTradeAt
                 FROM stocks s
                 LEFT JOIN price_history ph
                    ON ph.stock_id = s.id
                    AND ph.timestamp > NOW() - INTERVAL 24 HOUR
                 WHERE s.ticker IN (?)
                 GROUP BY s.ticker`,
                [BOT_TICKERS]
            );

            for (const row of rows) {
                const volume = Number(row.volume24h ?? 0);
                const lastTradeAt = row.lastTradeAt ? new Date(row.lastTradeAt).getTime() : 0;
                this.volume24hByTicker.set(row.ticker, Number.isFinite(volume) ? volume : 0);
                this.lastTradeAtByTicker.set(row.ticker, Number.isFinite(lastTradeAt) ? lastTradeAt : 0);
            }
        } catch (error) {
            this.logger.warn('Failed to hydrate recent ticker volume for bot flow balancing.', error);
        }
    }

    async _buildRuntimes() {
        const [users] = await this.db.query(
            `SELECT user_id, username, cash, reserved_cash, deposited_cash
         FROM users 
         WHERE username LIKE 'bot_%'`
        );

        if (!users.length) {
            this.logger.warn('No bot users found');
            return [];
        }

        const botUsers = [];
        for (const user of users) {
            const strategy = BOT_NAME_TO_STRATEGY[user.username];
            if (!strategy) {
                this.logger.warn(`No strategy found for bot user: ${user.username}`);
                continue;
            }
            botUsers.push({ ...user, strategy });
        }

        if (botUsers.length === 0) return [];

        const userIds = botUsers.map((user) => user.user_id);

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

        const runtimes = botUsers.map((user) => (
            new BotRuntime(user, user.strategy, {
                placeOrder: this.placeOrder,
                cancelOrder: this.cancelOrder,
                getDepth: this.getDepth,
                tickers: BOT_TICKERS,
                logger: this.logger,
                sentimentByTicker: this.sentimentByTicker,
                sentimentSignalVersionByTicker: this.sentimentSignalVersionByTicker,
                volume24hByTicker: this.volume24hByTicker,
                lastTradeAtByTicker: this.lastTradeAtByTicker,
                estimatedValueByTicker: this.estimatedValueByTicker,
            })
        ));
        const runtimeMap = new Map(runtimes.map((runtime) => [runtime.userId, runtime]));

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
