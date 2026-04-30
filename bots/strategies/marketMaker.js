import { getDepthInfo, getReferencePrice, roundPrice } from './shared.js';

const thresholds = {
    TECH: { buy: 999, sell: -999 },
    PHARMA: { buy: 999, sell: -999 },
    MANUFACTURING: { buy: 999, sell: -999 },
    FINANCE: { buy: 999, sell: -999 },
    RETAIL: { buy: 999, sell: -999 },
    default: { buy: 999, sell: -999 },
    stable: 1,
    risky: 1,
    cyclical: 1,
};

const TARGET_ACTIVE_BUY_VOLUME = 50;
const TARGET_ACTIVE_SELL_VOLUME = 50;
const MAX_SELL_INVENTORY_SHARE = 0.25;

function buildQuote(getDepth, ticker, side) {
    const { bestBid, bestAsk } = getDepthInfo(getDepth, ticker);
    const referencePrice = getReferencePrice(getDepth, ticker);
    if (!Number.isFinite(referencePrice)) {
        return null;
    }

    const spread = Number.isFinite(bestAsk) && Number.isFinite(bestBid)
        ? Math.max(0.04, Math.min(bestAsk - bestBid, referencePrice * 0.02))
        : 0.1;
    const halfSpread = spread / 2;

    if (side === 'BUY') {
        return roundPrice(referencePrice - halfSpread);
    }

    return roundPrice(referencePrice + halfSpread);
}

function getSellTarget(totalShares) {
    if (totalShares <= 0) return 0;
    return Math.max(1, Math.min(
        TARGET_ACTIVE_SELL_VOLUME,
        Math.floor(totalShares * MAX_SELL_INVENTORY_SHARE)
    ));
}

function onTick({ tickers, getDepth, getOpenOrderCount, getAvailableShares, getShares }) {
    const orders = [];

    for (const ticker of tickers) {
        const buyOpen = getOpenOrderCount(ticker, 'BUY');
        if (buyOpen < TARGET_ACTIVE_BUY_VOLUME) {
            const buyPrice = buildQuote(getDepth, ticker, 'BUY');
            if (buyPrice) {
                orders.push({
                    ticker,
                    side: 'BUY',
                    type: 'LIMIT',
                    price: buyPrice,
                    quantity: TARGET_ACTIVE_BUY_VOLUME - buyOpen,
                });
            }
        }

        const sellOpen = getOpenOrderCount(ticker, 'SELL');
        const availableShares = getAvailableShares(ticker);
        const sellTarget = getSellTarget(getShares(ticker));
        if (sellOpen < sellTarget && availableShares >= 1) {
            const sellPrice = buildQuote(getDepth, ticker, 'SELL');
            if (sellPrice) {
                orders.push({
                    ticker,
                    side: 'SELL',
                    type: 'LIMIT',
                    price: sellPrice,
                    quantity: Math.min(sellTarget - sellOpen, Math.floor(availableShares)),
                });
            }
        }
    }

    return orders;
}

function onNews() {
    return [];
}

export default {
    id: 'market_maker',
    displayName: 'Market Maker',
    username: 'bot_market_maker',
    intervalMs: 3_000,
    thresholds,
    onTick,
    onNews,
};
