const express = require('express');
const { PrismaClient } = require('@prisma/client');
const stockData = require('../services/stockData');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/market/quote/:symbol
router.get('/quote/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const quote = await stockData.getQuote(symbol);

    if (!quote) {
      return res.status(404).json({ error: 'Symbol not found' });
    }

    res.json({
      symbol: quote.symbol,
      name: quote.name,
      price: quote.price,
      change: quote.changeAmount,
      changePercent: quote.changePercent,
      previousClose: quote.previousClose,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      volume: quote.volume ? Number(quote.volume) : null,
      marketCap: quote.marketCap ? Number(quote.marketCap) : null,
      peRatio: quote.peRatio,
      week52High: quote.week52High,
      week52Low: quote.week52Low,
      dividendYield: quote.dividendYield
    });
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

    const quotes = await stockData.getQuotes(symbols);

    const result = symbols.map(symbol => {
      const q = quotes[symbol];
      if (q) {
        return {
          symbol: q.symbol,
          name: q.name,
          price: q.price,
          change: q.changeAmount,
          changePercent: q.changePercent
        };
      }
      return { symbol, error: 'Failed to fetch' };
    });

    res.json(result);
  } catch (error) {
    console.error('[Quotes Error]', error);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// GET /api/market/history/:symbol - Get historical data (fetches and stores 5 years)
router.get('/history/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const days = parseInt(req.query.days) || 365 * 5; // Default 5 years
    const forceRefresh = req.query.refresh === 'true';

    console.log(`[Market] Getting history for ${symbol}, days=${days}, refresh=${forceRefresh}`);

    const history = await stockData.getHistoricalData(symbol, { days, forceRefresh });

    res.json({
      symbol,
      count: history.length,
      data: history
    });
  } catch (error) {
    console.error('[History Error]', error.message);
    res.status(500).json({ error: 'Failed to fetch historical data' });
  }
});

// GET /api/market/metadata/:symbol - Get stock metadata
router.get('/metadata/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const metadata = await stockData.getStockMetadata(symbol);
    res.json(metadata);
  } catch (error) {
    console.error('[Metadata Error]', error.message);
    res.status(500).json({ error: 'Failed to fetch metadata' });
  }
});

// GET /api/market/indices
router.get('/indices', async (req, res) => {
  try {
    const indices = ['^GSPC', '^DJI', '^IXIC', '^VIX'];
    const names = { '^GSPC': 'S&P 500', '^DJI': 'Dow Jones', '^IXIC': 'NASDAQ', '^VIX': 'VIX' };
    const displaySymbols = { '^GSPC': 'SPY', '^DJI': 'DIA', '^IXIC': 'QQQ', '^VIX': 'VIX' };

    const quotes = await stockData.getQuotes(indices);

    const data = indices.map(symbol => {
      const q = quotes[symbol];
      return {
        symbol: displaySymbols[symbol],
        name: names[symbol],
        price: q?.price || 0,
        change: q?.changeAmount || 0,
        changePercent: q?.changePercent || 0
      };
    });

    res.json(data);
  } catch (error) {
    console.error('[Indices Error]', error);
    res.status(500).json({ error: 'Failed to fetch indices' });
  }
});

// GET /api/market/search?q=apple
router.get('/search', async (req, res) => {
  try {
    const yahooFinance = require('yahoo-finance2').default;
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
