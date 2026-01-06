const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

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

// GET /api/portfolios/:id - Get single portfolio
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

module.exports = router;
