import { buildLimitPrice, randomizeQuantity, scoreTickerForSentiment } from './shared.js';

const thresholds = {
    TECH: { buy: 0.55, sell: -0.55 },
    PHARMA: { buy: 0.65, sell: -0.65 },
    MANUFACTURING: { buy: 0.55, sell: -0.55 },
    FINANCE: { buy: 0.5, sell: -0.5 },
    RETAIL: { buy: 0.6, sell: -0.6 },
    default: { buy: 0.6, sell: -0.6 },
    stable: 0.8,
    risky: 1.8,
    cyclical: 1.2,
};

function onTick({ tickers, getDepth, sentimentByTicker }) {
    const candidates = tickers
        .map((ticker) => scoreTickerForSentiment({ sentimentByTicker, ticker, thresholds }))
        .filter(Boolean)
        .sort((a, b) => b.strength - a.strength);

    const signal = candidates[0];
    if (!signal || signal.strength < 0.08) return [];

    const quantity = randomizeQuantity(30 + signal.strength * 50, 5);
    const price = buildLimitPrice(getDepth, signal.ticker, signal.side, 0.01);

    if (price) {
        return [{ ticker: signal.ticker, side: signal.side, type: 'LIMIT', price, quantity, consumeSentiment: true }];
    }

    return [{ ticker: signal.ticker, side: signal.side, type: 'MARKET', quantity, consumeSentiment: true }];
}

export default {
    id: 'whale',
    displayName: 'Whale',
    username: 'bot_whale',
    intervalMs: 900,
    thresholds,
    onTick,
};
