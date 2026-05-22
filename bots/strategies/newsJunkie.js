import { buildLimitPrice, chooseOrderTypeFromBehavior, getDepthInfo, getNewsTickers, randomBotOrderSize, randomChoice, randomInt, randomizeQuantity, scoreTickerForNews, scoreTickerForSentiment } from './shared.js';

const thresholds = {
    TECH: { buy: 3, sell: -3 },
    PHARMA: { buy: 3, sell: -3 },
    MANUFACTURING: { buy: 3, sell: -3 },
    FINANCE: { buy: 3, sell: -3 },
    RETAIL: { buy: 3, sell: -3 },
    default: { buy: 3, sell: -3 },
    stable: 0.8,
    risky: 1.3,
    cyclical: 1,
};

const strategyBehavior = { passive: 0.25, aggressive: 0.75 };

function onNews({ news, getDepth }) {
    const candidates = getNewsTickers(news)
        .map((ticker) => scoreTickerForNews({ news, ticker, thresholds }))
        .filter(Boolean)
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 2);

    return candidates.flatMap((signal) => {
        const quantity = Math.min(randomBotOrderSize(), randomizeQuantity(3 + signal.strength * 10, 1));
        const type = chooseOrderTypeFromBehavior(strategyBehavior);
        console.log(`News junkie trading ${quantity} ${signal.ticker} in ${type} ${signal.side} based on headline: ${news.headline}`)
        if (type === 'MARKET') {
            return [{ ticker: signal.ticker, side: signal.side, type, quantity }];
        }

        const price = buildLimitPrice(getDepth, signal.ticker, signal.side, 0.01);
        if (!price) return [];
        return [{ ticker: signal.ticker, side: signal.side, type, price, quantity }];
    });
}

function onTick({ tickers, getDepth, sentimentByTicker }) {
    const sentimentCandidates = tickers
        .map((ticker) => scoreTickerForSentiment({ sentimentByTicker, ticker, thresholds }))
        .filter(Boolean)
        .sort((a, b) => b.strength - a.strength);

    const sentimentSignal = sentimentCandidates[0];
    if (sentimentSignal && Math.random() < 0.7) {
        const quantity = Math.min(randomBotOrderSize(), randomizeQuantity(2 + sentimentSignal.strength * 8, 1));
        const type = chooseOrderTypeFromBehavior(strategyBehavior);

        if (type === 'MARKET') {
            return [{
                ticker: sentimentSignal.ticker,
                side: sentimentSignal.side,
                type,
                quantity,
                consumeSentiment: true,
            }];
        }

        const price = buildLimitPrice(getDepth, sentimentSignal.ticker, sentimentSignal.side, 0.01);
        if (!price) return [];
        return [{
            ticker: sentimentSignal.ticker,
            side: sentimentSignal.side,
            type,
            price,
            quantity,
            consumeSentiment: true,
        }];
    }

    if (Math.random() > 0.25) return [];
    const ticker = randomChoice(tickers);
    if (!ticker) return [];

    const { bestBid, bestAsk } = getDepthInfo(getDepth, ticker);
    if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return [];

    const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
    const price = side === 'BUY' ? bestBid : bestAsk;

    return [{
        ticker,
        side,
        type: 'LIMIT',
        price,
        quantity: randomInt(1, 3),
    }];
}

export default {
    id: 'news_junkie',
    displayName: 'News Junkie',
    username: 'bot_news_junkie',
    intervalMs: 300,
    sentimentCooldownMs: 7_000,
    thresholds,
    onNews,
    onTick,
};
