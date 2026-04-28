import trendRider from './trendRider.js';
import contrarian from './contrarian.js';
import whale from './whale.js';
import skeptic from './skeptic.js';
import optimist from './optimist.js';
import valueHunter from './valueHunter.js';
import newsJunkie from './newsJunkie.js';
import marketMaker from './marketMaker.js';
import noiseTrader from './noiseTrader.js';

export const BOT_STRATEGIES = [
    marketMaker,
    contrarian,
    trendRider,
    whale,
    optimist,
    skeptic,
    valueHunter,
    newsJunkie,
    noiseTrader,
];

export const BOT_NAME_TO_STRATEGY = {
    'bot_market_maker': marketMaker,
    'bot_contrarian' : contrarian,
    'bot_trend_rider': trendRider,
    'bot_whale': whale,
    'bot_optimist': optimist,
    'bot_skeptic': skeptic,
    'bot_value_hunter': valueHunter,
    'bot_news_junkie': newsJunkie,
    'bot_noise_trader': noiseTrader
}
