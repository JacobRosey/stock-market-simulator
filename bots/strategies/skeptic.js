import { buildLimitPrice, randomizeQuantity, scoreTickerForSentiment } from './shared.js';

const thresholds = {
    TECH: { buy: 0.75, sell: -0.25 },
    PHARMA: { buy: 0.8, sell: -0.3 },
    MANUFACTURING: { buy: 0.7, sell: -0.25 },
    FINANCE: { buy: 0.65, sell: -0.2 },
    RETAIL: { buy: 0.75, sell: -0.3 },
    default: { buy: 0.7, sell: -0.3 },
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
