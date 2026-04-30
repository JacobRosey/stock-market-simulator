import { buildLimitPrice, chooseOrderType, randomChoice, randomizeQuantity, scoreTickerForSentiment } from './shared.js';

const thresholds = {
    TECH: { buy: 2, sell: -7 },
    PHARMA: { buy: 3, sell: -7 },
    MANUFACTURING: { buy: 2, sell: -7 },
    FINANCE: { buy: 2, sell: -7 },
    RETAIL: { buy: 2, sell: -7 },
    default: { buy: 2, sell: -7 },
    stable: 0.6,
    risky: 1.2,
    cyclical: 1,
};

function onTick({ tickers, getDepth, sentimentByTicker }) {
    const candidates = tickers
        .map((ticker) => scoreTickerForSentiment({ sentimentByTicker, ticker, thresholds }))
        .filter(Boolean)
        .sort((a, b) => b.strength - a.strength);

    const signal = candidates[0] ?? null;
    if (!signal) return [];

    const quantity = randomizeQuantity(7 + signal.strength * 12, 2);
    const type = chooseOrderType(0.7);
    if (type === 'MARKET') {
        return [{
            ticker: signal.ticker,
            side: signal.side,
            type,
            quantity,
            consumeSentiment: true,
            consumeSentimentScope: 'all',
        }];
    }

    const price = buildLimitPrice(getDepth, signal.ticker, signal.side, 0.05);
    if (!price) return [];
    return [{
        ticker: signal.ticker,
        side: signal.side,
        type,
        price,
        quantity,
        consumeSentiment: true,
        consumeSentimentScope: 'all',
    }];
}

export default {
    id: 'optimist',
    displayName: 'Optimist',
    username: 'bot_optimist',
    intervalMs: 600,
    thresholds,
    onTick,
};
