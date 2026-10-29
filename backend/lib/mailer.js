// ─────────────────────────────────────────────────────────────────────────────
//  Mailer — lib/mailer.js
//
//  Sends transactional emails with dual transport:
//  1. Primary: Resend HTTP API (if RESEND_API_KEY is configured)
//  2. Fallback / Direct: Nodemailer SMTP (if SMTP_USER and SMTP_PASS are configured)
//
//  Never logs secrets, API keys, patient clinical content, or full email bodies.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const nodemailer = require('nodemailer');
const {
  getEmailMode,
  getEmailConfig,
  isSafeToSend,
  safeLogEvent,
  isValidEmailFormat,
  SafeConfigError,
  resolveEnvVar,
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

// ── Build a safe HTML body from plain text (fallback when no html is supplied)
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

  const safeName = (fromName || 'dentalsmart')
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
      This message was sent from dentalsmart on behalf of your dental clinic.
    </p>
  </div>
</body>
</html>`.trim();
}

// ── SMTP Transporter Singleton ───────────────────────────────────────────────
let _smtpTransporter = null;

function getSmtpTransporter() {
  const smtpUser = resolveEnvVar('SMTP_USER');
  const smtpPass = resolveEnvVar('SMTP_PASS');
  const smtpHost = resolveEnvVar('SMTP_HOST') || 'smtp.gmail.com';
  const smtpPort = parseInt(resolveEnvVar('SMTP_PORT') || '587', 10);

  if (!smtpUser || !smtpPass) return null;

  if (!_smtpTransporter) {
    _smtpTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 15000,
    });
  }

  return _smtpTransporter;
}

// ── Core send function ────────────────────────────────────────────────────────

/**
 * Send a transactional email via Resend API (primary) or Nodemailer SMTP (fallback).
 *
 * @param {object}  opts
 * @param {string}  opts.to           - Recipient email (validated)
 * @param {string}  opts.subject      - Subject line (max 200 chars)
 * @param {string}  opts.text         - Plain-text body (sanitized, max 50 KB)
 * @param {string}  [opts.html]       - Optional formatted HTML body
 * @param {string}  [opts.templateId] - Template identifier for logging
 * @param {string}  [opts.clinicId]   - Clinic ID for audit logging
 * @param {boolean} [opts.dryRun]     - If true, validates but does not send
 * @returns {Promise<{ messageId: string, provider: string }>}
 */
async function sendMail({ to, subject, text, html, templateId, clinicId, dryRun = false }) {
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
  const cleanSubject = subject.replace(/[\r\n]/g, ' ').slice(0, MAX_SUBJECT_LENGTH);

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new SafeConfigError('Email body is required.', 'MISSING_BODY');
  }
  const cleanText = sanitizePlainText(text);

  // ── 2. Gate check ─────────────────────────────────────────────────────────
  if (!isSafeToSend()) {
    safeLogEvent({
      event: 'email.blocked',
      recipientEmail: to,
      templateId,
      clinicId,
      status: 'blocked',
      errorCode: 'EMAIL_NOT_CONFIGURED',
    });
    console.error('[Mailer] Email delivery blocked: Neither RESEND_API_KEY nor SMTP credentials (SMTP_USER/SMTP_PASS) are configured.');
    throw new SafeConfigError('Email service is not configured.', 'EMAIL_NOT_CONFIGURED');
  }

  // ── 3. Dry run ────────────────────────────────────────────────────────────
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

  // ── 4. Build names & addresses ────────────────────────────────────────────
  const cfg = getEmailConfig();
  const fromName = cfg.fromName || resolveEnvVar('EMAIL_FROM_NAME', 'SMTP_FROM_NAME') || 'DentalSmart';
  const htmlBody = html || buildSafeHtml(cleanText, fromName);

  const resendApiKey = resolveEnvVar('RESEND_API_KEY');
  let resendErr = null;

  // ── 5. Attempt 1: Resend HTTP API ─────────────────────────────────────────
  if (resendApiKey) {
    const fromEmail = resolveEnvVar('EMAIL_FROM', 'RESEND_FROM_EMAIL') || 'onboarding@resend.dev';
    const payload = {
      from: `"${fromName}" <${fromEmail}>`,
      to: [to],
      subject: cleanSubject,
      text: cleanText,
      html: htmlBody,
    };

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });

      let data;
      try { data = await response.json(); } catch { data = {}; }

      if (response.ok && data.id) {
        safeLogEvent({
          event: 'email.send',
          recipientEmail: to,
          templateId,
          clinicId,
          status: 'sent',
          messageId: data.id,
        });
        return { messageId: data.id, provider: 'resend' };
      }

      resendErr = new Error(`Resend API error (${response.status}): ${data.message || JSON.stringify(data)}`);
      console.warn('[Mailer] Resend API failed, checking SMTP fallback:', resendErr.message);
    } catch (fetchErr) {
      resendErr = fetchErr;
      console.warn('[Mailer] Resend fetch network error, checking SMTP fallback:', fetchErr.message);
    }
  }

  // ── 6. Attempt 2: Nodemailer SMTP (Fallback or primary if no Resend key) ──
  const smtpTransporter = getSmtpTransporter();
  if (smtpTransporter) {
    const smtpUser = resolveEnvVar('SMTP_USER');
    try {
      const info = await smtpTransporter.sendMail({
        from: `"${fromName}" <${smtpUser}>`,
        to,
        subject: cleanSubject,
        text: cleanText,
        html: htmlBody,
      });

      safeLogEvent({
        event: 'email.send',
        recipientEmail: to,
        templateId,
        clinicId,
        status: 'sent',
        messageId: info.messageId,
      });
      return { messageId: info.messageId, provider: 'smtp' };
    } catch (smtpErr) {
      console.error('[Mailer] SMTP delivery error:', smtpErr.message);
      safeLogEvent({
        event: 'email.send',
        recipientEmail: to,
        templateId,
        clinicId,
        status: 'smtp_error',
        errorCode: smtpErr.code || 'SMTP_ERROR',
      });
      throw new Error(`Email delivery failed via SMTP: ${smtpErr.message}`);
    }
  }

  // If we reached here, Resend failed and there was no SMTP transporter
  if (resendErr) {
    safeLogEvent({
      event: 'email.send',
      recipientEmail: to,
      templateId,
      clinicId,
      status: 'resend_error',
      errorCode: resendErr.name || 'RESEND_ERROR',
    });
    throw resendErr;
  }

  throw new Error('Email delivery failed: No valid email transport succeeded.');
}

module.exports = { sendMail, buildSafeHtml, sanitizePlainText };
