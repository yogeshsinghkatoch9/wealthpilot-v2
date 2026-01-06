const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

// API Keys (from user's provided keys)
const API_KEYS = {
  FMP: 'nKxGNnbkLs6VUjVsbeKTlQF4UPKyvPbG',
  ALPHA_VANTAGE: 'WTV2HVV9OLJ76NEV',
  FINNHUB: 'd5aapqpr01qn2tat2j3gd5aapqpr01qn2tat2j40',
  TWELVE_DATA: '02560afd7d82496aa5f35169b53b41ca'
};

// User agents rotation to avoid detection
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Helper: Random delay to avoid rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => delay(Math.random() * 500 + 200); // 200-700ms random delay

// Helper: Get random user agent
const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

/**
 * STRATEGY 1: Yahoo Finance with anti-rate-limit measures
 */
async function fetchFromYahoo(symbol) {
  try {
    await randomDelay();

    const yahooFinance = require('yahoo-finance2').default;
    yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);

    const quote = await yahooFinance.quote(symbol, {}, {
      headers: { 'User-Agent': getRandomUserAgent() }
    });

    if (quote && quote.regularMarketPrice) {
      return {
        symbol: quote.symbol,
        name: quote.shortName || quote.longName || symbol,
        price: quote.regularMarketPrice,
        previousClose: quote.regularMarketPreviousClose,
        open: quote.regularMarketOpen,
        high: quote.regularMarketDayHigh,
        low: quote.regularMarketDayLow,
        volume: quote.regularMarketVolume,
        marketCap: quote.marketCap,
        changeAmount: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        source: 'yahoo'
      };
    }
    return null;
  } catch (error) {
    console.log(`[Yahoo] Failed for ${symbol}: ${error.message}`);
    return null;
  }
}

/**
 * STRATEGY 2: Financial Modeling Prep API (FMP)
 */
async function fetchFromFMP(symbol) {
  try {
    const url = `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${API_KEYS.FMP}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10000
    });

    if (response.data && response.data[0]) {
      const data = response.data[0];
      return {
        symbol: data.symbol,
        name: data.name || symbol,
        price: data.price,
        previousClose: data.previousClose,
        open: data.open,
        high: data.dayHigh,
        low: data.dayLow,
        volume: data.volume,
        marketCap: data.marketCap,
        changeAmount: data.change,
        changePercent: data.changesPercentage,
        source: 'fmp'
      };
    }
    return null;
  } catch (error) {
    console.log(`[FMP] Failed for ${symbol}: ${error.message}`);
    return null;
  }
}

/**
 * STRATEGY 3: Finnhub API
 */
async function fetchFromFinnhub(symbol) {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEYS.FINNHUB}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10000
    });

    if (response.data && response.data.c > 0) {
      const data = response.data;
      return {
        symbol: symbol,
        name: symbol, // Finnhub quote doesn't return name
        price: data.c, // current
        previousClose: data.pc, // previous close
        open: data.o,
        high: data.h,
        low: data.l,
        volume: null,
        marketCap: null,
        changeAmount: data.d, // change
        changePercent: data.dp, // change percent
        source: 'finnhub'
      };
    }
    return null;
  } catch (error) {
    console.log(`[Finnhub] Failed for ${symbol}: ${error.message}`);
    return null;
  }
}

/**
 * STRATEGY 4: Twelve Data API
 */
async function fetchFromTwelveData(symbol) {
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${API_KEYS.TWELVE_DATA}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10000
    });

    if (response.data && response.data.close && !response.data.code) {
      const data = response.data;
      const price = parseFloat(data.close);
      const prevClose = parseFloat(data.previous_close);
      const change = price - prevClose;
      const changePercent = (change / prevClose) * 100;

      return {
        symbol: data.symbol,
        name: data.name || symbol,
        price: price,
        previousClose: prevClose,
        open: parseFloat(data.open),
        high: parseFloat(data.high),
        low: parseFloat(data.low),
        volume: parseInt(data.volume) || null,
        marketCap: null,
        changeAmount: change,
        changePercent: changePercent,
        source: 'twelvedata'
      };
    }
    return null;
  } catch (error) {
    console.log(`[TwelveData] Failed for ${symbol}: ${error.message}`);
    return null;
  }
}

/**
 * STRATEGY 5: Alpha Vantage API
 */
async function fetchFromAlphaVantage(symbol) {
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${API_KEYS.ALPHA_VANTAGE}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10000
    });

    if (response.data && response.data['Global Quote']) {
      const data = response.data['Global Quote'];
      return {
        symbol: data['01. symbol'],
        name: symbol,
        price: parseFloat(data['05. price']),
        previousClose: parseFloat(data['08. previous close']),
        open: parseFloat(data['02. open']),
        high: parseFloat(data['03. high']),
        low: parseFloat(data['04. low']),
        volume: parseInt(data['06. volume']),
        marketCap: null,
        changeAmount: parseFloat(data['09. change']),
        changePercent: parseFloat(data['10. change percent']?.replace('%', '')),
        source: 'alphavantage'
      };
    }
    return null;
  } catch (error) {
    console.log(`[AlphaVantage] Failed for ${symbol}: ${error.message}`);
    return null;
  }
}

/**
 * Main Quote Function - Tries multiple sources with fallback
 */
async function getQuote(symbol) {
  const upperSymbol = symbol.toUpperCase();

  // Check cache first (valid for 30 seconds)
  const cached = await prisma.stockQuote.findUnique({
    where: { symbol: upperSymbol }
  });

  if (cached) {
    const age = Date.now() - new Date(cached.updatedAt).getTime();
    if (age < 30000) { // 30 seconds cache
      console.log(`[StockData] Using cached data for ${upperSymbol}`);
      return cached;
    }
  }

  console.log(`[StockData] Fetching fresh quote for ${upperSymbol}`);

  // Try each source in order until one succeeds
  const sources = [
    { name: 'FMP', fn: fetchFromFMP },
    { name: 'Finnhub', fn: fetchFromFinnhub },
    { name: 'TwelveData', fn: fetchFromTwelveData },
    { name: 'Yahoo', fn: fetchFromYahoo },
    { name: 'AlphaVantage', fn: fetchFromAlphaVantage }
  ];

  for (const source of sources) {
    try {
      const result = await source.fn(upperSymbol);
      if (result && result.price > 0) {
        console.log(`[StockData] Got ${upperSymbol} from ${source.name}: $${result.price}`);

        // Store in database
        const quoteData = {
          symbol: upperSymbol,
          name: result.name,
          price: result.price,
          previousClose: result.previousClose,
          open: result.open,
          high: result.high,
          low: result.low,
          volume: result.volume ? BigInt(result.volume) : null,
          marketCap: result.marketCap ? BigInt(result.marketCap) : null,
          changeAmount: result.changeAmount,
          changePercent: result.changePercent
        };

        await prisma.stockQuote.upsert({
          where: { symbol: upperSymbol },
          update: quoteData,
          create: quoteData
        }).catch(e => console.log('[DB] Cache update error:', e.message));

        return quoteData;
      }
    } catch (error) {
      console.log(`[StockData] ${source.name} error:`, error.message);
    }

    // Small delay between API calls
    await delay(100);
  }

  // If all APIs fail, return cached data if available
  if (cached) {
    console.log(`[StockData] All APIs failed, returning stale cache for ${upperSymbol}`);
    return cached;
  }

  console.log(`[StockData] All sources failed for ${upperSymbol}`);
  return null;
}

/**
 * Get multiple quotes at once
 */
async function getQuotes(symbols) {
  const results = {};

  for (const symbol of symbols) {
    const quote = await getQuote(symbol);
    if (quote) {
      results[symbol.toUpperCase()] = quote;
    }
    await delay(50); // Small delay between requests
  }

  return results;
}

/**
 * Get historical data
 */
async function getHistoricalData(symbol, options = {}) {
  const { days = 365 * 5, forceRefresh = false } = options;
  const upperSymbol = symbol.toUpperCase();

  // Check if we have recent data
  if (!forceRefresh) {
    const metadata = await prisma.stockMetadata.findUnique({
      where: { symbol: upperSymbol }
    });

    if (metadata?.lastFetchedAt) {
      const timeSinceLastFetch = Date.now() - new Date(metadata.lastFetchedAt).getTime();
      if (timeSinceLastFetch < ONE_DAY_MS) {
        return getStoredHistoricalData(upperSymbol, days);
      }
    }
  }

  return fetchAndStoreHistoricalData(upperSymbol);
}

async function getStoredHistoricalData(symbol, days = 365 * 5) {
  const startDate = new Date(Date.now() - days * ONE_DAY_MS);

  const history = await prisma.stockHistory.findMany({
    where: { symbol, date: { gte: startDate } },
    orderBy: { date: 'asc' }
  });

  return history.map(h => ({
    date: h.date,
    open: h.open,
    high: h.high,
    low: h.low,
    close: h.close,
    adjClose: h.adjClose,
    volume: Number(h.volume)
  }));
}

async function fetchAndStoreHistoricalData(symbol) {
  let historyData = null;

  // Strategy 1: Try Twelve Data (has historical endpoint)
  if (!historyData) {
    try {
      console.log(`[StockData] Trying Twelve Data for ${symbol} historical data...`);
      await delay(1000); // Rate limit protection

      const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=365&apikey=${API_KEYS.TWELVE_DATA}`;
      const response = await axios.get(url, { timeout: 30000 });

      if (response.data && response.data.values && !response.data.code) {
        historyData = response.data.values.map(row => ({
          symbol,
          date: new Date(row.datetime),
          open: parseFloat(row.open) || 0,
          high: parseFloat(row.high) || 0,
          low: parseFloat(row.low) || 0,
          close: parseFloat(row.close) || 0,
          adjClose: parseFloat(row.close) || 0,
          volume: BigInt(row.volume || 0)
        })).reverse(); // Twelve Data returns newest first
        console.log(`[StockData] Twelve Data returned ${historyData.length} records for ${symbol}`);
      }
    } catch (error) {
      console.log(`[StockData] Twelve Data historical failed for ${symbol}: ${error.message}`);
    }
  }

  // Strategy 2: Try Yahoo Finance with delay
  if (!historyData) {
    try {
      console.log(`[StockData] Trying Yahoo Finance for ${symbol} historical data...`);
      await delay(2000); // Longer delay for Yahoo

      const yahooFinance = require('yahoo-finance2').default;
      yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);

      const endDate = new Date();
      const startDate = new Date(Date.now() - 365 * ONE_DAY_MS); // Just 1 year for now

      const result = await yahooFinance.historical(symbol, {
        period1: startDate,
        period2: endDate,
        interval: '1d'
      });

      if (result && result.length > 0) {
        historyData = result.map(row => ({
          symbol,
          date: new Date(row.date),
          open: row.open || 0,
          high: row.high || 0,
          low: row.low || 0,
          close: row.close || 0,
          adjClose: row.adjClose || row.close || 0,
          volume: BigInt(row.volume || 0)
        }));
        console.log(`[StockData] Yahoo returned ${historyData.length} records for ${symbol}`);
      }
    } catch (error) {
      console.log(`[StockData] Yahoo historical failed for ${symbol}: ${error.message}`);
    }
  }

  // Strategy 3: Try FMP if others fail
  if (!historyData) {
    try {
      console.log(`[StockData] Trying FMP for ${symbol} historical data...`);
      await delay(1000);

      const endDate = new Date();
      const startDate = new Date(Date.now() - 365 * ONE_DAY_MS);

      const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${symbol}?from=${startDate.toISOString().split('T')[0]}&to=${endDate.toISOString().split('T')[0]}&apikey=${API_KEYS.FMP}`;

      const response = await axios.get(url, { timeout: 30000 });

      if (response.data && response.data.historical) {
        historyData = response.data.historical.map(row => ({
          symbol,
          date: new Date(row.date),
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          adjClose: row.adjClose || row.close,
          volume: BigInt(row.volume || 0)
        }));
        console.log(`[StockData] FMP returned ${historyData.length} records for ${symbol}`);
      }
    } catch (error) {
      console.log(`[StockData] FMP historical failed for ${symbol}: ${error.message}`);
    }
  }

  // Store the data if we got any
  if (historyData && historyData.length > 0) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.stockHistory.deleteMany({ where: { symbol } });
        await tx.stockHistory.createMany({ data: historyData, skipDuplicates: true });
        await tx.stockMetadata.upsert({
          where: { symbol },
          update: {
            historyStartDate: historyData[historyData.length - 1]?.date,
            historyEndDate: historyData[0]?.date,
            lastFetchedAt: new Date()
          },
          create: {
            symbol,
            historyStartDate: historyData[historyData.length - 1]?.date,
            historyEndDate: historyData[0]?.date,
            lastFetchedAt: new Date()
          }
        });
      });

      console.log(`[StockData] Stored ${historyData.length} historical records for ${symbol}`);
      return historyData.map(h => ({ ...h, volume: Number(h.volume) }));
    } catch (dbError) {
      console.error(`[StockData] DB error storing ${symbol}:`, dbError.message);
    }
  }

  // Return cached if fetch fails
  return getStoredHistoricalData(symbol);
}

async function getStockMetadata(symbol) {
  const upperSymbol = symbol.toUpperCase();

  let metadata = await prisma.stockMetadata.findUnique({
    where: { symbol: upperSymbol }
  });

  if (metadata?.name) return metadata;

  // Get name from quote
  const quote = await getQuote(upperSymbol);
  if (quote) {
    metadata = await prisma.stockMetadata.upsert({
      where: { symbol: upperSymbol },
      update: { name: quote.name },
      create: { symbol: upperSymbol, name: quote.name }
    });
  }

  return metadata || { symbol: upperSymbol };
}

async function hasRecentData(symbol) {
  const metadata = await prisma.stockMetadata.findUnique({
    where: { symbol: symbol.toUpperCase() }
  });

  if (!metadata?.lastFetchedAt) return false;
  return (Date.now() - new Date(metadata.lastFetchedAt).getTime()) < ONE_DAY_MS;
}

module.exports = {
  getHistoricalData,
  getStoredHistoricalData,
  fetchAndStoreHistoricalData,
  getQuote,
  getQuotes,
  getStockMetadata,
  hasRecentData
};
