// ─────────────────────────────────────────────────────────────────────────────
//  Smart Dental Desk — Express Server Entry Point
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const morgan   = require('morgan');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
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
const emailRoutes       = require('./routes/email');
const superAdminRoutes  = require('./routes/superAdmin');
const billingRoutes     = require('./routes/billing');
const creditsRoutes     = require('./routes/credits');
const webhookRoutes     = require('./routes/webhooks');
const cronRoutes        = require('./routes/cron');
const crmRoutes         = require('./routes/crm');
const messageRoutes     = require('./routes/messages');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Startup Safety Checks ─────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';
if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.includes('REPLACE')) {
  if (isProd) {
    console.error('CRITICAL: Missing valid RAZORPAY_KEY_ID in production.');
    process.exit(1);
  } else {
    console.warn('WARNING: Running without valid RAZORPAY_KEY_ID (test mode or disabled payments).');
  }
} else if (process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) {
  if (isProd) {
    console.error('CRITICAL: Test Razorpay key found in production environment.');
    process.exit(1);
  } else {
    console.info('INFO: Running in Payment Test Mode (rzp_test_).');
  }
}
if (!process.env.RAZORPAY_WEBHOOK_SECRET && isProd) {
  console.error('CRITICAL: Missing RAZORPAY_WEBHOOK_SECRET in production.');
  process.exit(1);
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 auth requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests from this IP, please try again after 15 minutes' }
});

app.use('/api', globalLimiter);

app.use(cors({
  origin : process.env.FRONTEND_ORIGIN || '*',
  methods : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Webhook must use raw body — mount BEFORE express.json()
app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '10mb' }), webhookRoutes);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  let dbStatus = 'ok';
  try {
    const supabase = require('./lib/supabase');
    const { error } = await supabase.from('clinics').select('id').limit(1);
    if (error) throw error;
  } catch (err) {
    dbStatus = 'error';
  }

  const { getEmailMode, getEmailConfig } = require('./lib/emailGate');
  const emailCfg = getEmailConfig();

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    version: '1.0.0',
    database_connectivity: dbStatus,
    email_configuration_status: {
      mode: getEmailMode(),
      api_key_present: emailCfg.apiKeyPresent,
      from_domain_configured: emailCfg.fromDomainConfigured
    },
    payment_webhook_configuration_status: !!process.env.RAZORPAY_WEBHOOK_SECRET ? 'configured' : 'missing',
    timestamp: new Date().toISOString()
  });
});

// ── Public legal config (non-secret, served from env vars) ───────────────────
app.get('/api/config', (_req, res) => {
  // None of these values are secrets — they are legal contact/address details.
  // They live in env vars so they are never hardcoded in committed files.
  res.json({
    LEGAL_BUSINESS_NAME    : process.env.LEGAL_BUSINESS_NAME    || '',
    REGISTERED_ADDRESS     : process.env.REGISTERED_ADDRESS     || '',
    SUPPORT_EMAIL          : process.env.SUPPORT_EMAIL          || '',
    PRIVACY_EMAIL          : process.env.PRIVACY_EMAIL          || '',
    GRIEVANCE_EMAIL        : process.env.GRIEVANCE_EMAIL        || '',
    EFFECTIVE_DATE         : process.env.EFFECTIVE_DATE         || '',
    GOVERNING_LAW          : process.env.GOVERNING_LAW          || '',
    PAYMENT_PROVIDER_DETAILS: 'Razorpay',
    DATA_SUBPROCESSORS     : process.env.DATA_SUBPROCESSORS     || 'Supabase, Render, OpenRouter'
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',         authLimiter, authRoutes);
app.use('/api/patients',     patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/treatments',   treatmentRoutes);
app.use('/api/invoices',     invoiceRoutes);
app.use('/api/staff',        staffRoutes);
app.use('/api/dashboard',    dashboardRoutes);
app.use('/api/clinics',      clinicRoutes);
app.use('/api/public',       publicRoutes);
app.use('/api/ai',           aiRoutes);
app.use('/api/email',        emailRoutes);
app.use('/api/super-admin',  superAdminRoutes);
app.use('/api/billing',      billingRoutes);
app.use('/api/credits',      creditsRoutes);
app.use('/api/cron',         cronRoutes);
app.use('/api/crm',          crmRoutes);
app.use('/api/messages',     messageRoutes);

// Internal routes (super admin only)
const internalRoutes = require('./routes/internal');
app.use('/internal',         internalRoutes);

// ── 404 handler (API routes only) ────────────────────────────────────────────
// NOTE: The Express backend on Render is API-only. Frontend HTML is served by Vercel.
// Static error pages (401.html, 403.html etc.) with correct status codes are
// configured in vercel.json on the Vercel side.
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
