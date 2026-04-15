export const COMPANY_TYPES = [
    { ticker: 'NEXUS', sector: 'TECH', archetype: 'stable' },
    { ticker: 'QCI', sector: 'TECH', archetype: 'risky' },
    { ticker: 'CLSE', sector: 'TECH', archetype: 'moderate' },
    { ticker: 'NSMC', sector: 'TECH', archetype: 'cyclical' },

    { ticker: 'AGB', sector: 'FINANCE', archetype: 'stable' },
    { ticker: 'CRC', sector: 'FINANCE', archetype: 'risky' },
    { ticker: 'SGI', sector: 'FINANCE', archetype: 'moderate' },
    { ticker: 'FINT', sector: 'FINANCE', archetype: 'risky' },

    { ticker: 'MEGA', sector: 'RETAIL', archetype: 'stable' },
    { ticker: 'TREND', sector: 'RETAIL', archetype: 'risky' },
    { ticker: 'GLG', sector: 'RETAIL', archetype: 'moderate' },
    { ticker: 'CLICK', sector: 'RETAIL', archetype: 'risky' },

    { ticker: 'IDYN', sector: 'MANUFACTURING', archetype: 'stable' },
    { ticker: 'AUTO', sector: 'MANUFACTURING', archetype: 'cyclical' },
    { ticker: 'AERO', sector: 'MANUFACTURING', archetype: 'stable' },
    { ticker: 'GSYS', sector: 'MANUFACTURING', archetype: 'risky' },

    { ticker: 'GMED', sector: 'PHARMA', archetype: 'defensive' },
    { ticker: 'BIOV', sector: 'PHARMA', archetype: 'risky' },
    { ticker: 'GENH', sector: 'PHARMA', archetype: 'stable' },
    { ticker: 'NEURO', sector: 'PHARMA', archetype: 'risky' },
];

export const SECTOR_LABELS = {
    TECH: 'Technology',
    FINANCE: 'Finance',
    RETAIL: 'Retail',
    MANUFACTURING: 'Manufacturing',
    PHARMA: 'Pharma',
};

export const HEADLINE_TEMPLATES = [
    {
        id: 0,
        scope: 'ticker',
        sectors: ['TECH'],
        sentimentRange: [6, 10],
        text: '{ticker} beats earnings expectations',
    },
    {
        id: 1,
        scope: 'ticker',
        sectors: ['TECH'],
        sentimentRange: [-9, -5],
        text: '{ticker} faces fresh antitrust investigation',
    },
    {
        id: 2,
        scope: 'ticker',
        sectors: ['TECH'],
        sentimentRange: [-6, -3],
        text: 'Major security breach: millions of {ticker} customers effected'
    },
    {
        id: 3,
        scope: 'ticker',
        sectors: ['TECH'],
        sentimentRange: [-8, -4],
        text: '{ticker} warns of semiconductor oversupply and expected price cuts',
    },
    {
        id: 4,
        scope: 'sector',
        sectors: ['FINANCE'],
        sentimentRange: [4, 8],
        text: 'Rate-cut expectations lift {sector} lending outlook',
    },
    {
        id: 5,
        scope: 'ticker',
        sectors: ['FINANCE'],
        sentimentRange: [-8, -4],
        text: '{ticker} raises loan-loss provisions after weaker credit trends',
    },
    {
        id: 6,
        scope: 'ticker',
        sectors: ['RETAIL'],
        sentimentRange: [4, 8],
        text: '{ticker} posts sales above analyst estimates',
    },
    {
        id: 7,
        scope: 'ticker',
        sectors: ['RETAIL'],
        sentimentRange: [-9, -5],
        text: '{ticker} flags rising inventory and deeper markdown risk',
    },
    {
        id: 8,
        scope: 'ticker',
        sectors: ['MANUFACTURING'],
        sentimentRange: [5, 9],
        text: '{ticker} awarded major long-term defense contract',
    },
    {
        id: 9,
        scope: 'sector',
        sectors: ['MANUFACTURING'],
        sentimentRange: [-8, -3],
        text: 'President enacts tariffs: {sector} costs expected to rise',
    },
    {
        id: 10,
        scope: 'ticker',
        sectors: ['PHARMA'],
        sentimentRange: [8, 10],
        text: '{ticker} secures FDA approval for new drug',
    },
    {
        id: 11,
        scope: 'ticker',
        sectors: ['PHARMA'],
        sentimentRange: [-10, -7],
        text: '{ticker} says late-stage clinical trial was unsuccessful',
    },
    {
        id: 12,
        scope: 'global',
        sentimentRange: [2, 6],
        text: 'Risk tolerance improves after interest rates lowered',
    },
    {
        id: 13,
        scope: 'global',
        sentimentRange: [-6, -2],
        text: 'Markets turn defensive as ceasefire negotiations stall',
    },
    {
        id: 14,
        scope: 'sector',
        sectors: ['TECH', 'MANUFACTURING'],
        sentimentRange: [3, 6],
        text: 'Large deposits of rare earth minerals discovered in Nevada'
    },
    {
        id: 15,
        scope: 'global',
        sentimentRange: [2, 5],
        text: 'Federal stimulus package approved to support households and small businesses',
        isStimulus: true,
    },
];
