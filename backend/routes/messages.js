// ─────────────────────────────────────────────────────────────────────────────
//  Scheduled Messages Routes
//
//  POST   /api/messages/send-due         — [Cron/Public Secret] Fire all due messages
//  POST   /api/messages/schedule         — Create a new scheduled message
//  GET    /api/messages/scheduled        — List scheduled messages (with filters)
//  GET    /api/messages/scheduled/:id    — Get a single scheduled message
//  POST   /api/messages/scheduled/:id/send-now — Fire a specific message immediately
//  DELETE /api/messages/scheduled/:id    — Cancel (soft-delete) a scheduled msg
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const { body, validationResult } = require('express-validator');
const supabase = require('../lib/supabase');
const { sendMail } = require('../lib/mailer');
const requireAuth = require('../middleware/auth');
const { isSuperAdminUser } = require('../middleware/superAdmin');
const { buildHtml, processDueScheduledMessages } = require('../cron/scheduledWorker');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// Helper: resolve clinicId even for super-admin testing
async function resolveClinicId(req) {
  if (req.clinicId) return req.clinicId;
  const headerClinic = req.headers['x-clinic-id'];
  if (headerClinic) return headerClinic;
  if (req.isSuperAdmin) {
    const { data: firstClinic } = await supabase.from('clinics').select('id').limit(1).maybeSingle();
    return firstClinic?.id || null;
  }
  return null;
}

// ── 1. POST /api/messages/send-due ── called by cron job or super-admin ───────
// Mounted BEFORE requireAuth so external cron services with CRON_SECRET can call it
router.post('/send-due', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const isCron = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;

    let isAdmin = false;
    if (!isCron && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user && isSuperAdminUser(user)) {
        isAdmin = true;
      }
    }

    if (!isCron && !isAdmin) {
      return res.status(401).json({ error: 'Unauthorized — requires CRON_SECRET or Super Admin token.' });
    }

    const result = await processDueScheduledMessages();
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ── Enforce Authentication for all clinic-facing endpoints ────────────────────
router.use(requireAuth);

// ── 2. POST /api/messages/schedule ───────────────────────────────────────────
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
    const now = new Date();

    // Allow up to 60s tolerance for client-server clock drift
    if (schedDate.getTime() < (now.getTime() - 60 * 1000)) {
      return res.status(400).json({ error: 'scheduled_at must be a future date/time.' });
    }

    const clinicId = await resolveClinicId(req);
    if (!clinicId) {
      return res.status(400).json({ error: 'No clinic context found for this request.' });
    }

    const { data, error } = await supabase
      .from('scheduled_messages')
      .insert({
        clinic_id:      clinicId,
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

// ── 3. GET /api/messages/scheduled ───────────────────────────────────────────
router.get('/scheduled', async (req, res, next) => {
  try {
    const { status } = req.query; // optional filter: pending | sent | failed | cancelled
    const clinicId = await resolveClinicId(req);

    if (!clinicId) {
      return res.json({ messages: [] });
    }

    let query = supabase
      .from('scheduled_messages')
      .select('*')
      .eq('clinic_id', clinicId);

    if (status) {
      query = query.eq('status', status);
      if (status === 'pending') {
        query = query.order('scheduled_at', { ascending: true });
      } else {
        query = query.order('updated_at', { ascending: false });
      }
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ messages: data || [] });
  } catch (err) {
    next(err);
  }
});

// ── 4. GET /api/messages/scheduled/:id ──────────────────────────────────────
router.get('/scheduled/:id', async (req, res, next) => {
  try {
    const clinicId = await resolveClinicId(req);
    let query = supabase
      .from('scheduled_messages')
      .select('*')
      .eq('id', req.params.id);

    if (clinicId) {
      query = query.eq('clinic_id', clinicId);
    }

    const { data, error } = await query.single();

    if (error || !data) return res.status(404).json({ error: 'Message not found.' });
    res.json({ message: data });
  } catch (err) {
    next(err);
  }
});

// ── 4b. PUT /api/messages/scheduled/:id ── update an existing pending message ─
router.put('/scheduled/:id', [
  body('recipient_name').trim().notEmpty().withMessage('recipient_name is required'),
  body('recipient_email').isEmail().withMessage('A valid recipient_email is required'),
  body('subject').trim().notEmpty().withMessage('subject is required'),
  body('body').trim().notEmpty().withMessage('body is required'),
  body('scheduled_at').isISO8601().withMessage('scheduled_at must be a valid ISO date-time'),
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const clinicId = await resolveClinicId(req);
    let query = supabase
      .from('scheduled_messages')
      .select('id, status, clinic_id')
      .eq('id', req.params.id);

    if (clinicId) {
      query = query.eq('clinic_id', clinicId);
    }

    const { data: existing, error: fetchErr } = await query.maybeSingle();
    if (fetchErr || !existing) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    if (existing.status === 'sent') {
      return res.status(409).json({ error: 'Cannot edit an email that has already been delivered.' });
    }

    const {
      recipient_name, recipient_email,
      subject, body: msgBody,
      scheduled_at, patient_id
    } = req.body;

    const schedDate = new Date(scheduled_at);
    const now = new Date();

    // Allow up to 60s tolerance for client-server clock drift
    if (schedDate.getTime() < (now.getTime() - 60 * 1000)) {
      return res.status(400).json({ error: 'scheduled_at must be a future date/time.' });
    }

    const updatePayload = {
      recipient_name,
      recipient_email,
      subject,
      body: msgBody,
      scheduled_at: schedDate.toISOString(),
      status: 'pending',
      error_message: null,
      updated_at: new Date().toISOString()
    };
    if (patient_id !== undefined) {
      updatePayload.patient_id = patient_id || null;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('scheduled_messages')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    res.json({ success: true, message: updated });
  } catch (err) {
    next(err);
  }
});

// ── 5. POST /api/messages/scheduled/:id/send-now ─────────────────────────────
// Immediately fires a pending or failed scheduled message
router.post('/scheduled/:id/send-now', async (req, res, next) => {
  try {
    const clinicId = await resolveClinicId(req);
    let query = supabase
      .from('scheduled_messages')
      .select('*, clinics(name)')
      .eq('id', req.params.id);

    if (clinicId) {
      query = query.eq('clinic_id', clinicId);
    }

    const { data: msg, error: fetchErr } = await query.maybeSingle();
    if (fetchErr || !msg) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    const clinicName = msg.clinics?.name || 'dentalsmart';
    const html = buildHtml(msg.subject, msg.body, msg.recipient_name, clinicName);

    try {
      const info = await sendMail({
        to:         msg.recipient_email,
        subject:    msg.subject,
        text:       msg.body,
        templateId: 'scheduled_message_immediate',
        clinicId:   msg.clinic_id,
      });

      const { data: updated, error: updateErr } = await supabase
        .from('scheduled_messages')
        .update({
          status:            'sent',
          sent_at:           new Date().toISOString(),
          resend_message_id: info?.messageId || null,
          error_message:     null,
          updated_at:        new Date().toISOString(),
        })
        .eq('id', msg.id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      res.json({ success: true, message: updated });
    } catch (sendErr) {
      // Record failure on message record
      await supabase
        .from('scheduled_messages')
        .update({
          status:        'failed',
          error_message: sendErr.message || 'Immediate send failed',
          updated_at:    new Date().toISOString(),
        })
        .eq('id', msg.id);

      return res.status(400).json({ error: sendErr.message || 'Failed to send message immediately.' });
    }
  } catch (err) {
    next(err);
  }
});

// ── 6. DELETE /api/messages/scheduled/:id ── cancel a pending message ─────────
router.delete('/scheduled/:id', async (req, res, next) => {
  try {
    const clinicId = await resolveClinicId(req);
    let query = supabase
      .from('scheduled_messages')
      .select('id, status')
      .eq('id', req.params.id);

    if (clinicId) {
      query = query.eq('clinic_id', clinicId);
    }

    const { data: existing } = await query.maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Message not found.' });
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: `Cannot cancel a message that is already ${existing.status}.` });
    }

    const { error } = await supabase
      .from('scheduled_messages')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
