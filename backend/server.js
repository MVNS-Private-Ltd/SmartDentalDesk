// ─────────────────────────────────────────────────────────────────────────────
//  Smart Dental Desk — Express Server Entry Point
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const morgan   = require('morgan');

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

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🦷 SmartDentalDesk API running on http://localhost:${PORT}`);
  console.log(`   Health check → http://localhost:${PORT}/api/health\n`);
});
