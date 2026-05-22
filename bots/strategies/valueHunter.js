import { buildTakerLimitPrice, chooseOrderType, getDepthInfo, getReferencePrice, randomizeQuantity } from './shared.js';

const MIN_VALUATION_BIAS = 0.04;
const FULL_AGGRESSION_BIAS = 0.25;
const MIN_MARKET_PROBABILITY = 0.05;
const MAX_MARKET_PROBABILITY = 0.65;
const MAX_OPEN_BUY_QUANTITY = 600;
const MAX_NORMAL_QUANTITY = 60;
const MAX_BARGAIN_QUANTITY = 500;

function getAggression(absBias) {
    return Math.min(1, Math.max(0, (absBias - MIN_VALUATION_BIAS) / (
        FULL_AGGRESSION_BIAS - MIN_VALUATION_BIAS
    )));
}

function getValuation(ticker, estimatedValueByTicker, getDepth) {
    const estimatedValue = estimatedValueByTicker?.get?.(ticker);
    if (!estimatedValue) return null;

    const low = Number(estimatedValue.low ?? 0);
    const high = Number(estimatedValue.high ?? 0);
    const referencePrice = getReferencePrice(getDepth, ticker);
    if (
        !Number.isFinite(low) || low <= 0
        || !Number.isFinite(high) || high <= 0
        || !Number.isFinite(referencePrice) || referencePrice <= 0
    ) {
        return null;
    }

    const estimatedLow = Math.min(low, high);
    const estimatedHigh = Math.max(low, high);
    if (referencePrice < estimatedLow) {
        return { bias: (estimatedLow - referencePrice) / referencePrice };
    }
    if (referencePrice > estimatedHigh) {
        return { bias: -((referencePrice - estimatedHigh) / referencePrice) };
    }
    return { bias: 0 };
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

function onTick({ tickers, getDepth, getAvailableShares, getOpenOrderCount, getBuyingPower, estimatedValueByTicker }) {
    const candidates = tickers
        .map((ticker) => {
            const valuation = getValuation(ticker, estimatedValueByTicker, getDepth);
            const absBias = Math.abs(valuation?.bias ?? 0);
            if (absBias < MIN_VALUATION_BIAS) return null;

            const side = valuation.bias > 0 ? 'BUY' : 'SELL';
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
    onTick,
};
