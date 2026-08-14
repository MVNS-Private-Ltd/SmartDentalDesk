// ─────────────────────────────────────────────────────────────────────────────
//  Smart Dental Desk — Express Server Entry Point
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const morgan   = require('morgan');
const https    = require('https');
const http     = require('http');

// Route handlers
const authRoutes        = require('./routes/auth');
const patientRoutes     = require('./routes/patients');
const appointmentRoutes = require('./routes/appointments');
const treatmentRoutes   = require('./routes/treatments');
const invoiceRoutes     = require('./routes/invoices');
const staffRoutes       = require('./routes/staff');
const dashboardRoutes   = require('./routes/dashboard');
const clinicRoutes      = require('./routes/clinics');
const publicRoutes      = require('./routes/public');
const aiRoutes          = require('./routes/ai');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin : process.env.FRONTEND_ORIGIN || '*',
  methods : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status  : 'ok',
    service : 'SmartDentalDesk API',
    version : '1.0.0',
    time    : new Date().toISOString()
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/patients',     patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/treatments',   treatmentRoutes);
app.use('/api/invoices',     invoiceRoutes);
app.use('/api/staff',        staffRoutes);
app.use('/api/dashboard',    dashboardRoutes);
app.use('/api/clinics',      clinicRoutes);
app.use('/api/public',       publicRoutes);
app.use('/api/ai',           aiRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message || err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error  : err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ── Keep-alive for Render free tier ─────────────────────────────────────────
// Render spins down free services after 15 min of inactivity.
// We self-ping /api/health every 14 min to prevent that.
function startKeepAlive() {
  const rawUrl = process.env.RENDER_EXTERNAL_URL;
  if (!rawUrl) {
    console.log('   [keep-alive] RENDER_EXTERNAL_URL not set — skipping (local dev mode).');
    return;
  }

  const pingUrl = rawUrl.replace(/\/$/, '') + '/api/health';
  const client  = pingUrl.startsWith('https') ? https : http;
  const INTERVAL_MS = 14 * 60 * 1000; // 14 minutes

  setInterval(() => {
    client.get(pingUrl, (res) => {
      console.log(`[keep-alive] Pinged ${pingUrl} → ${res.statusCode}`);
      res.resume(); // drain response to free memory
    }).on('error', (err) => {
      console.error(`[keep-alive] Ping failed: ${err.message}`);
    });
  }, INTERVAL_MS);

  console.log(`   [keep-alive] Self-ping active → ${pingUrl} every 14 min`);
}

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🦷 SmartDentalDesk API running on http://localhost:${PORT}`);
  console.log(`   Health check → http://localhost:${PORT}/api/health\n`);
  startKeepAlive();
});
