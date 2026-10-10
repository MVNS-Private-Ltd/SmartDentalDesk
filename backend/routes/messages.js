// ─────────────────────────────────────────────────────────────────────────────
//  Scheduled Messages Routes
//
//  POST   /api/messages/schedule         — Create a new scheduled message
//  GET    /api/messages/scheduled        — List scheduled messages (with filters)
//  GET    /api/messages/scheduled/:id    — Get a single scheduled message
//  DELETE /api/messages/scheduled/:id    — Cancel (soft-delete) a scheduled msg
//  POST   /api/messages/send-due         — [Internal/cron] Fire all due messages
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const { body, validationResult } = require('express-validator');
const supabase = require('../lib/supabase');
const { sendMail } = require('../lib/mailer');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// ── Build the branded HTML email ──────────────────────────────────────────────
function buildHtml(subject, bodyText, recipientName, clinicName) {
  const lines = bodyText.split('\n').map(l =>
    `<p style="margin:0 0 12px;line-height:1.7;color:#374151;">${l || '&nbsp;'}</p>`
  ).join('');
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1a1a2e;">
      <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
        <h2 style="color:#fff;margin:0;font-size:20px;font-weight:600;">🦷 ${clinicName || 'dentalsmart'}</h2>
      </div>
      <div style="background:#fff;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 12px 12px;padding:32px 24px;">
        <p style="color:#374151;margin:0 0 20px;">Hi ${recipientName || 'there'},</p>
        ${lines}
      </div>
      <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:20px;">
        Sent via dentalsmart · <a href="#" style="color:#9ca3af;">Unsubscribe</a>
      </p>
    </div>`;
}

// ── POST /api/messages/schedule ───────────────────────────────────────────────
router.post('/schedule', [
  body('recipient_name').trim().notEmpty().withMessage('recipient_name is required'),
  body('recipient_email').isEmail().withMessage('A valid recipient_email is required'),
  body('subject').trim().notEmpty().withMessage('subject is required'),
  body('body').trim().notEmpty().withMessage('body is required'),
  body('scheduled_at').isISO8601().withMessage('scheduled_at must be a valid ISO date-time'),
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const {
      recipient_name, recipient_email,
      subject, body: msgBody,
      scheduled_at, patient_id
    } = req.body;

    const schedDate = new Date(scheduled_at);
    if (schedDate <= new Date()) {
      return res.status(400).json({ error: 'scheduled_at must be a future date/time.' });
    }

    const { data, error } = await supabase
      .from('scheduled_messages')
      .insert({
        clinic_id:      req.clinicId,
        patient_id:     patient_id || null,
        recipient_name,
        recipient_email,
        subject,
        body:           msgBody,
        scheduled_at:   schedDate.toISOString(),
        status:         'pending',
        created_by:     req.user?.id || null,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, message: data });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/messages/scheduled ───────────────────────────────────────────────
router.get('/scheduled', async (req, res, next) => {
  try {
    const { status } = req.query; // optional filter: pending | sent | failed | cancelled

    let query = supabase
      .from('scheduled_messages')
      .select('*')
      .eq('clinic_id', req.clinicId)
      .order('scheduled_at', { ascending: true });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ messages: data });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/messages/scheduled/:id ──────────────────────────────────────────
router.get('/scheduled/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('scheduled_messages')
      .select('*')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Message not found.' });
    res.json({ message: data });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/messages/scheduled/:id ── cancel a pending message ─────────────
router.delete('/scheduled/:id', async (req, res, next) => {
  try {
    const { data: existing } = await supabase
      .from('scheduled_messages')
      .select('id, status')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Message not found.' });
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: `Cannot cancel a message that is already ${existing.status}.` });
    }

    const { error } = await supabase
      .from('scheduled_messages')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/messages/send-due ── called by cron job ──────────────────────────
// Requires CRON_SECRET authorization header
router.post('/send-due', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    // Allow cron secret OR logged-in super-admin (for manual trigger)
    const isCron = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
    const isAdmin = req.user?.role === 'super_admin';

    if (!isCron && !isAdmin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Fetch all pending messages scheduled for now or earlier
    const { data: due, error } = await supabase
      .from('scheduled_messages')
      .select('*, clinics(name)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .limit(100); // process in batches

    if (error) throw error;

    let sentCount = 0;
    let failedCount = 0;

    for (const msg of due) {
      try {
        const clinicName = msg.clinics?.name || 'dentalsmart';
        const html = buildHtml(msg.subject, msg.body, msg.recipient_name, clinicName);

        const info = await sendMail({
          to:      msg.recipient_email,
          subject: msg.subject,
          text:    msg.body,
          html,
        });

        await supabase.from('scheduled_messages').update({
          status:            'sent',
          sent_at:           new Date().toISOString(),
          resend_message_id: info.messageId,
          updated_at:        new Date().toISOString(),
        }).eq('id', msg.id);

        sentCount++;
      } catch (sendErr) {
        console.error(`[ScheduledMsg] Failed to send ${msg.id}:`, sendErr.message);

        await supabase.from('scheduled_messages').update({
          status:        'failed',
          error_message: sendErr.message,
          updated_at:    new Date().toISOString(),
        }).eq('id', msg.id);

        failedCount++;
      }
    }

    res.json({ success: true, sent: sentCount, failed: failedCount, total: due.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
