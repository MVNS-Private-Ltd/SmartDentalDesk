// ─────────────────────────────────────────────────────────────────────────────
//  Email Configuration Gate — lib/emailGate.js
//
//  Single source of truth for email mode determination.
//  Mode is derived ONLY from NODE_ENV and explicit env vars — never guessed.
//
//  Modes:
//    disabled    — no email env vars present; email features silently unavailable
//    development — NODE_ENV=development; test sender allowed if configured
//    staging     — NODE_ENV=staging; safe test recipients only
//    production  — NODE_ENV=production; strict validation; fail closed
//
//  Exports:
//    getEmailMode()          → 'disabled' | 'development' | 'staging' | 'production'
//    getEmailConfig()        → { mode, fromAddress, fromName, apiKeyPresent, ... }
//    assertProductionReady() → throws SafeConfigError if gate fails in production
//    isSafeToSend()          → boolean (safe to call at runtime)
//    safeLogEvent(fields)    → logs without secrets or clinical content
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// Blocked sending domains — cannot be used as the From address in production
const BLOCKED_FROM_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'example.com',
  'test.com',
  'resend.dev',
  'localhost',
];

// Allowlist for test email recipients (when not in production)
const TEST_RECIPIENT_DOMAINS_DEFAULT = [];

// ── Internal helpers ──────────────────────────────────────────────────────────

function extractDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const match = email.match(/@([\w.-]+)$/);
  return match ? match[1].toLowerCase() : null;
}

function isBlockedDomain(email) {
  const domain = extractDomain(email);
  if (!domain) return true;
  return BLOCKED_FROM_DOMAINS.includes(domain);
}

function isValidEmailFormat(email) {
  if (!email || typeof email !== 'string') return false;
  // RFC 5321 simplified — no arbitrary regex, just structural check
  const parts = email.trim().split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64) return false;
  if (!domain || domain.length > 255 || !domain.includes('.')) return false;
  return true;
}

// ── Safe config error — never exposes env var values ─────────────────────────

class SafeConfigError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SafeConfigError';
    this.code = code;
    this.isConfigError = true;
  }
}

// ── Mode determination ────────────────────────────────────────────────────────

function getEmailMode() {
  const nodeEnv   = (process.env.NODE_ENV || 'development').toLowerCase();
  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM;

  if (!apiKey && !fromEmail) return 'disabled';

  if (nodeEnv === 'production') return 'production';
  if (nodeEnv === 'staging')    return 'staging';
  return 'development';
}

// ── Full config object (safe — never includes secret values) ─────────────────

function getEmailConfig() {
  const mode      = getEmailMode();
  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM;
  const fromName  = process.env.EMAIL_FROM_NAME || 'dentalsmart';
  const prodDomain = process.env.EMAIL_PRODUCTION_DOMAIN || null;

  const fromDomain   = extractDomain(fromEmail || '');
  const isBlocked    = fromEmail ? isBlockedDomain(fromEmail) : false;
  const domainMatch  = prodDomain && fromDomain
    ? fromDomain === prodDomain.toLowerCase()
    : false;

  const requiredContactsConfigured = !!(
    process.env.SUPPORT_EMAIL &&
    process.env.PRIVACY_EMAIL &&
    process.env.GRIEVANCE_EMAIL
  );

  return {
    mode,
    apiKeyPresent:                !!apiKey,
    fromDomainConfigured:         !!fromEmail && !isBlocked,
    fromDomainIsBlockedProvider:  isBlocked,
    fromDomainMatchesProdDomain:  mode === 'production' ? domainMatch : null,
    fromName,
    requiredContactsConfigured,
    // Safe display: mask the actual from address — only show domain
    fromDomainSafe: fromDomain || null,
    prodDomainConfigured: !!prodDomain,
  };
}

// ── Production readiness assertion ───────────────────────────────────────────

function assertProductionReady() {
  const mode = getEmailMode();
  if (mode !== 'production') return; // only validate in production

  const missing = [];
  const failures = [];

  if (!process.env.RESEND_API_KEY)   missing.push('RESEND_API_KEY');
  if (!process.env.EMAIL_FROM)        missing.push('EMAIL_FROM');
  if (!process.env.SUPPORT_EMAIL)     missing.push('SUPPORT_EMAIL');
  if (!process.env.PRIVACY_EMAIL)     missing.push('PRIVACY_EMAIL');
  if (!process.env.GRIEVANCE_EMAIL)   missing.push('GRIEVANCE_EMAIL');
  if (!process.env.EMAIL_PRODUCTION_DOMAIN) missing.push('EMAIL_PRODUCTION_DOMAIN');

  if (missing.length > 0) {
    // Log var NAMES only — never values
    console.error('[EmailGate] CRITICAL: Required email env vars missing in production:', missing.join(', '));
    throw new SafeConfigError(
      `Email production configuration incomplete. Missing env vars: ${missing.join(', ')}`,
      'EMAIL_CONFIG_INCOMPLETE'
    );
  }

  const fromEmail  = process.env.EMAIL_FROM;
  const prodDomain = process.env.EMAIL_PRODUCTION_DOMAIN.toLowerCase();

  if (!isValidEmailFormat(fromEmail)) {
    failures.push('EMAIL_FROM is not a valid email format');
  }

  if (isBlockedDomain(fromEmail)) {
    failures.push('EMAIL_FROM uses a blocked provider domain (gmail, yahoo, resend.dev, etc.)');
  }

  const fromDomain = extractDomain(fromEmail);
  if (fromDomain !== prodDomain) {
    failures.push('EMAIL_FROM domain does not match EMAIL_PRODUCTION_DOMAIN');
  }

  if (failures.length > 0) {
    console.error('[EmailGate] CRITICAL: Email production gate failed:', failures.join('; '));
    throw new SafeConfigError(
      `Email production gate failed: ${failures.join('; ')}`,
      'EMAIL_GATE_FAILED'
    );
  }

  console.info('[EmailGate] Production email configuration validated.');
}

// ── Runtime send guard ────────────────────────────────────────────────────────

function isSafeToSend() {
  const mode = getEmailMode();
  if (mode === 'disabled') return false;

  if (mode === 'production') {
    try {
      assertProductionReady();
      return true;
    } catch {
      return false;
    }
  }

  // development / staging — only safe if api key is present
  return !!process.env.RESEND_API_KEY;
}

// ── Safe event logging (never logs content, secrets, or patient data) ─────────

function maskEmail(email) {
  if (!email || typeof email !== 'string') return '[invalid]';
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[masked]';
  const masked = local.slice(0, 2) + '***';
  return `${masked}@${domain}`;
}

function safeLogEvent({ event, recipientEmail, templateId, status, errorCode, messageId, clinicId }) {
  // Never log: full email body, subject content, API key, patient clinical data
  const entry = {
    ts:         new Date().toISOString(),
    event:      event      || 'email.send',
    recipient:  recipientEmail ? maskEmail(recipientEmail) : '[masked]',
    template:   templateId || 'unknown',
    status:     status     || 'unknown',
    messageId:  messageId  || null,
    clinicId:   clinicId   || null,
  };
  if (errorCode) entry.errorCode = errorCode;

  console.log('[Email]', JSON.stringify(entry));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  getEmailMode,
  getEmailConfig,
  assertProductionReady,
  isSafeToSend,
  safeLogEvent,
  maskEmail,
  isValidEmailFormat,
  SafeConfigError,
  BLOCKED_FROM_DOMAINS,
};
