import { buildLimitPrice, chooseSentimentOrderType, randomizeQuantity, scoreTickerForSentiment } from './shared.js';

const thresholds = {
    TECH: { buy: 5, sell: -3 },
    PHARMA: { buy: 5, sell: -4 },
    MANUFACTURING: { buy: 5, sell: -3 },
    FINANCE: { buy: 5, sell: -3 },
    RETAIL: { buy: 5, sell: -3 },
    default: { buy: 5, sell: -3 },
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
    const type = chooseSentimentOrderType(signal);
    if (type === 'MARKET') {
        return [{ ticker: signal.ticker, side: signal.side, type, quantity, consumeSentiment: true }];
    }

    const price = buildLimitPrice(getDepth, signal.ticker, signal.side, 0.12);

    if (!price) return [];
    return [{ ticker: signal.ticker, side: signal.side, type, price, quantity, consumeSentiment: true }];
}

export default {
    id: 'skeptic',
    displayName: 'Skeptic',
    username: 'bot_skeptic',
    intervalMs: 1000,
    thresholds,
    onTick,
};
