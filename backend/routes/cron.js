const express = require('express');
const supabase = require('../lib/supabase');
const { PLAN_CREDITS } = require('../lib/plans');
const { sendAppointmentReminders } = require('../cron/reminders');

const router = express.Router();

// ── POST /api/cron/send-reminders ─────────────────────────────────────────────
// Called by Render Cron Jobs (or any external cron scheduler) daily
router.post('/send-reminders', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await sendAppointmentReminders();
    res.json({ success: true, message: 'Reminder job complete.' });
  } catch (err) {
    console.error('[Cron /send-reminders Error]', err.message);
    next(err);
  }
});

// ── POST /api/cron/send-scheduled-messages ────────────────────────────────────
// Fires all pending scheduled messages whose scheduled_at <= now
router.post('/send-scheduled-messages', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // Delegate to the messages route logic by calling the shared helper
    const { sendMail } = require('../lib/mailer');
    const supabase = require('../lib/supabase');

    const { data: due, error } = await supabase
      .from('scheduled_messages')
      .select('*, clinics(name)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .limit(200);

    if (error) throw error;

    let sentCount = 0, failedCount = 0;

    for (const msg of due) {
      try {
        const clinicName = msg.clinics?.name || 'Smart Dental Desk';
        const lines = msg.body.split('\n').map(l =>
          `<p style="margin:0 0 12px;line-height:1.7;color:#374151;">${l || '&nbsp;'}</p>`
        ).join('');
        const html = `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;">
          <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
            <h2 style="color:#fff;margin:0;">🦷 ${clinicName}</h2>
          </div>
          <div style="background:#fff;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;padding:32px 24px;">
            <p style="color:#374151;margin:0 0 20px;">Hi ${msg.recipient_name},</p>
            ${lines}
          </div>
          <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:20px;">Sent via Smart Dental Desk</p>
        </div>`;

        const info = await sendMail({ to: msg.recipient_email, subject: msg.subject, text: msg.body, html });
        await supabase.from('scheduled_messages').update({
          status: 'sent', sent_at: new Date().toISOString(),
          resend_message_id: info.messageId, updated_at: new Date().toISOString()
        }).eq('id', msg.id);
        sentCount++;
      } catch (e) {
        await supabase.from('scheduled_messages').update({
          status: 'failed', error_message: e.message, updated_at: new Date().toISOString()
        }).eq('id', msg.id);
        failedCount++;
      }
    }

    res.json({ success: true, sent: sentCount, failed: failedCount, total: due.length });
  } catch (err) {
    console.error('[Cron /send-scheduled-messages Error]', err.message);
    next(err);
  }
});

router.post('/reset-credits', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('clinic_id, plan, current_period_start, current_period_end, clinic_credits(last_reset_at)')
      .in('status', ['active', 'trialing']);

    if (error) throw error;

    let processedCount = 0;

    for (const sub of subscriptions) {
      // Supabase join returns object or array, assume single object or first element
      const credits = Array.isArray(sub.clinic_credits) ? sub.clinic_credits[0] : sub.clinic_credits;
      
      // Idempotency: if already reset for this active billing period, skip
      if (credits && credits.last_reset_at && new Date(credits.last_reset_at) >= new Date(sub.current_period_start)) {
        continue;
      }

      const allocated = PLAN_CREDITS[sub.plan] || 0;

      // Reset monthly allocation and mark last_reset_at
      await supabase.from('clinic_credits').upsert({
        clinic_id: sub.clinic_id,
        credits_allocated: allocated,
        credits_used: 0,
        last_reset_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'clinic_id' });

      // Log allocation
      await supabase.from('credit_transactions').insert({
        clinic_id: sub.clinic_id,
        type: 'allocation',
        amount: allocated,
        ai_mode: 'system'
      });

      processedCount++;
    }

    res.json({ success: true, processed: processedCount });
  } catch (err) {
    console.error('Cron Reset Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
