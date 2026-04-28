import { buildLimitPrice, randomChoice, randomInt } from './shared.js';

// These thresholds aren't used since this bot just trades randomly
const thresholds = {
    TECH: { buy: 1, sell: -1 },
    PHARMA: { buy: 1, sell: -1 },
    MANUFACTURING: { buy: 1, sell: -1 },
    FINANCE: { buy: 1, sell: -1 },
    RETAIL: { buy: 1, sell: -1 },
    default: { buy: 1, sell: -1 },
    stable: 1,
    risky: 1,
    cyclical: 1,
};

function onTick({ tickers, getDepth }) {
    if (Math.random() > 0.25) return [];

    const ticker = randomChoice(tickers);
    if (!ticker) return [];

    const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
    const type = Math.random() > 0.4 ? 'LIMIT' : 'MARKET';
    const quantity = randomInt(1, 7);

    if (type === 'MARKET') {
        return [{ ticker, side, type, quantity }];
    }

    const offset = 0.01 + Math.random() * 0.08;
    const price = buildLimitPrice(getDepth, ticker, side, offset);
    if (!price) return [];

    return [{ ticker, side, type, quantity, price }];
}

function onNews() {
    return [];
}

export default {
    id: 'noise_trader',
    displayName: 'Noise Trader',
    username: 'bot_noise_trader',
    intervalMs: 700,
    thresholds,
    onTick,
    onNews,
};
