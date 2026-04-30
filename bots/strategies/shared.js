import { COMPANY_TYPES } from '../../news/headlineLibrary.js';

export const tickerMeta = new Map(
    COMPANY_TYPES.map((company) => [company.ticker, company])
);

export function roundPrice(price) {
    if (!Number.isFinite(price)) return null;
    return Math.max(0.01, Math.round(price * 100) / 100);
}

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomChoice(items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    return items[Math.floor(Math.random() * items.length)] ?? null;
}

export function chooseOrderType(marketProbability = 0.3) {
    return Math.random() < marketProbability ? 'MARKET' : 'LIMIT';
}

export function clampSentiment(sentiment) {
    return clamp(sentiment ?? 0, -10, 10);
}

export function getDepthInfo(getDepth, ticker) {
    const depth = getDepth(ticker);
    const bestBid = depth?.bids?.[0]?.price ?? null;
    const bestAsk = depth?.asks?.[0]?.price ?? null;

    let mid = depth?.lastPrice ?? null;
    if (Number.isFinite(bestBid) && Number.isFinite(bestAsk)) {
        mid = (bestBid + bestAsk) / 2;
    } else if (Number.isFinite(bestBid) && !Number.isFinite(mid)) {
        mid = bestBid;
    } else if (Number.isFinite(bestAsk) && !Number.isFinite(mid)) {
        mid = bestAsk;
    }

    return { depth, bestBid, bestAsk, mid };
}

export function getReferencePrice(getDepth, ticker) {
    const { bestBid, bestAsk, mid, depth } = getDepthInfo(getDepth, ticker);
    const lastPrice = Number(depth?.lastPrice ?? 0);
    const hasLastPrice = Number.isFinite(lastPrice) && lastPrice > 0;
    const hasTwoSidedBook = Number.isFinite(bestBid) && bestBid > 0 && Number.isFinite(bestAsk) && bestAsk > 0;

    if (hasTwoSidedBook && Number.isFinite(mid) && mid > 0) {
        const spread = bestAsk - bestBid;
        const spreadRatio = hasLastPrice ? spread / lastPrice : 0;
        if (spread > 0 && (!hasLastPrice || spreadRatio <= 0.05)) {
            return mid;
        }
    }

    if (hasLastPrice) {
        return lastPrice;
    }

    if (Number.isFinite(mid) && mid > 0) {
        return mid;
    }

    if (Number.isFinite(bestBid) && bestBid > 0) {
        return bestBid;
    }

    if (Number.isFinite(bestAsk) && bestAsk > 0) {
        return bestAsk;
    }

    return null;
}

function getArchetypeMultiplier(thresholds, archetype) {
    if (archetype === 'stable' || archetype === 'defensive') return thresholds.stable ?? 1;
    if (archetype === 'risky') return thresholds.risky ?? 1;
    if (archetype === 'cyclical') return thresholds.cyclical ?? 1;
    return 1;
}

function resolveSectorThreshold(thresholds, sector) {
    const fallback = thresholds.default ?? { buy: 4, sell: -4 };
    if (!sector || !thresholds[sector]) return fallback;
    return {
        buy: thresholds[sector].buy ?? fallback.buy,
        sell: thresholds[sector].sell ?? fallback.sell,
    };
}

function scoreTickerForValue({ sentiment, ticker, thresholds, invert = false }) {
    const meta = tickerMeta.get(ticker);
    if (!meta) return null;

    const baseSentiment = clampSentiment(sentiment ?? 0);
    const archetypeMultiplier = getArchetypeMultiplier(thresholds, meta.archetype);
    const adjustedSentiment = clamp(baseSentiment * archetypeMultiplier, -10, 10);
    const effectiveSentiment = invert ? adjustedSentiment * -1 : adjustedSentiment;
    const sectorThresholds = resolveSectorThreshold(thresholds, meta.sector);

    if (effectiveSentiment >= sectorThresholds.buy) {
        return {
            ticker,
            side: 'BUY',
            sentiment: effectiveSentiment,
            strength: effectiveSentiment - sectorThresholds.buy,
        };
    }

    if (effectiveSentiment <= sectorThresholds.sell) {
        return {
            ticker,
            side: 'SELL',
            sentiment: effectiveSentiment,
            strength: Math.abs(effectiveSentiment - sectorThresholds.sell),
        };
    }

    return null;
}

export function scoreTickerForNews({ news, ticker, thresholds, invert = false }) {
    return scoreTickerForValue({
        sentiment: news?.sentiment ?? 0,
        ticker,
        thresholds,
        invert,
    });
}

export function scoreTickerForSentiment({ sentimentByTicker, ticker, thresholds, invert = false }) {
    return scoreTickerForValue({
        sentiment: sentimentByTicker?.get?.(ticker) ?? 0,
        ticker,
        thresholds,
        invert,
    });
}

export function getNewsTickers(news) {
    if (!news) return [];
    if (Array.isArray(news.affectedTickers) && news.affectedTickers.length > 0) {
        return [...new Set(news.affectedTickers)];
    }

    if (Array.isArray(news.affectedSectors) && news.affectedSectors.length > 0) {
        const sectorSet = new Set(news.affectedSectors);
        return COMPANY_TYPES.filter((company) => sectorSet.has(company.sector)).map((company) => company.ticker);
    }

    if (news.global) {
        return COMPANY_TYPES.map((company) => company.ticker);
    }

    return [];
}

export function buildLimitPrice(getDepth, ticker, side, offset = 0) {
    const referencePrice = getReferencePrice(getDepth, ticker);
    if (!Number.isFinite(referencePrice)) return null;

    if (side === 'BUY') {
        return roundPrice(referencePrice - offset);
    }

    return roundPrice(referencePrice + offset);
}

export function randomizeQuantity(base, variance = 0) {
    if (variance <= 0) return Math.max(1, Math.round(base));
    return Math.max(1, Math.round(base + (Math.random() * 2 - 1) * variance));
}
