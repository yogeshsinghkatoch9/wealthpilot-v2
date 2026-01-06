const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication
router.use(authenticate);

// GET /api/watchlist - List all watchlists
router.get('/', async (req, res) => {
  try {
    const watchlists = await prisma.watchlist.findMany({
      where: { userId: req.user.id },
      include: {
        items: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(watchlists);
  } catch (error) {
    console.error('[Watchlist List Error]', error);
    res.status(500).json({ error: 'Failed to fetch watchlists' });
  }
});

// POST /api/watchlist - Create watchlist
router.post('/', [
  body('name').trim().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description } = req.body;

    const watchlist = await prisma.watchlist.create({
      data: {
        userId: req.user.id,
        name,
        description
      }
    });

    res.status(201).json(watchlist);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Watchlist name already exists' });
    }
    console.error('[Watchlist Create Error]', error);
    res.status(500).json({ error: 'Failed to create watchlist' });
  }
});

// POST /api/watchlist/:id/items - Add item to watchlist
router.post('/:id/items', [
  body('symbol').trim().toUpperCase().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Verify ownership
    const watchlist = await prisma.watchlist.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!watchlist) {
      return res.status(404).json({ error: 'Watchlist not found' });
    }

    const { symbol, targetPrice, notes } = req.body;

    const item = await prisma.watchlistItem.create({
      data: {
        watchlistId: req.params.id,
        symbol,
        targetPrice,
        notes
      }
    });

    res.status(201).json(item);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Symbol already in watchlist' });
    }
    console.error('[Add Watchlist Item Error]', error);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// DELETE /api/watchlist/:id/items/:itemId
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    // Verify ownership
    const watchlist = await prisma.watchlist.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!watchlist) {
      return res.status(404).json({ error: 'Watchlist not found' });
    }

    await prisma.watchlistItem.delete({
      where: { id: req.params.itemId }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[Delete Watchlist Item Error]', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

module.exports = router;
