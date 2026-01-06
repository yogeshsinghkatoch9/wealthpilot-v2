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
  res.render('pages/login', { error: null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const result = await api('POST', '/api/auth/login', null, { email, password });

  if (result.success) {
    res.cookie('token', result.data.token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    return res.redirect('/dashboard');
  }

  res.render('pages/login', { error: result.error });
});

app.get('/register', (req, res) => {
  if (req.cookies.token) {
    return res.redirect('/dashboard');
  }
  res.render('pages/register', { error: null });
});

app.post('/register', async (req, res) => {
  const { email, password, firstName, lastName } = req.body;

  const result = await api('POST', '/api/auth/register', null, {
    email,
    password,
    firstName,
    lastName
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

// ============================================
// PROTECTED ROUTES
// ============================================

app.get('/', requireAuth, (req, res) => {
  res.redirect('/dashboard');
});

app.get('/dashboard', requireAuth, async (req, res) => {
  const portfolios = await api('GET', '/api/portfolios', req.token);
  const indices = await api('GET', '/api/market/indices');

  res.render('pages/dashboard', {
    portfolios: portfolios.data || [],
    indices: indices.data || [],
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
