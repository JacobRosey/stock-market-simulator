import { buildTakerLimitPrice, chooseOrderType, getReferencePrice, randomizeQuantity } from './shared.js';

const MIN_VALUATION_BIAS = 0.04;
const FULL_AGGRESSION_BIAS = 0.25;
const MIN_MARKET_PROBABILITY = 0.05;
const MAX_MARKET_PROBABILITY = 0.7;

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

function onTick({ tickers, getDepth, getAvailableShares, estimatedValueByTicker }) {
    const candidates = tickers
        .map((ticker) => {
            const valuation = getValuation(ticker, estimatedValueByTicker, getDepth);
            const absBias = Math.abs(valuation?.bias ?? 0);
            if (absBias < MIN_VALUATION_BIAS) return null;

            const side = valuation.bias > 0 ? 'BUY' : 'SELL';
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
    const quantity = randomizeQuantity(4 + aggression * 18, 2);
    const marketProbability = MIN_MARKET_PROBABILITY
        + aggression * (MAX_MARKET_PROBABILITY - MIN_MARKET_PROBABILITY);
    const type = chooseOrderType(marketProbability);
    if (type === 'MARKET') {
        return [{ ticker: signal.ticker, side: signal.side, type, quantity }];
    }

    const price = buildTakerLimitPrice(getDepth, signal.ticker, signal.side);
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
    onTick,
};
