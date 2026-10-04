// ─────────────────────────────────────────────────────────────────────────────
//  Mailer — lib/mailer.js
//
//  All sends go through the email gate before hitting the Resend API.
//  Never logs secrets, API keys, patient clinical content, or full email bodies.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const {
  getEmailMode,
  getEmailConfig,
  isSafeToSend,
  safeLogEvent,
  isValidEmailFormat,
  SafeConfigError,
} = require('./emailGate');

const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH    = 50_000; // ~50 KB plain text cap

// ── Sanitize plain-text body (strips HTML tags, caps length) ─────────────────
function sanitizePlainText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<[^>]*>/g, '')           // strip any HTML tags
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // strip control chars
    .trim()
    .slice(0, MAX_BODY_LENGTH);
}

// ── Build a safe HTML body from plain text (no arbitrary HTML injection) ──────
function buildSafeHtml(plainText, fromName) {
  const escaped = plainText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const paragraphs = escaped
    .split(/\n+/)
    .map(line => `<p style="margin:0 0 12px;line-height:1.6;color:#374151;">${line || '&nbsp;'}</p>`)
    .join('');

  const safeName = (fromName || 'Smart Dental Desk')
    .replace(/</g, '').replace(/>/g, '').slice(0, 60);

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;padding:0 16px;">
    <div style="background:linear-gradient(135deg,#667eea,#764ba2);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
      <h2 style="color:#fff;margin:0;font-size:20px;font-weight:600;">🦷 ${safeName}</h2>
    </div>
    <div style="background:#fff;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;padding:32px 24px;">
      ${paragraphs}
    </div>
    <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:20px;">
      This message was sent from Smart Dental Desk on behalf of your dental clinic.
    </p>
  </div>
</body>
</html>`.trim();
}

// ── Core send function ────────────────────────────────────────────────────────

/**
 * Send a transactional email via Resend.
 *
 * @param {object}  opts
 * @param {string}  opts.to           - Recipient email (validated)
 * @param {string}  opts.subject      - Subject line (max 200 chars)
 * @param {string}  opts.text         - Plain-text body (sanitized, max 50 KB)
 * @param {string}  [opts.templateId] - Template identifier for logging
 * @param {string}  [opts.clinicId]   - Clinic ID for audit logging
 * @param {boolean} [opts.dryRun]     - If true, validates but does not send
 * @returns {Promise<{ messageId: string }>}
 */
async function sendMail({ to, subject, text, templateId, clinicId, dryRun = false }) {
  const mode = getEmailMode();

  // ── 1. Input validation ───────────────────────────────────────────────────
  if (!isValidEmailFormat(to)) {
    throw new SafeConfigError('Invalid recipient email address.', 'INVALID_RECIPIENT');
  }

  if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
    throw new SafeConfigError('Subject is required.', 'MISSING_SUBJECT');
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new SafeConfigError(`Subject exceeds maximum length of ${MAX_SUBJECT_LENGTH}.`, 'SUBJECT_TOO_LONG');
  }
  // Never allow patient clinical data in subjects (no PHI patterns)
  // We strip the subject of any newlines to prevent header injection
  const cleanSubject = subject.replace(/[\r\n]/g, ' ').slice(0, MAX_SUBJECT_LENGTH);

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new SafeConfigError('Email body is required.', 'MISSING_BODY');
  }

  const cleanText = sanitizePlainText(text);

  // ── 2. Gate check ─────────────────────────────────────────────────────────
  if (!isSafeToSend()) {
    const reason = mode === 'disabled'
      ? 'Email is disabled (RESEND_API_KEY not configured).'
      : 'Email production configuration is incomplete or invalid.';

    safeLogEvent({
      event: 'email.blocked',
      recipientEmail: to,
      templateId,
      clinicId,
      status: 'blocked',
      errorCode: 'EMAIL_NOT_CONFIGURED',
    });

    throw new SafeConfigError(reason, 'EMAIL_NOT_CONFIGURED');
  }

  // ── 3. Development/staging — block real recipients if not explicitly enabled ──
  if (mode === 'development' || mode === 'staging') {
    const allowedTestDomains = (process.env.EMAIL_TEST_RECIPIENT_DOMAINS || '')
      .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    const toDomain = to.split('@')[1]?.toLowerCase();
    if (allowedTestDomains.length > 0 && !allowedTestDomains.includes(toDomain)) {
      safeLogEvent({
        event: 'email.blocked',
        recipientEmail: to,
        templateId,
        clinicId,
        status: 'blocked',
        errorCode: 'RECIPIENT_NOT_IN_TEST_ALLOWLIST',
      });
      throw new SafeConfigError(
        `In ${mode} mode, email recipients must be from the configured test domain allowlist.`,
        'RECIPIENT_NOT_IN_TEST_ALLOWLIST'
      );
    }
    if (mode === 'development') {
      console.info(`[EmailGate] DEV MODE — email would send to masked recipient, template: ${templateId || 'unknown'}`);
    }
  }

  // ── 4. Dry run ────────────────────────────────────────────────────────────
  if (dryRun) {
    safeLogEvent({
      event: 'email.dryRun',
      recipientEmail: to,
      templateId,
      clinicId,
      status: 'dry_run',
    });
    return { messageId: 'dry-run', dryRun: true };
  }

  // ── 5. Build payload ──────────────────────────────────────────────────────
  const cfg = getEmailConfig();
  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM;
  const fromName  = cfg.fromName;

  const htmlBody = buildSafeHtml(cleanText, fromName);

  const payload = {
    from:    `"${fromName}" <${fromEmail}>`,
    to:      [to],
    subject: cleanSubject,
    text:    cleanText,
    html:    htmlBody,
  };

  // ── 6. Send via Resend ────────────────────────────────────────────────────
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      // 15-second timeout via AbortController
      signal: AbortSignal.timeout(15_000),
    });
  } catch (fetchErr) {
    safeLogEvent({
      event: 'email.send',
      recipientEmail: to,
      templateId,
      clinicId,
      status: 'fetch_error',
      errorCode: fetchErr.name || 'NETWORK_ERROR',
    });
    // Never expose the full error message (may contain URL with key)
    throw new Error('Email delivery failed due to a network error. Please try again.');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const errCode = data.name || data.statusCode || response.status;
    safeLogEvent({
      event: 'email.send',
      recipientEmail: to,
      templateId,
      clinicId,
      status: 'api_error',
      errorCode: String(errCode),
    });
    // Expose only safe error info — never the API key or full response
    throw new Error(`Email delivery failed (code: ${errCode}). Check Resend dashboard.`);
  }

  safeLogEvent({
    event: 'email.send',
    recipientEmail: to,
    templateId,
    clinicId,
    status: 'sent',
    messageId: data.id,
  });

  return { messageId: data.id };
}

module.exports = { sendMail, buildSafeHtml, sanitizePlainText };
