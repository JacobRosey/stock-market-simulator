import { COMPANY_TYPES, HEADLINE_TEMPLATES, SECTOR_LABELS } from './headlineLibrary.js';

const ONE_MINUTE_MS = 60_000;
/** @typedef {import('../src/types').NewsData} NewsData */
/** @typedef {import('../src/types').CompanyTypes} CompanyTypes */

let availableHeadlines = HEADLINE_TEMPLATES.map(h => h.id);
const allHeadlines = [...availableHeadlines];

function pickRandom(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function randomIntInclusive(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

let lastId = null;

function chooseTemplate() {
    if (availableHeadlines.length === 0) {
        availableHeadlines = [...allHeadlines];
    }

    let randomIndex = Math.floor(Math.random() * availableHeadlines.length);
    
    // If the list was just reset and we picked the same ID as last time
    if (availableHeadlines.length > 1 && availableHeadlines[randomIndex] === lastId) {
        // Just pick the next one in the array instead
        randomIndex = (randomIndex + 1) % availableHeadlines.length;
    }

    const [selectedId] = availableHeadlines.splice(randomIndex, 1);
    lastId = selectedId;
    
    return HEADLINE_TEMPLATES.find(h => h.id === selectedId);
}

function buildHeadline(template, ticker, sectorLabel) {
    return template.text
        .replace('{ticker}', ticker ?? '')
        .replace('{sector}', sectorLabel ?? 'the sector')
        .trim();
}

function formatSectorLabel(sectors) {
    if (!Array.isArray(sectors) || sectors.length === 0) return undefined;
    const labels = sectors.map(sector => SECTOR_LABELS[sector] ?? sector);
    return labels.join(' and ');
}

function dedupeCompanyTypes(items) {
    return [...new Set(items)];
}

function mapArchetypeToCompanyType(archetype) {
    if (archetype === 'stable' || archetype === 'defensive') return 'Stable';
    if (archetype === 'risky') return 'Risky';
    if (archetype === 'cyclical') return 'Cyclical';
    return 'Moderate';
}

/**
 * Generates a NewsData-shaped payload:
 * { headline, sentiment, affectedTickers?, affectedSectors?, global }
 * @returns {NewsData}
 */
export function generateNewsEvent() {
    const template = chooseTemplate();
    const [minSentiment, maxSentiment] = template.sentimentRange;
    const sentiment = randomIntInclusive(minSentiment, maxSentiment);
    const isStimulus = template.isStimulus === true;
    const stimulusCashAmount = isStimulus ? Number(template.stimulusCashAmount ?? 0) : undefined;

    if (template.scope === 'global') {
        const allCompanyTypes = dedupeCompanyTypes(
            COMPANY_TYPES.map(company => mapArchetypeToCompanyType(company.archetype))
        );

        return {
            headline: template.text,
            sentiment,
            global: true,
            stimulus: isStimulus,
            isStimulus,
            stimulusCashAmount,
            positivelyEffected: sentiment >= 0 ? allCompanyTypes : [],
            negativelyEffected: sentiment < 0 ? allCompanyTypes : [],
        };
    }

    const matchingCompanies = COMPANY_TYPES.filter(company =>
        !template.sectors || template.sectors.includes(company.sector)
    );

    const selectedCompany = pickRandom(matchingCompanies);
    const sectorCode = selectedCompany?.sector;
    const sectorLabel = sectorCode ? (SECTOR_LABELS[sectorCode] ?? sectorCode) : undefined;

    if (template.scope === 'sector') {
        const affectedSectors = template.sectors ?? (sectorCode ? [sectorCode] : []);
        const multiSectorLabel = formatSectorLabel(affectedSectors);

        const sectorTypes = dedupeCompanyTypes(
            COMPANY_TYPES
                .filter(company => affectedSectors.includes(company.sector))
                .map(company => mapArchetypeToCompanyType(company.archetype))
        );

        return {
            headline: buildHeadline(template, null, multiSectorLabel),
            sentiment,
            affectedSectors: affectedSectors.length > 0 ? affectedSectors : undefined,
            global: false,
            stimulus: isStimulus,
            isStimulus,
            stimulusCashAmount,
            positivelyEffected: sentiment >= 0 ? sectorTypes : [],
            negativelyEffected: sentiment < 0 ? sectorTypes : [],
        };
    }

    const selectedType = selectedCompany
        ? [mapArchetypeToCompanyType(selectedCompany.archetype)]
        : [];

    return {
        headline: buildHeadline(template, selectedCompany?.ticker, sectorLabel),
        sentiment,
        affectedTickers: selectedCompany?.ticker ? [selectedCompany.ticker] : undefined,
        affectedSectors: sectorCode ? [sectorCode] : undefined,
        global: false,
        stimulus: isStimulus,
        isStimulus,
        stimulusCashAmount,
        positivelyEffected: sentiment >= 0 ? selectedType : [],
        negativelyEffected: sentiment < 0 ? selectedType : [],
    };
}

export function startNewsGenerator(io, options = {}) {
    const intervalMs = options.intervalMs ?? ONE_MINUTE_MS;
    const emitOnStart = options.emitOnStart ?? true;
    const onEmit = options.onEmit ?? (() => {});

    const emitNews = () => {
        const payload = generateNewsEvent();
        payload.timestamp = Date.now()
        io.emit('NEWS', payload);
        onEmit(payload);
    };

    if (emitOnStart) {
        emitNews();
    }

    const timer = setInterval(emitNews, intervalMs);

    return {
        stop: () => clearInterval(timer),
    };
}
