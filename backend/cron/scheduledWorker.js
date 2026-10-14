// ─────────────────────────────────────────────────────────────────────────────
//  Scheduled Messages Background Worker — cron/scheduledWorker.js
//
//  Polls for due scheduled emails and delivers them via sendMail.
//  Updates message status: 'pending' → 'sent' | 'failed'
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const supabase = require('../lib/supabase');
const { sendMail } = require('../lib/mailer');

let isWorkerRunning = false;

function buildHtml(subject, bodyText, recipientName, clinicName) {
  const lines = (bodyText || '').split('\n').map(l =>
    `<p style="margin:0 0 12px;line-height:1.7;color:#374151;">${l || '&nbsp;'}</p>`
  ).join('');

  const brand = clinicName || 'dentalsmart';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;padding:0 16px;">
    <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
      <h2 style="color:#ffffff;margin:0;font-size:20px;font-weight:600;">🦷 ${brand}</h2>
    </div>
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:32px 24px;">
      <p style="color:#1e293b;margin:0 0 18px;font-weight:600;font-size:15px;">Hi ${recipientName || 'there'},</p>
      ${lines}
    </div>
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:20px;">
      Sent via dentalsmart · This message was sent on behalf of ${brand}.
    </p>
  </div>
</body>
</html>`.trim();
}

/**
 * Process all pending scheduled messages whose scheduled_at <= now()
 * @returns {Promise<{ total: number, sent: number, failed: number }>}
 */
async function processDueScheduledMessages() {
  if (isWorkerRunning) {
    return { skipped: true };
  }
  isWorkerRunning = true;

  try {
    const nowIso = new Date().toISOString();

    const { data: due, error } = await supabase
      .from('scheduled_messages')
      .select('*, clinics(name)')
      .eq('status', 'pending')
      .lte('scheduled_at', nowIso)
      .limit(100);

    if (error) {
      console.error('[ScheduledWorker] Query error:', error.message);
      return { error: error.message };
    }

    if (!due || due.length === 0) {
      return { total: 0, sent: 0, failed: 0 };
    }

    console.log(`[ScheduledWorker] Found ${due.length} due message(s) to send.`);
    let sentCount = 0;
    let failedCount = 0;

    for (const msg of due) {
      try {
        const clinicName = msg.clinics?.name || 'dentalsmart';
        const html = buildHtml(msg.subject, msg.body, msg.recipient_name, clinicName);

        const info = await sendMail({
          to:         msg.recipient_email,
          subject:    msg.subject,
          text:       msg.body,
          templateId: 'scheduled_message',
          clinicId:   msg.clinic_id,
        });

        await supabase
          .from('scheduled_messages')
          .update({
            status:            'sent',
            sent_at:           new Date().toISOString(),
            resend_message_id: info?.messageId || null,
            error_message:     null,
            updated_at:        new Date().toISOString(),
          })
          .eq('id', msg.id);

        sentCount++;
        console.log(`[ScheduledWorker] ✅ Sent scheduled msg ${msg.id} to ${msg.recipient_email}`);
      } catch (err) {
        console.error(`[ScheduledWorker] ❌ Failed to send scheduled msg ${msg.id}:`, err.message);

        await supabase
          .from('scheduled_messages')
          .update({
            status:        'failed',
            error_message: err.message || 'Delivery failed',
            updated_at:    new Date().toISOString(),
          })
          .eq('id', msg.id);

        failedCount++;
      }
    }

    return { total: due.length, sent: sentCount, failed: failedCount };
  } catch (err) {
    console.error('[ScheduledWorker] Unexpected error:', err.message);
    return { error: err.message };
  } finally {
    isWorkerRunning = false;
  }
}

/**
 * Starts in-process background worker
 * @param {number} intervalMs - Polling interval in ms (default: 30000 = 30 seconds)
 */
function startScheduledMessagesWorker(intervalMs = 30000) {
  console.log(`   [scheduled-messages] Worker active — polling every ${intervalMs / 1000}s`);

  // Initial check 5s after server boot
  setTimeout(() => {
    processDueScheduledMessages().catch(e => console.error('[ScheduledWorker Initial Run Error]', e));
  }, 5000);

  return setInterval(() => {
    processDueScheduledMessages().catch(e => console.error('[ScheduledWorker Interval Error]', e));
  }, intervalMs);
}

module.exports = {
  buildHtml,
  processDueScheduledMessages,
  startScheduledMessagesWorker,
};
