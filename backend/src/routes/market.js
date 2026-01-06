const express = require('express');
const yahooFinance = require('yahoo-finance2').default;
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Cache for quotes (5 second TTL)
const quoteCache = new Map();
const CACHE_TTL = 5000;

// GET /api/market/quote/:symbol
router.get('/quote/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    // Check cache
    const cached = quoteCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }

    // Fetch from Yahoo Finance
    const quote = await yahooFinance.quote(symbol);

    const data = {
      symbol: quote.symbol,
      name: quote.shortName || quote.longName,
      price: quote.regularMarketPrice,
      change: quote.regularMarketChange,
      changePercent: quote.regularMarketChangePercent,
      previousClose: quote.regularMarketPreviousClose,
      open: quote.regularMarketOpen,
      high: quote.regularMarketDayHigh,
      low: quote.regularMarketDayLow,
      volume: quote.regularMarketVolume,
      marketCap: quote.marketCap,
      peRatio: quote.trailingPE,
      week52High: quote.fiftyTwoWeekHigh,
      week52Low: quote.fiftyTwoWeekLow,
      dividendYield: quote.dividendYield
    };

    // Update cache
    quoteCache.set(symbol, { data, timestamp: Date.now() });

    // Update database cache
    await prisma.stockQuote.upsert({
      where: { symbol },
      update: {
        name: data.name,
        price: data.price,
        previousClose: data.previousClose,
        open: data.open,
        high: data.high,
        low: data.low,
        volume: data.volume ? BigInt(data.volume) : null,
        marketCap: data.marketCap ? BigInt(data.marketCap) : null,
        peRatio: data.peRatio,
        week52High: data.week52High,
        week52Low: data.week52Low,
        dividendYield: data.dividendYield,
        changeAmount: data.change,
        changePercent: data.changePercent
      },
      create: {
        symbol,
        name: data.name,
        price: data.price,
        previousClose: data.previousClose,
        open: data.open,
        high: data.high,
        low: data.low,
        volume: data.volume ? BigInt(data.volume) : null,
        marketCap: data.marketCap ? BigInt(data.marketCap) : null,
        peRatio: data.peRatio,
        week52High: data.week52High,
        week52Low: data.week52Low,
        dividendYield: data.dividendYield,
        changeAmount: data.change,
        changePercent: data.changePercent
      }
    }).catch(() => {}); // Ignore cache errors

    res.json(data);
  } catch (error) {
    console.error('[Quote Error]', error.message);
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

// GET /api/market/quotes?symbols=AAPL,GOOGL,MSFT
router.get('/quotes', async (req, res) => {
  try {
    const symbols = req.query.symbols?.split(',').map(s => s.trim().toUpperCase()) || [];

    if (symbols.length === 0) {
      return res.status(400).json({ error: 'No symbols provided' });
    }

    if (symbols.length > 50) {
      return res.status(400).json({ error: 'Max 50 symbols allowed' });
    }

    const quotes = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const quote = await yahooFinance.quote(symbol);
          return {
            symbol: quote.symbol,
            name: quote.shortName,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            changePercent: quote.regularMarketChangePercent
          };
        } catch {
          return { symbol, error: 'Failed to fetch' };
        }
      })
    );

    res.json(quotes);
  } catch (error) {
    console.error('[Quotes Error]', error);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// GET /api/market/indices
router.get('/indices', async (req, res) => {
  try {
    const indices = ['^GSPC', '^DJI', '^IXIC', '^VIX'];
    const names = { '^GSPC': 'S&P 500', '^DJI': 'Dow Jones', '^IXIC': 'NASDAQ', '^VIX': 'VIX' };
    const displaySymbols = { '^GSPC': 'SPY', '^DJI': 'DIA', '^IXIC': 'QQQ', '^VIX': 'VIX' };

    const data = await Promise.all(
      indices.map(async (symbol) => {
        try {
          const quote = await yahooFinance.quote(symbol);
          return {
            symbol: displaySymbols[symbol],
            name: names[symbol],
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            changePercent: quote.regularMarketChangePercent
          };
        } catch {
          return { symbol: displaySymbols[symbol], name: names[symbol], price: 0, change: 0, changePercent: 0 };
        }
      })
    );

    res.json(data);
  } catch (error) {
    console.error('[Indices Error]', error);
    res.status(500).json({ error: 'Failed to fetch indices' });
  }
});

// GET /api/market/search?q=apple
router.get('/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.length < 1) {
      return res.json([]);
    }

    const results = await yahooFinance.search(query);

    const stocks = results.quotes
      .filter(q => q.quoteType === 'EQUITY')
      .slice(0, 10)
      .map(q => ({
        symbol: q.symbol,
        name: q.shortname || q.longname,
        exchange: q.exchange
      }));

    res.json(stocks);
  } catch (error) {
    console.error('[Search Error]', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
