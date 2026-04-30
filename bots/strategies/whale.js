import { buildLimitPrice, chooseOrderType, randomizeQuantity, scoreTickerForSentiment } from './shared.js';

const thresholds = {
    TECH: { buy: 5, sell: -5 },
    PHARMA: { buy: 5, sell: -5 },
    MANUFACTURING: { buy: 6, sell: -6 },
    FINANCE: { buy: 5, sell: -5 },
    RETAIL: { buy: 6, sell: -6 },
    default: { buy: 6, sell: -6 },
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
    const type = chooseOrderType(0.7);
    if (type === 'MARKET') {
        return [{ ticker: signal.ticker, side: signal.side, type, quantity, consumeSentiment: true }];
    }

    const price = buildLimitPrice(getDepth, signal.ticker, signal.side, 0.01);

    if (!price) return [];
    return [{ ticker: signal.ticker, side: signal.side, type, price, quantity, consumeSentiment: true }];
}

export default {
    id: 'whale',
    displayName: 'Whale',
    username: 'bot_whale',
    intervalMs: 900,
    thresholds,
    onTick,
};
