// ─────────────────────────────────────────────────────────────────────────────
//  Mailer — Nodemailer SMTP transport
//  Uses Gmail App Password configured in .env
//  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_NAME
// ─────────────────────────────────────────────────────────────────────────────
const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP credentials not configured. Set SMTP_USER and SMTP_PASS in .env');
  }

  _transporter = nodemailer.createTransport({
    host:   SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(SMTP_PORT || '587', 10),
    secure: parseInt(SMTP_PORT || '587', 10) === 465, // true for 465, false for 587
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 15000,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return _transporter;
}

/**
 * Send an email.
 * @param {object} opts
 * @param {string} opts.to      - Recipient email address
 * @param {string} opts.subject - Email subject
 * @param {string} opts.text    - Plain-text body
 * @param {string} [opts.html]  - Optional HTML body
 */
async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter();

  const fromName  = process.env.SMTP_FROM_NAME || 'Smart Dental Desk';
  const fromEmail = process.env.SMTP_USER;

  const info = await transporter.sendMail({
    from:    `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  });

  return info;
}

module.exports = { sendMail };
