
var config = module.exports = {};


// Dina variabler
config.checkIntervalInSeconds = 300; // 5 minuter

config.portfolioSize = 4000000;
config.risk = 0.0025;

config.stoplossType = {
    StoplossTypeATR : 1,
    StoplossTypeQuote : 2,
    StoplossTypePercent : 3
}
