import { buildTakerLimitPrice, chooseOrderType, getDepthInfo, getNewsTickers, getReferencePrice, randomizeQuantity, roundPrice } from './shared.js';

const MIN_VALUATION_BIAS = 0.04;
const FULL_AGGRESSION_BIAS = 0.25;
const SENTIMENT_VALUE_MOVE_PER_POINT = 0.0125;
const MIN_MARKET_PROBABILITY = 0.05;
const MAX_MARKET_PROBABILITY = 0.65;
const MAX_OPEN_BUY_QUANTITY = 600;
const MAX_NORMAL_QUANTITY = 60;
const MAX_BARGAIN_QUANTITY = 500;
const estimatedValueByTicker = new Map();

function getAggression(absBias) {
    return Math.min(1, Math.max(0, (absBias - MIN_VALUATION_BIAS) / (
        FULL_AGGRESSION_BIAS - MIN_VALUATION_BIAS
    )));
}

function updatePrivateEstimatedValues(news, getDepth) {
    const sentiment = Number(news?.sentiment ?? 0);
    if (!Number.isFinite(sentiment) || sentiment === 0) return;

    for (const ticker of getNewsTickers(news)) {
        const currentEstimate = estimatedValueByTicker.get(ticker);
        const referencePrice = getReferencePrice(getDepth, ticker);
        const baseValue = Number.isFinite(currentEstimate) && currentEstimate > 0
            ? currentEstimate
            : referencePrice;

        if (!Number.isFinite(baseValue) || baseValue <= 0) continue;

        const multiplier = Math.max(0.2, 1 + sentiment * SENTIMENT_VALUE_MOVE_PER_POINT);
        estimatedValueByTicker.set(ticker, roundPrice(baseValue * multiplier));
    }
}

function getPrivateValuationSignal(ticker, getDepth) {
    const estimatedValue = Number(estimatedValueByTicker.get(ticker) ?? 0);
    const referencePrice = getReferencePrice(getDepth, ticker);
    if (
        !Number.isFinite(estimatedValue) || estimatedValue <= 0
        || !Number.isFinite(referencePrice) || referencePrice <= 0
    ) {
        return null;
    }

    return { bias: (estimatedValue - referencePrice) / referencePrice };
}

function getBuyQuantity(absBias, price, buyingPower) {
    const aggression = getAggression(absBias);
    const deepValueBonus = Math.min(MAX_BARGAIN_QUANTITY - MAX_NORMAL_QUANTITY, Math.floor(absBias * 40));
    const desiredQuantity = randomizeQuantity(8 + aggression * 42 + deepValueBonus, 3);
    const maxQuantity = absBias >= 1 ? MAX_BARGAIN_QUANTITY : MAX_NORMAL_QUANTITY;
    const affordableQuantity = Number.isFinite(price) && price > 0
        ? Math.floor(buyingPower / price)
        : maxQuantity;
    if (affordableQuantity < 1) return 0;

    return Math.max(1, Math.min(maxQuantity, desiredQuantity, affordableQuantity));
}

function getSellQuantity(absBias) {
    const aggression = getAggression(absBias);
    return randomizeQuantity(3 + aggression * 10, 1);
}

function onNews({ news, getDepth }) {
    updatePrivateEstimatedValues(news, getDepth);
    return [];
}

function onTick({ tickers, getDepth, getAvailableShares, getOpenOrderCount, getBuyingPower }) {
    const candidates = tickers
        .map((ticker) => {
            const signal = getPrivateValuationSignal(ticker, getDepth);
            const absBias = Math.abs(signal?.bias ?? 0);
            if (absBias < MIN_VALUATION_BIAS) return null;

            const side = signal.bias > 0 ? 'BUY' : 'SELL';
            if (side === 'BUY' && getOpenOrderCount(ticker, 'BUY') >= MAX_OPEN_BUY_QUANTITY) return null;
            if (side === 'SELL' && getAvailableShares(ticker) < 1) return null;

            return {
                ticker,
                side,
                absBias,
                score: absBias,
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

    const signal = candidates[0];
    if (!signal) return [];

    const aggression = getAggression(signal.absBias);
    const marketProbability = MIN_MARKET_PROBABILITY
        + aggression * (MAX_MARKET_PROBABILITY - MIN_MARKET_PROBABILITY);
    const type = chooseOrderType(marketProbability);
    const price = type === 'MARKET'
        ? getDepthInfo(getDepth, signal.ticker).bestAsk ?? getReferencePrice(getDepth, signal.ticker)
        : buildTakerLimitPrice(getDepth, signal.ticker, signal.side);
    const quantity = signal.side === 'BUY'
        ? getBuyQuantity(signal.absBias, price, getBuyingPower())
        : getSellQuantity(signal.absBias);

    if (quantity < 1) return [];

    if (type === 'MARKET') {
        return [{ ticker: signal.ticker, side: signal.side, type, quantity }];
    }

    if (!price) return [];

    return [{
        ticker: signal.ticker,
        side: signal.side,
        type,
        price,
        quantity,
    }];
}

export default {
    id: 'value_hunter',
    displayName: 'Value Hunter',
    username: 'bot_value_hunter',
    intervalMs: 1400,
    backgroundFlow: false,
    positionRebalance: false,
    onNews,
    onTick,
};
