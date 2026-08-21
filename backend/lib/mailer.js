// ─────────────────────────────────────────────────────────────────────────────
//  Mailer — Resend API (HTTP-based, bypasses Render SMTP port blocks)
//  Uses RESEND_API_KEY configured in .env
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send an email.
 * @param {object} opts
 * @param {string} opts.to      - Recipient email address
 * @param {string} opts.subject - Email subject
 * @param {string} opts.text    - Plain-text body
 * @param {string} [opts.html]  - Optional HTML body
 */
async function sendMail({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('Resend API key not configured. Set RESEND_API_KEY in your Render environment variables.');
  }

  const fromName  = process.env.SMTP_FROM_NAME || 'Smart Dental Desk';
  
  // Resend requires a verified domain to send FROM a custom address.
  // Until a domain is verified, use Resend's built-in test address.
  // Set RESEND_FROM_EMAIL in Render env vars once you have a verified domain.
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  const payload = {
    from: `"${fromName}" <${fromEmail}>`,
    to: [to],
    subject: subject,
    text: text
  };

  if (html) {
    payload.html = html;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Resend Error: ${data.message || JSON.stringify(data)}`);
  }

  return {
    messageId: data.id
  };
}

module.exports = { sendMail };
