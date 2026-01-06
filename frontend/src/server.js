require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'http://localhost:4000';

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middleware
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// API helper
async function api(method, endpoint, token = null, data = null) {
  try {
    const config = {
      method,
      url: `${API_URL}${endpoint}`,
      headers: {}
    };

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (data) {
      config.data = data;
      config.headers['Content-Type'] = 'application/json';
    }

    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error || error.message
    };
  }
}

// Auth middleware for protected routes
function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.redirect('/login');
  }
  req.token = token;
  next();
}

// Proxy API calls from frontend to backend
app.use('/api', async (req, res) => {
  try {
    const token = req.cookies.token;
    const response = await axios({
      method: req.method,
      url: `${API_URL}${req.originalUrl}`,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` })
      },
      data: req.body
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(
      error.response?.data || { error: 'API error' }
    );
  }
});

// ============================================
// PUBLIC ROUTES
// ============================================

app.get('/login', (req, res) => {
  if (req.cookies.token) {
    return res.redirect('/dashboard');
  }
  const success = req.query.registered === 'true' ? 'Account created successfully! Please sign in.' : null;
  res.render('pages/login', { error: null, success });
});

app.post('/login', async (req, res) => {
  const { email, password, remember } = req.body;

  const result = await api('POST', '/api/auth/login', null, { email, password });

  if (result.success) {
    // If remember me is checked, extend cookie to 30 days
    const maxAge = remember ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    res.cookie('token', result.data.token, {
      httpOnly: true,
      maxAge
    });
    return res.redirect('/dashboard');
  }

  res.render('pages/login', { error: result.error, success: null });
});

app.get('/register', (req, res) => {
  if (req.cookies.token) {
    return res.redirect('/dashboard');
  }
  res.render('pages/register', { error: null });
});

app.post('/register', async (req, res) => {
  const { email, password, confirmPassword, fullName } = req.body;

  // Server-side validation
  if (password !== confirmPassword) {
    return res.render('pages/register', { error: 'Passwords do not match' });
  }

  if (password.length < 8) {
    return res.render('pages/register', { error: 'Password must be at least 8 characters' });
  }

  const result = await api('POST', '/api/auth/register', null, {
    email,
    password,
    fullName
  });

  if (result.success) {
    res.cookie('token', result.data.token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return res.redirect('/dashboard');
  }

  res.render('pages/register', { error: result.error });
});

app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

app.get('/forgot-password', (req, res) => {
  res.render('pages/forgot-password', { error: null, success: null });
});

app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const result = await api('POST', '/api/auth/forgot-password', null, { email });

  if (result.success) {
    return res.render('pages/forgot-password', {
      error: null,
      success: 'If an account exists with this email, you will receive a password reset link shortly.'
    });
  }

  res.render('pages/forgot-password', { error: result.error, success: null });
});

// ============================================
// PROTECTED ROUTES
// ============================================

// Middleware to get user info and check onboarding
async function getUserInfo(req, res, next) {
  const result = await api('GET', '/api/auth/me', req.token);
  if (result.success) {
    req.user = result.data.user;
  }
  next();
}

app.get('/', requireAuth, (req, res) => {
  res.redirect('/dashboard');
});

// Onboarding routes
app.get('/onboarding', requireAuth, getUserInfo, async (req, res) => {
  const status = await api('GET', '/api/onboarding/status', req.token);

  // If already completed, redirect to dashboard
  if (status.success && status.data.completed) {
    return res.redirect('/dashboard');
  }

  res.render('pages/onboarding', { user: req.user, error: null });
});

app.post('/onboarding', requireAuth, async (req, res) => {
  const { investmentGoal, riskTolerance, primaryCurrency } = req.body;

  const result = await api('POST', '/api/onboarding/preferences', req.token, {
    investmentGoal,
    riskTolerance,
    primaryCurrency
  });

  if (result.success) {
    return res.redirect('/dashboard');
  }

  const userResult = await api('GET', '/api/auth/me', req.token);
  res.render('pages/onboarding', {
    user: userResult.data?.user || {},
    error: result.error
  });
});

app.get('/onboarding/skip', requireAuth, async (req, res) => {
  await api('POST', '/api/onboarding/skip', req.token);
  res.redirect('/dashboard');
});

app.get('/dashboard', requireAuth, getUserInfo, async (req, res) => {
  // Check if onboarding is completed
  const status = await api('GET', '/api/onboarding/status', req.token);
  if (status.success && !status.data.completed) {
    return res.redirect('/onboarding');
  }

  // Get portfolio analytics, transactions, and performance in parallel
  const [analytics, transactions, performance] = await Promise.all([
    api('GET', '/api/portfolios/summary/all', req.token),
    api('GET', '/api/portfolios/transactions/recent', req.token),
    api('GET', '/api/portfolios/performance?period=ALL', req.token)
  ]);

  console.log('[Dashboard] Analytics:', analytics.success ? 'OK' : 'FAILED: ' + analytics.error);
  console.log('[Dashboard] Transactions:', transactions.success ? transactions.data?.length + ' items' : 'FAILED: ' + transactions.error);
  console.log('[Dashboard] Performance:', performance.success ? performance.data?.length + ' points' : 'FAILED: ' + performance.error);

  // Ensure performance data is passed correctly
  const perfData = performance.success && Array.isArray(performance.data) ? performance.data : [];
  console.log('[Dashboard] Passing', perfData.length, 'performance points to template');

  res.render('pages/dashboard', {
    analytics: analytics.data || {
      totalValue: 0,
      totalCost: 0,
      dayGain: 0,
      dayGainPercent: 0,
      totalReturn: 0,
      totalReturnPercent: 0,
      holdingsCount: 0,
      topHoldings: []
    },
    transactions: transactions.data || [],
    performance: perfData,
    user: req.user
  });
});

app.get('/portfolio/:id', requireAuth, async (req, res) => {
  const portfolio = await api('GET', `/api/portfolios/${req.params.id}`, req.token);

  if (!portfolio.success) {
    return res.redirect('/dashboard');
  }

  res.render('pages/portfolio', {
    portfolio: portfolio.data
  });
});

app.get('/watchlist', requireAuth, async (req, res) => {
  const watchlists = await api('GET', '/api/watchlist', req.token);

  res.render('pages/watchlist', {
    watchlists: watchlists.data || []
  });
});

// Holdings routes
app.get('/holdings', requireAuth, getUserInfo, async (req, res) => {
  const portfolios = await api('GET', '/api/portfolios', req.token);
  const analytics = await api('GET', '/api/portfolios/summary/all', req.token);

  res.render('pages/holdings', {
    portfolios: portfolios.data || [],
    analytics: analytics.data || { holdingsCount: 0, topHoldings: [] },
    user: req.user
  });
});

app.get('/holdings/add', requireAuth, getUserInfo, async (req, res) => {
  const portfolios = await api('GET', '/api/portfolios', req.token);

  res.render('pages/holdings-add', {
    portfolios: portfolios.data || [],
    user: req.user,
    error: null
  });
});

app.post('/holdings/add', requireAuth, async (req, res) => {
  const { portfolioId, symbol, shares, avgCostBasis } = req.body;

  // If no portfolio exists, create default one first
  let targetPortfolioId = portfolioId;
  if (!portfolioId || portfolioId === 'new') {
    const createResult = await api('POST', '/api/portfolios', req.token, {
      name: 'My Portfolio',
      description: 'Default portfolio'
    });
    if (createResult.success) {
      targetPortfolioId = createResult.data.id;
    } else {
      const portfolios = await api('GET', '/api/portfolios', req.token);
      const userResult = await api('GET', '/api/auth/me', req.token);
      return res.render('pages/holdings-add', {
        portfolios: portfolios.data || [],
        user: userResult.data?.user || {},
        error: 'Failed to create portfolio'
      });
    }
  }

  const result = await api('POST', `/api/portfolios/${targetPortfolioId}/holdings`, req.token, {
    symbol: symbol.toUpperCase(),
    shares: parseFloat(shares),
    avgCostBasis: parseFloat(avgCostBasis)
  });

  if (result.success) {
    return res.redirect('/holdings');
  }

  const portfolios = await api('GET', '/api/portfolios', req.token);
  const userResult = await api('GET', '/api/auth/me', req.token);
  res.render('pages/holdings-add', {
    portfolios: portfolios.data || [],
    user: userResult.data?.user || {},
    error: result.error
  });
});

app.get('/settings', requireAuth, getUserInfo, async (req, res) => {
  res.render('pages/settings', { user: req.user });
});

// ============================================
// ERROR HANDLERS
// ============================================

app.use((req, res) => {
  res.status(404).render('pages/404');
});

app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).render('pages/error', { error: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     WealthPilot Pro - Frontend             ║
║     Running on port ${PORT}                    ║
║     API: ${API_URL}
╚════════════════════════════════════════════╝
  `);
});
