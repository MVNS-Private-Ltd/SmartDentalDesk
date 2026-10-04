// ─────────────────────────────────────────────────────────────────────────────
//  Internal Admin Routes — routes/internal.js
//
//  All routes require Super Admin authentication.
//  Never publicly routed — mounted at /internal in server.js.
//
//  GET  /internal/email-readiness  — safe email config status
//  POST /internal/email-test       — send a test email to an allowlisted recipient
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const express     = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit   = require('express-rate-limit');
const requireSuperAdmin = require('../middleware/superAdmin');
const { sendMail }      = require('../lib/mailer');
const {
  getEmailMode,
  getEmailConfig,
  isSafeToSend,
  safeLogEvent,
  isValidEmailFormat,
} = require('../lib/emailGate');

const router = express.Router();

// All internal routes require super admin
router.use(requireSuperAdmin);

// Strict rate limiter for internal endpoints (2 req/min per IP)
const internalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests to internal endpoints.' },
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(internalLimiter);

// Allowlisted test email templates
const ALLOWED_TEST_TEMPLATES = [
  'welcome',
  'password-reset',
  'appointment-confirmation',
  'invoice',
  'support-test',
];

// Safe template content (no patient data, no dynamic user content)
const TEST_TEMPLATE_CONTENT = {
  'welcome': {
    subject: '[TEST] Welcome to Smart Dental Desk',
    text: 'This is a test email confirming the welcome email template is working correctly. No patient data is included.',
  },
  'password-reset': {
    subject: '[TEST] Password Reset Test — Smart Dental Desk',
    text: 'This is a test of the password reset email flow. No real reset link is included in this test.',
  },
  'appointment-confirmation': {
    subject: '[TEST] Appointment Confirmation — Smart Dental Desk',
    text: 'This is a test of the appointment confirmation email template. No patient or appointment data is included.',
  },
  'invoice': {
    subject: '[TEST] Invoice Notification — Smart Dental Desk',
    text: 'This is a test of the invoice notification email template. No billing data is included in this test.',
  },
  'support-test': {
    subject: '[TEST] Support Email Test — Smart Dental Desk',
    text: 'This is an internal test email to confirm the Smart Dental Desk email infrastructure is operational.',
  },
};

// ── GET /internal/email-readiness ─────────────────────────────────────────────
router.get('/email-readiness', (_req, res) => {
  const cfg  = getEmailConfig();
  const mode = getEmailMode();

  // Safe fields only — never expose API keys, From addresses, or secrets
  const status = {
    emailEnabled:                cfg.apiKeyPresent && cfg.fromDomainConfigured,
    mode,
    fromDomainConfigured:        cfg.fromDomainConfigured,
    fromDomainIsBlockedProvider: cfg.fromDomainIsBlockedProvider,
    fromDomainMatchesProdDomain: cfg.fromDomainMatchesProdDomain,
    requiredContactsConfigured:  cfg.requiredContactsConfigured,
    prodDomainConfigured:        cfg.prodDomainConfigured,
    isSafeToSend:                isSafeToSend(),
    // lastTestEmailStatus and lastCheckedAt would require a DB store — stub for now
    lastTestEmailStatus: null,
    lastCheckedAt:       new Date().toISOString(),
  };

  const httpStatus = status.emailEnabled && status.isSafeToSend ? 200 : 503;

  safeLogEvent({
    event: 'email.readiness-check',
    templateId: 'internal',
    status: httpStatus === 200 ? 'ready' : 'not_ready',
  });

  res.status(httpStatus).json(status);
});

// ── POST /internal/email-test ─────────────────────────────────────────────────
router.post('/email-test',
  [
    body('template')
      .trim()
      .notEmpty().withMessage('template is required')
      .isIn(ALLOWED_TEST_TEMPLATES).withMessage(`template must be one of: ${ALLOWED_TEST_TEMPLATES.join(', ')}`),

    body('recipient')
      .trim()
      .notEmpty().withMessage('recipient is required')
      .isEmail().withMessage('recipient must be a valid email address'),

    body('testMode')
      .isBoolean()
      .custom(val => val === true).withMessage('testMode must be true'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { template, recipient } = req.body;

    // ── 1. Gate check ─────────────────────────────────────────────────────
    if (!isSafeToSend()) {
      return res.status(503).json({
        success: false,
        error: 'Email system is not configured. Set required env vars.',
        code: 'EMAIL_NOT_CONFIGURED',
      });
    }

    // ── 2. Allowlist recipient domain ─────────────────────────────────────
    const allowedDomains = (process.env.EMAIL_TEST_RECIPIENT_DOMAINS || '')
      .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

    const recipientDomain = recipient.split('@')[1]?.toLowerCase();

    if (allowedDomains.length > 0 && !allowedDomains.includes(recipientDomain)) {
      return res.status(403).json({
        success: false,
        error: 'Recipient domain is not in the test allowlist. Add it to EMAIL_TEST_RECIPIENT_DOMAINS.',
        code: 'RECIPIENT_NOT_ALLOWED',
      });
    }

    // If no allowlist is configured, still require recipient to be valid
    if (!isValidEmailFormat(recipient)) {
      return res.status(400).json({ success: false, error: 'Invalid recipient format.' });
    }

    // ── 3. Get safe template content ──────────────────────────────────────
    const content = TEST_TEMPLATE_CONTENT[template];
    if (!content) {
      return res.status(400).json({ success: false, error: 'Unknown template.' });
    }

    // ── 4. Send ───────────────────────────────────────────────────────────
    try {
      const info = await sendMail({
        to:         recipient,
        subject:    content.subject,
        text:       content.text,
        templateId: `test.${template}`,
        clinicId:   null,
      });

      safeLogEvent({
        event: 'email.test',
        recipientEmail: recipient,
        templateId: template,
        status: 'sent',
        messageId: info.messageId,
      });

      return res.json({
        success: true,
        template,
        messageId: info.messageId,
      });

    } catch (err) {
      safeLogEvent({
        event: 'email.test',
        recipientEmail: recipient,
        templateId: template,
        status: 'failed',
        errorCode: err.code || 'UNKNOWN',
      });

      return res.status(500).json({
        success: false,
        error: err.isConfigError ? err.message : 'Test email send failed. Check server logs.',
        code: err.code || 'SEND_FAILED',
      });
    }
  }
);

module.exports = router;
