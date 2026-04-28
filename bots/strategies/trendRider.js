import { buildLimitPrice, randomizeQuantity, scoreTickerForSentiment } from './shared.js';

const thresholds = {
    TECH: { buy: 0.2, sell: -0.35 },
    PHARMA: { buy: 0.35, sell: -0.4 },
    MANUFACTURING: { buy: 0.25, sell: -0.35 },
    FINANCE: { buy: 0.2, sell: -0.3 },
    RETAIL: { buy: 0.25, sell: -0.3 },
    default: { buy: 0.3, sell: -0.3 },
    stable: 0.7,
    risky: 1.4,
    cyclical: 1.1,
};

function onTick({ tickers, getDepth, sentimentByTicker }) {
    const candidates = tickers
        .map((ticker) => scoreTickerForSentiment({ sentimentByTicker, ticker, thresholds }))
        .filter(Boolean)
        .sort((a, b) => b.strength - a.strength);

    const signal = candidates[0];
    if (!signal) return [];

    const quantity = randomizeQuantity(8 + signal.strength * 15, 2);
    const shouldUseMarket = signal.strength > 0.35;

    if (shouldUseMarket) {
        return [{ ticker: signal.ticker, side: signal.side, type: 'MARKET', quantity, consumeSentiment: true }];
    }

    const price = buildLimitPrice(getDepth, signal.ticker, signal.side, 0.02);
    if (!price) return [];

    return [{ ticker: signal.ticker, side: signal.side, type: 'LIMIT', price, quantity, consumeSentiment: true }];
}

export default {
    id: 'trend_rider',
    displayName: 'Trend Rider',
    username: 'bot_trend_rider',
    intervalMs: 500,
    thresholds,
    onTick,
};
