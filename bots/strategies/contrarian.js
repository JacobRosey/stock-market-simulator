import { buildLimitPrice, getNewsTickers, randomizeQuantity, scoreTickerForNews, scoreTickerForSentiment } from './shared.js';

const thresholds = {
    TECH: { buy: -0.35, sell: 0.35 },
    PHARMA: { buy: -0.45, sell: 0.35 },
    MANUFACTURING: { buy: -0.35, sell: 0.3 },
    FINANCE: { buy: -0.3, sell: 0.3 },
    RETAIL: { buy: -0.4, sell: 0.35 },
    default: { buy: -0.4, sell: 0.4 },
    stable: 0.9,
    risky: 1.6,
    cyclical: 1.1,
};

function onNews({ news, getDepth }) {
    const candidates = getNewsTickers(news)
        .map((ticker) => scoreTickerForNews({ news, ticker, thresholds, invert: true }))
        .filter(Boolean)
        .sort((a, b) => b.strength - a.strength);

    const signal = candidates[0];
    if (!signal) return [];

    const quantity = randomizeQuantity(5 + signal.strength * 10, 1);
    const priceOffset = signal.side === 'BUY' ? 0.08 : 0.1;
    const price = buildLimitPrice(getDepth, signal.ticker, signal.side, priceOffset);

    if (!price) return [];
    return [{ ticker: signal.ticker, side: signal.side, type: 'LIMIT', price, quantity }];
}

function onTick({ tickers, getDepth, sentimentByTicker }) {
    const candidates = tickers
        .map((ticker) => scoreTickerForSentiment({ sentimentByTicker, ticker, thresholds, invert: true }))
        .filter(Boolean)
        .sort((a, b) => b.strength - a.strength);

    const signal = candidates[0];
    if (!signal) return [];

    const quantity = randomizeQuantity(4 + signal.strength * 8, 1);
    const priceOffset = signal.side === 'BUY' ? 0.1 : 0.12;
    const price = buildLimitPrice(getDepth, signal.ticker, signal.side, priceOffset);

    if (!price) return [];
    return [{
        ticker: signal.ticker,
        side: signal.side,
        type: 'LIMIT',
        price,
        quantity,
        consumeSentiment: true,
    }];
}

export default {
    id: 'contrarian',
    displayName: 'Contrarian',
    usernames: 'bot_contrarian',
    intervalMs: 1200,
    sentimentCooldownMs: 16_000,
    thresholds,
    onNews,
    onTick,
};
