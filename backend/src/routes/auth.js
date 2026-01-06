const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { generateToken, authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Validation rules
const registerValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('fullName').optional().trim(),
  body('firstName').optional().trim(),
  body('lastName').optional().trim()
];

const loginValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
];

// POST /api/auth/register
router.post('/register', registerValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, fullName, firstName: providedFirst, lastName: providedLast } = req.body;

    // Handle fullName field - split into firstName and lastName
    let firstName = providedFirst;
    let lastName = providedLast;

    if (fullName && !firstName && !lastName) {
      const nameParts = fullName.trim().split(/\s+/);
      firstName = nameParts[0] || '';
      lastName = nameParts.slice(1).join(' ') || '';
    }

    // Check if user exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        portfolios: {
          create: {
            name: 'My Portfolio',
            description: 'Default portfolio',
            isDefault: true
          }
        }
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true
      }
    });

    // Generate token
    const token = generateToken(user);

    res.status(201).json({
      user,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
  } catch (error) {
    console.error('[Register Error]', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', loginValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        passwordHash: true,
        isActive: true
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // Generate token
    const token = generateToken(user);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      },
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
  } catch (error) {
    console.error('[Login Error]', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', [body('email').isEmail().normalizeEmail()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    const { email } = req.body;

    // Check if user exists (but always return success for security)
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      // TODO: Generate reset token and send email
      // For now, just log it
      console.log(`[Password Reset] Request for: ${email}`);
    }

    // Always return success to prevent email enumeration
    res.json({ success: true, message: 'If an account exists, a reset link will be sent.' });
  } catch (error) {
    console.error('[Forgot Password Error]', error);
    res.status(500).json({ error: 'Request failed' });
  }
});

module.exports = router;
