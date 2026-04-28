import { buildLimitPrice, randomizeQuantity, scoreTickerForSentiment, tickerMeta } from './shared.js';

const thresholds = {
    TECH: { buy: 0.45, sell: -0.45 },
    PHARMA: { buy: 0.5, sell: -0.5 },
    MANUFACTURING: { buy: 0.45, sell: -0.45 },
    FINANCE: { buy: 0.4, sell: -0.4 },
    RETAIL: { buy: 0.5, sell: -0.5 },
    default: { buy: 0.5, sell: -0.5 },
    stable: 0.5,
    risky: 1.7,
    cyclical: 1,
};

function onTick({ tickers, getDepth, sentimentByTicker }) {
    const candidates = tickers
        .map((ticker) => ({ ticker, score: scoreTickerForSentiment({ sentimentByTicker, ticker, thresholds }) }))
        .filter((entry) => entry.score)
        .filter((entry) => {
            const archetype = tickerMeta.get(entry.ticker)?.archetype;
            return archetype === 'stable' || archetype === 'defensive' || archetype === 'moderate';
        })
        .sort((a, b) => b.score.strength - a.score.strength);

    const signal = candidates[0]?.score;
    if (!signal) return [];

    const quantity = randomizeQuantity(6 + signal.strength * 8, 1);
    const offset = signal.side === 'BUY' ? 0.15 : 0.12;
    const price = buildLimitPrice(getDepth, signal.ticker, signal.side, offset);

    if (!price) return [];
    return [{ ticker: signal.ticker, side: signal.side, type: 'LIMIT', price, quantity, consumeSentiment: true }];
}

export default {
    id: 'value_hunter',
    displayName: 'Value Hunter',
    username: 'bot_value_hunter',
    intervalMs: 1400,
    thresholds,
    onTick,
};
