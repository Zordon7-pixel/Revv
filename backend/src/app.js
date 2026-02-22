require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Seed demo data on first run (safe to call every startup — skips if already seeded)
try { require('./db/seed').runSeed(); } catch (e) { console.error('Seed error:', e.message); }

const app = express();
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/ros', require('./routes/ros'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/market',   require('./routes/market'));
app.use('/api/portal',   require('./routes/portal'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/parts',    require('./routes/parts'));
app.use('/api/timeclock', require('./routes/timeclock'));
app.use('/api/schedule',  require('./routes/schedule'));
app.use('/api/tracking',  require('./routes/tracking'));
app.use('/api/sms', require('./routes/sms'));

// Serve frontend build
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔧 REVV running on http://localhost:${PORT}`);
  console.log(`   LAN: http://192.168.1.52:${PORT}`);
});
