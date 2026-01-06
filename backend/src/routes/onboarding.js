const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/onboarding/status
router.get('/status', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        onboardingCompleted: true,
        investmentGoal: true,
        riskTolerance: true,
        primaryCurrency: true
      }
    });

    res.json({
      completed: user.onboardingCompleted,
      preferences: {
        investmentGoal: user.investmentGoal,
        riskTolerance: user.riskTolerance,
        primaryCurrency: user.primaryCurrency
      }
    });
  } catch (error) {
    console.error('[Onboarding Status Error]', error);
    res.status(500).json({ error: 'Failed to get onboarding status' });
  }
});

// POST /api/onboarding/preferences
router.post('/preferences', authenticate, [
  body('investmentGoal').isIn(['growth', 'balanced', 'income']),
  body('riskTolerance').isIn(['conservative', 'moderate', 'aggressive']),
  body('primaryCurrency').isIn(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { investmentGoal, riskTolerance, primaryCurrency } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        investmentGoal,
        riskTolerance,
        primaryCurrency,
        onboardingCompleted: true
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        investmentGoal: true,
        riskTolerance: true,
        primaryCurrency: true,
        onboardingCompleted: true
      }
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error('[Onboarding Save Error]', error);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// POST /api/onboarding/skip
router.post('/skip', authenticate, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { onboardingCompleted: true }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[Onboarding Skip Error]', error);
    res.status(500).json({ error: 'Failed to skip onboarding' });
  }
});

module.exports = router;
