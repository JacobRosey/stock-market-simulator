import { buildLimitPrice, randomizeQuantity, scoreTickerForSentiment } from './shared.js';

const thresholds = {
    TECH: { buy: 7, sell: -2 },
    PHARMA: { buy: 7, sell: -2 },
    MANUFACTURING: { buy: 7, sell: -2 },
    FINANCE: { buy: 7, sell: -2 },
    RETAIL: { buy: 7, sell: -2 },
    default: { buy: 7, sell: -2 },
    stable: 0.7,
    risky: 1.5,
    cyclical: 1.05,
};

function onTick({ tickers, getDepth, sentimentByTicker }) {
    const candidates = tickers
        .map((ticker) => scoreTickerForSentiment({ sentimentByTicker, ticker, thresholds }))
        .filter(Boolean)
        .sort((a, b) => b.strength - a.strength);

    const signal = candidates[0];
    if (!signal) return [];

    const quantity = randomizeQuantity(4 + signal.strength * 8, 1);
    const price = buildLimitPrice(getDepth, signal.ticker, signal.side, 0.12);

    if (!price) return [];
    return [{ ticker: signal.ticker, side: signal.side, type: 'LIMIT', price, quantity, consumeSentiment: true }];
}

export default {
    id: 'skeptic',
    displayName: 'Skeptic',
    username: 'bot_skeptic',
    intervalMs: 1000,
    thresholds,
    onTick,
};
