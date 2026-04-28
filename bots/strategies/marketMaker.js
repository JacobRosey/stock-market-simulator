import { getDepthInfo, roundPrice } from './shared.js';

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

const TARGET_ACTIVE_BUY_VOLUME = 20;
const TARGET_ACTIVE_SELL_VOLUME = 20;
const MAX_SELL_INVENTORY_SHARE = 0.25;

function buildQuote(getDepth, ticker, side) {
    const { bestBid, bestAsk, mid } = getDepthInfo(getDepth, ticker);
    if (!Number.isFinite(mid) && !Number.isFinite(bestBid) && !Number.isFinite(bestAsk)) {
        return null;
    }

    const spread = Number.isFinite(bestAsk) && Number.isFinite(bestBid)
        ? Math.max(0.04, bestAsk - bestBid)
        : 0.1;

    if (side === 'BUY') {
        const anchor = Number.isFinite(bestBid) ? bestBid : (Number.isFinite(mid) ? mid : bestAsk);
        return roundPrice(anchor - spread * 0.25);
    }

    const anchor = Number.isFinite(bestAsk) ? bestAsk : (Number.isFinite(mid) ? mid : bestBid);
    return roundPrice(anchor + spread * 0.25);
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
            console.log(`market maker placing buy order for ${ticker}`)
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
            console.log(`market maker placing sell order for ${ticker}`)
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
