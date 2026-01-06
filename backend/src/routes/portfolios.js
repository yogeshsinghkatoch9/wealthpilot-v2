const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const stockData = require('../services/stockData');
const portfolioSnapshot = require('../services/portfolioSnapshot');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication
router.use(authenticate);

// GET /api/portfolios - List all portfolios
router.get('/', async (req, res) => {
  try {
    const portfolios = await prisma.portfolio.findMany({
      where: { userId: req.user.id },
      include: {
        holdings: true,
        _count: { select: { transactions: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate totals for each portfolio
    const enriched = portfolios.map(p => ({
      ...p,
      holdingsCount: p.holdings.length,
      transactionsCount: p._count.transactions
    }));

    res.json(enriched);
  } catch (error) {
    console.error('[Portfolios List Error]', error);
    res.status(500).json({ error: 'Failed to fetch portfolios' });
  }
});

// POST /api/portfolios - Create portfolio
router.post('/', [
  body('name').trim().notEmpty(),
  body('description').optional().trim(),
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'CAD'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, currency } = req.body;

    const portfolio = await prisma.portfolio.create({
      data: {
        userId: req.user.id,
        name,
        description,
        currency: currency || 'USD'
      }
    });

    res.status(201).json(portfolio);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Portfolio name already exists' });
    }
    console.error('[Portfolio Create Error]', error);
    res.status(500).json({ error: 'Failed to create portfolio' });
  }
});

// NOTE: Specific routes MUST come before /:id catch-all routes
// These are moved here from below to fix routing

// GET /api/portfolios/summary/all - Get summary of all portfolios
router.get('/summary/all', async (req, res) => {
  try {
    const portfolios = await prisma.portfolio.findMany({
      where: { userId: req.user.id },
      include: { holdings: true }
    });

    if (portfolios.length === 0) {
      return res.json({
        totalValue: 0,
        totalCost: 0,
        dayGain: 0,
        dayGainPercent: 0,
        totalReturn: 0,
        totalReturnPercent: 0,
        holdingsCount: 0,
        topHoldings: []
      });
    }

    const allHoldings = portfolios.flatMap(p => p.holdings);
    if (allHoldings.length === 0) {
      return res.json({
        totalValue: 0,
        totalCost: 0,
        dayGain: 0,
        dayGainPercent: 0,
        totalReturn: 0,
        totalReturnPercent: 0,
        holdingsCount: 0,
        topHoldings: []
      });
    }

    const symbols = [...new Set(allHoldings.map(h => h.symbol))];
    const quotes = await stockData.getQuotes(symbols);

    const aggregated = {};
    allHoldings.forEach(h => {
      if (!aggregated[h.symbol]) {
        aggregated[h.symbol] = { symbol: h.symbol, shares: 0, totalCost: 0 };
      }
      aggregated[h.symbol].shares += h.shares;
      aggregated[h.symbol].totalCost += h.shares * h.avgCostBasis;
    });

    let totalValue = 0;
    let totalCost = 0;
    let totalDayGain = 0;

    const holdingsWithPrices = Object.values(aggregated).map(h => {
      const quote = quotes[h.symbol] || { price: h.totalCost / h.shares, changeAmount: 0, changePercent: 0, name: h.symbol };
      const currentValue = h.shares * quote.price;
      const dayGain = h.shares * (quote.changeAmount || 0);

      totalValue += currentValue;
      totalCost += h.totalCost;
      totalDayGain += dayGain;

      return {
        symbol: h.symbol,
        name: quote.name,
        shares: h.shares,
        currentPrice: quote.price,
        currentValue,
        costBasis: h.totalCost,
        dayGain,
        dayGainPercent: quote.changePercent || 0,
        totalGain: currentValue - h.totalCost,
        totalGainPercent: h.totalCost > 0 ? ((currentValue - h.totalCost) / h.totalCost) * 100 : 0
      };
    });

    holdingsWithPrices.sort((a, b) => b.currentValue - a.currentValue);

    res.json({
      totalValue,
      totalCost,
      dayGain: totalDayGain,
      dayGainPercent: totalCost > 0 ? (totalDayGain / totalCost) * 100 : 0,
      totalReturn: totalValue - totalCost,
      totalReturnPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
      holdingsCount: allHoldings.length,
      topHoldings: holdingsWithPrices.slice(0, 5)
    });
  } catch (error) {
    console.error('[Portfolio Summary Error]', error);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

// GET /api/portfolios/transactions/recent - Get recent transactions
router.get('/transactions/recent', async (req, res) => {
  try {
    const portfolios = await prisma.portfolio.findMany({
      where: { userId: req.user.id },
      select: { id: true }
    });

    const portfolioIds = portfolios.map(p => p.id);

    const transactions = await prisma.transaction.findMany({
      where: { portfolioId: { in: portfolioIds } },
      orderBy: { executedAt: 'desc' },
      take: 20
    });

    res.json(transactions);
  } catch (error) {
    console.error('[Transactions Error]', error);
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});

// POST /api/portfolios/refresh-history - Refresh historical data
router.post('/refresh-history', async (req, res) => {
  try {
    const portfolios = await prisma.portfolio.findMany({
      where: { userId: req.user.id },
      include: { holdings: true }
    });

    const allHoldings = portfolios.flatMap(p => p.holdings);
    const symbols = [...new Set(allHoldings.map(h => h.symbol))];

    console.log(`[Refresh] Fetching historical data for ${symbols.length} symbols...`);

    for (const symbol of symbols) {
      await stockData.getHistoricalData(symbol, { forceRefresh: true });
    }

    await portfolioSnapshot.generateHistoricalSnapshots(req.user.id, 365);

    res.json({ success: true, message: `Refreshed data for ${symbols.length} symbols` });
  } catch (error) {
    console.error('[Refresh Error]', error);
    res.status(500).json({ error: 'Failed to refresh historical data' });
  }
});

// GET /api/portfolios/performance - Get portfolio performance history
router.get('/performance', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 365;
    const period = req.query.period || 'ALL';

    const periodDays = {
      '1D': 1,
      '1W': 7,
      '1M': 30,
      'YTD': Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / (1000 * 60 * 60 * 24)),
      'ALL': 365
    };

    const requestedDays = periodDays[period] || days;

    let snapshots = await portfolioSnapshot.getPerformanceHistory(req.user.id, requestedDays);

    if (snapshots.length < 30) {
      const portfolios = await prisma.portfolio.findMany({
        where: { userId: req.user.id },
        include: { holdings: true }
      });

      const allHoldings = portfolios.flatMap(p => p.holdings);
      const symbols = [...new Set(allHoldings.map(h => h.symbol))];

      for (const symbol of symbols) {
        const hasData = await stockData.hasRecentData(symbol);
        if (!hasData) {
          console.log(`[Performance] Fetching historical data for ${symbol}...`);
          await stockData.getHistoricalData(symbol, { forceRefresh: true });
        }
      }

      await portfolioSnapshot.generateHistoricalSnapshots(req.user.id, 365);
      snapshots = await portfolioSnapshot.getPerformanceHistory(req.user.id, requestedDays);
    }

    await portfolioSnapshot.recordDailySnapshot(req.user.id);

    const performance = snapshots.map(s => ({
      date: s.date,
      value: s.totalValue,
      cost: s.totalCost,
      dayGain: s.dayGain,
      totalGain: s.totalValue - s.totalCost,
      totalGainPercent: s.totalCost > 0 ? ((s.totalValue - s.totalCost) / s.totalCost) * 100 : 0
    }));

    res.json(performance);
  } catch (error) {
    console.error('[Performance History Error]', error);
    res.status(500).json({ error: 'Failed to get performance history' });
  }
});

// GET /api/portfolios/:id - Get single portfolio (MUST be after specific routes)
router.get('/:id', async (req, res) => {
  try {
    const portfolio = await prisma.portfolio.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        holdings: true,
        transactions: {
          orderBy: { executedAt: 'desc' },
          take: 50
        }
      }
    });

    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    res.json(portfolio);
  } catch (error) {
    console.error('[Portfolio Get Error]', error);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

// POST /api/portfolios/:id/holdings - Add holding
router.post('/:id/holdings', [
  body('symbol').trim().toUpperCase().notEmpty(),
  body('shares').isFloat({ min: 0.0001 }),
  body('avgCostBasis').isFloat({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Verify portfolio ownership
    const portfolio = await prisma.portfolio.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    const { symbol, shares, avgCostBasis, sector, notes } = req.body;

    // Check if holding exists
    const existing = await prisma.holding.findUnique({
      where: {
        portfolioId_symbol: {
          portfolioId: req.params.id,
          symbol
        }
      }
    });

    let holding;
    if (existing) {
      // Update existing holding (average cost basis)
      const totalShares = existing.shares + shares;
      const totalCost = (existing.shares * existing.avgCostBasis) + (shares * avgCostBasis);
      const newAvgCost = totalCost / totalShares;

      holding = await prisma.holding.update({
        where: { id: existing.id },
        data: {
          shares: totalShares,
          avgCostBasis: newAvgCost,
          sector: sector || existing.sector,
          notes: notes || existing.notes
        }
      });
    } else {
      // Create new holding
      holding = await prisma.holding.create({
        data: {
          portfolioId: req.params.id,
          symbol,
          shares,
          avgCostBasis,
          sector,
          notes
        }
      });
    }

    // Create transaction
    await prisma.transaction.create({
      data: {
        portfolioId: req.params.id,
        symbol,
        type: 'buy',
        shares,
        price: avgCostBasis,
        amount: shares * avgCostBasis,
        executedAt: new Date()
      }
    });

    // Fetch historical data immediately for new symbol
    try {
      const hasData = await stockData.hasRecentData(symbol);
      if (!hasData) {
        console.log(`[Holdings] Fetching historical data for ${symbol}...`);
        await stockData.getHistoricalData(symbol, { forceRefresh: true });
      }
      // Generate portfolio snapshots
      await portfolioSnapshot.generateHistoricalSnapshots(req.user.id, 365);
      console.log(`[Holdings] Historical data ready for ${symbol}`);
    } catch (err) {
      console.log(`[Holdings] Historical fetch for ${symbol}:`, err.message);
    }

    res.status(201).json(holding);
  } catch (error) {
    console.error('[Add Holding Error]', error);
    res.status(500).json({ error: 'Failed to add holding' });
  }
});

// DELETE /api/portfolios/:id/holdings/:holdingId
router.delete('/:id/holdings/:holdingId', async (req, res) => {
  try {
    // Verify portfolio ownership
    const portfolio = await prisma.portfolio.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    await prisma.holding.delete({
      where: { id: req.params.holdingId }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[Delete Holding Error]', error);
    res.status(500).json({ error: 'Failed to delete holding' });
  }
});

// GET /api/portfolios/:id/analytics - Get portfolio analytics with live prices
router.get('/:id/analytics', async (req, res) => {
  try {
    const portfolio = await prisma.portfolio.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { holdings: true }
    });

    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    // If no holdings, return empty analytics
    if (portfolio.holdings.length === 0) {
      return res.json({
        totalValue: 0,
        totalCost: 0,
        dayGain: 0,
        dayGainPercent: 0,
        totalReturn: 0,
        totalReturnPercent: 0,
        holdings: []
      });
    }

    // Get live prices using stock data service
    const symbols = portfolio.holdings.map(h => h.symbol);
    const quotes = await stockData.getQuotes(symbols);

    // Calculate analytics
    let totalValue = 0;
    let totalCost = 0;
    let totalDayGain = 0;

    const holdingsWithPrices = portfolio.holdings.map(h => {
      const quote = quotes[h.symbol] || { price: h.avgCostBasis, previousClose: h.avgCostBasis, changeAmount: 0, changePercent: 0, name: h.symbol };
      const currentValue = h.shares * quote.price;
      const costBasis = h.shares * h.avgCostBasis;
      const dayGain = h.shares * (quote.changeAmount || 0);
      const totalGain = currentValue - costBasis;

      totalValue += currentValue;
      totalCost += costBasis;
      totalDayGain += dayGain;

      return {
        id: h.id,
        symbol: h.symbol,
        name: quote.name,
        shares: h.shares,
        avgCostBasis: h.avgCostBasis,
        currentPrice: quote.price,
        previousClose: quote.previousClose,
        currentValue,
        costBasis,
        dayGain,
        dayGainPercent: quote.changePercent || 0,
        totalGain,
        totalGainPercent: costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0
      };
    });

    // Sort by value descending
    holdingsWithPrices.sort((a, b) => b.currentValue - a.currentValue);

    res.json({
      totalValue,
      totalCost,
      dayGain: totalDayGain,
      dayGainPercent: totalCost > 0 ? (totalDayGain / totalCost) * 100 : 0,
      totalReturn: totalValue - totalCost,
      totalReturnPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
      holdings: holdingsWithPrices
    });
  } catch (error) {
    console.error('[Portfolio Analytics Error]', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

module.exports = router;
