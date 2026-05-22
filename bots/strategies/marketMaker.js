import { getDepthInfo, getReferencePrice, randomOrderSize, roundPrice, tickerMeta } from './shared.js';

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

const MARKET_MAKER_MIN_SPREAD = 0.15;
const MARKET_MAKER_TARGET_SPREAD = 0.4;
const MARKET_MAKER_MAX_TOP_LEVEL_SIZE = 100;
const MARKET_MAKER_ORDER_SIZE_MIN = 5;
const MARKET_MAKER_ORDER_SIZE_MAX = 25;
const MARKET_MAKER_INVENTORY_SKEW_SHARES = 500;
const MARKET_MAKER_TARGET_SHARES = 500;
const TARGET_ACTIVE_BUY_VOLUME = 25;
const TARGET_ACTIVE_SELL_VOLUME = 25;
const MAX_SELL_INVENTORY_SHARE = 0.25;

const liquidityProfiles = {
    NEXUS: { minSpread: 0.1, targetSpread: 0.25, maxTopSize: 150 },
    MEGA: { minSpread: 0.1, targetSpread: 0.25, maxTopSize: 150 },
    AGB: { minSpread: 0.12, targetSpread: 0.3, maxTopSize: 130 },
    AERO: { minSpread: 0.12, targetSpread: 0.3, maxTopSize: 130 },
    BIOV: { minSpread: 0.35, targetSpread: 0.9, maxTopSize: 40 },
    NEURO: { minSpread: 0.35, targetSpread: 0.9, maxTopSize: 40 },
    QCI: { minSpread: 0.28, targetSpread: 0.75, maxTopSize: 55 },
    CRC: { minSpread: 0.28, targetSpread: 0.75, maxTopSize: 55 },
};

function getLiquidityProfile(ticker) {
    const explicitProfile = liquidityProfiles[ticker];
    if (explicitProfile) return explicitProfile;

    const archetype = tickerMeta.get(ticker)?.archetype;
    if (archetype === 'stable' || archetype === 'defensive') {
        return { minSpread: 0.12, targetSpread: 0.3, maxTopSize: 120 };
    }
    if (archetype === 'risky') {
        return { minSpread: 0.3, targetSpread: 0.8, maxTopSize: 50 };
    }
    if (archetype === 'cyclical') {
        return { minSpread: 0.2, targetSpread: 0.55, maxTopSize: 75 };
    }

    return {
        minSpread: MARKET_MAKER_MIN_SPREAD,
        targetSpread: MARKET_MAKER_TARGET_SPREAD,
        maxTopSize: MARKET_MAKER_MAX_TOP_LEVEL_SIZE,
    };
}

function getTopLevelSize(depth, side) {
    const levels = side === 'BUY' ? depth?.bids : depth?.asks;
    if (!levels || levels.length === 0) return 0;
    return Number(levels[0].quantity ?? levels[0].size ?? 0);
}

function canMarketMakerQuote(depth, profile) {
    const bestBid = depth?.bids?.[0]?.price;
    const bestAsk = depth?.asks?.[0]?.price;

    if (bestBid == null || bestAsk == null) {
        return true;
    }

    const spread = bestAsk - bestBid;
    if (spread < profile.minSpread) {
        return false;
    }

    const topBidSize = getTopLevelSize(depth, 'BUY');
    const topAskSize = getTopLevelSize(depth, 'SELL');

    return topBidSize <= profile.maxTopSize && topAskSize <= profile.maxTopSize;
}

function randomQuoteOffset(targetSpread) {
    const r = Math.random();

    if (r < 0.6) return targetSpread / 4 + Math.random() * (targetSpread / 2);
    if (r < 0.9) return targetSpread * 0.75 + Math.random() * targetSpread;
    return targetSpread * 1.5 + Math.random() * targetSpread * 3;
}

function getInventorySkew(positionShares, targetShares = MARKET_MAKER_TARGET_SHARES) {
    const difference = positionShares - targetShares;

    if (difference > MARKET_MAKER_INVENTORY_SKEW_SHARES) {
        return 'TOO_LONG';
    }
    if (difference < -MARKET_MAKER_INVENTORY_SKEW_SHARES) {
        return 'TOO_SHORT';
    }

    return 'BALANCED';
}

function applyInventorySkew(quote, skew) {
    if (skew === 'TOO_LONG') {
        return {
            ...quote,
            bidQuantity: Math.max(1, Math.floor(quote.bidQuantity * 0.25)),
            askQuantity: Math.max(1, Math.floor(quote.askQuantity * 1.5)),
            askPrice: roundPrice(quote.askPrice - 0.05),
        };
    }

    if (skew === 'TOO_SHORT') {
        return {
            ...quote,
            bidQuantity: Math.max(1, Math.floor(quote.bidQuantity * 1.5)),
            askQuantity: Math.max(1, Math.floor(quote.askQuantity * 0.25)),
            bidPrice: roundPrice(quote.bidPrice + 0.05),
        };
    }

    return quote;
}

function keepQuotesOrdered(quote) {
    if (!quote?.bidPrice || !quote?.askPrice) return null;
    if (quote.askPrice > quote.bidPrice) return quote;

    const midpoint = (quote.bidPrice + quote.askPrice) / 2;
    return {
        ...quote,
        bidPrice: roundPrice(midpoint - 0.01),
        askPrice: roundPrice(midpoint + 0.01),
    };
}

function buildQuotePair(getDepth, ticker, positionShares) {
    const { depth, bestBid, bestAsk, mid } = getDepthInfo(getDepth, ticker);
    const profile = getLiquidityProfile(ticker);
    if (!canMarketMakerQuote(depth, profile)) {
        return null;
    }

    const referencePrice = getReferencePrice(getDepth, ticker);
    if (!Number.isFinite(referencePrice)) {
        return null;
    }

    const midpoint = Number.isFinite(bestBid) && Number.isFinite(bestAsk) && Number.isFinite(mid)
        ? mid
        : referencePrice;
    const offset = randomQuoteOffset(profile.targetSpread);
    const skew = getInventorySkew(positionShares);
    const quote = {
        bidPrice: roundPrice(midpoint - offset),
        askPrice: roundPrice(midpoint + offset),
        bidQuantity: randomOrderSize(MARKET_MAKER_ORDER_SIZE_MIN, MARKET_MAKER_ORDER_SIZE_MAX),
        askQuantity: randomOrderSize(MARKET_MAKER_ORDER_SIZE_MIN, MARKET_MAKER_ORDER_SIZE_MAX),
    };

    return keepQuotesOrdered(applyInventorySkew(quote, skew));
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
        const quote = buildQuotePair(getDepth, ticker, getShares(ticker));
        if (!quote) continue;

        const buyOpen = getOpenOrderCount(ticker, 'BUY');
        if (buyOpen < TARGET_ACTIVE_BUY_VOLUME) {
            if (quote.bidPrice) {
                orders.push({
                    ticker,
                    side: 'BUY',
                    type: 'LIMIT',
                    price: quote.bidPrice,
                    quantity: Math.min(quote.bidQuantity, TARGET_ACTIVE_BUY_VOLUME - buyOpen),
                });
            }
        }

        const sellOpen = getOpenOrderCount(ticker, 'SELL');
        const availableShares = getAvailableShares(ticker);
        const sellTarget = getSellTarget(getShares(ticker));
        if (sellOpen < sellTarget && availableShares >= 1) {
            if (quote.askPrice) {
                orders.push({
                    ticker,
                    side: 'SELL',
                    type: 'LIMIT',
                    price: quote.askPrice,
                    quantity: Math.min(quote.askQuantity, sellTarget - sellOpen, Math.floor(availableShares)),
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
    backgroundFlow: false,
    thresholds,
    onTick,
    onNews,
};
