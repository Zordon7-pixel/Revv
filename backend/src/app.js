require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const notificationsRouter = require('./routes/notifications');

// Refuse to start without JWT_SECRET
if (!process.env.JWT_SECRET) {
  console.error('[SECURITY] JWT_SECRET env var not set. Refusing to start.');
  process.exit(1);
}

const app = express();

// CORS — restrict to known origin in production
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:4000', 'http://localhost:4001', 'http://localhost:4002',
     'http://localhost:5173', 'http://100.102.219.60:4000', 'http://100.102.219.60:4001', 'http://100.102.219.60:4002',
     'https://revv-production-ffa9.up.railway.app'];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// Rate limiting — auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// API Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/ros', require('./routes/ros'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/market',   require('./routes/market'));
app.use('/api/portal',   require('./routes/portal'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/parts',    require('./routes/parts'));
app.use('/api/catalog',  require('./routes/catalog'));
app.use('/api/timeclock', require('./routes/timeclock'));
app.use('/api/schedule',  require('./routes/schedule'));
app.use('/api/tracking',  require('./routes/tracking'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/diagnostics', require('./routes/diagnostics'));
app.use('/api/claim-links', require('./routes/claimLinks'));
app.use('/api/claim-link', require('./routes/claimLinks'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/parts-requests', require('./routes/partsRequests'));
app.use('/api/performance', require('./routes/performance'));
app.use('/api/superadmin', require('./routes/superadmin'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/approval', require('./routes/approval'));
app.use('/api/public', require('./routes/public'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/adas', require('./routes/adas'));
app.use('/api/estimate-assistant', require('./routes/estimateAssistant'));
app.use('/api/inspections', require('./routes/inspections'));
app.use('/api/v1', require('./routes/apiV1'));
app.use('/api/notifications', notificationsRouter);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Serve frontend build
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

const PORT = process.env.PORT || 4000;

const { initDb, dbAll } = require('./db');
const { runMonthCarryover } = require('./jobs/monthCarryover');

async function runCarryoverForActiveShops() {
  try {
    const shops = await dbAll('SELECT id FROM shops');
    for (const shop of shops) {
      const marked = await runMonthCarryover(shop.id);
      if (marked > 0) {
        console.log(`[Carryover] Shop ${shop.id}: marked ${marked} repair order(s)`);
      }
    }
  } catch (err) {
    console.error('[Carryover] Startup carryover task failed:', err.message);
  }
}

initDb()
  .then(async () => {
    // Run PostgreSQL migrations (idempotent — safe every startup)
    if (process.env.DATABASE_URL) {
      try {
        const { runMigrations } = require('./db/migrate');
        await runMigrations();
      } catch (e) {
        console.error('[migrate] Migration error:', e.message);
      }
    }

    // Seed demo data on first run (safe to call every startup — skips if already seeded)
    try {
      await require('./db/seed').runSeed();
    } catch (e) {
      console.error('Seed error:', e.message);
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🔧 REVV running on http://localhost:${PORT}`);
      console.log(`   PostgreSQL: ${process.env.DATABASE_URL ? 'connected' : 'local'}`);
      setImmediate(runCarryoverForActiveShops);
    });
  })
  .catch(err => {
    console.error('[DB] Init failed:', err.message);
    process.exit(1);
  });
