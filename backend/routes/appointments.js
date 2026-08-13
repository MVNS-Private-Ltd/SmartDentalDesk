// ─────────────────────────────────────────────────────────────────────────────
//  Appointments Routes
//  GET    /api/appointments          — List appointments (filter by date/status)
//  GET    /api/appointments/today    — Today's appointments only
//  GET    /api/appointments/:id      — Single appointment
//  POST   /api/appointments          — Create appointment
//  PUT    /api/appointments/:id      — Update appointment (reschedule, notes)
//  PATCH  /api/appointments/:id/status — Update status only
//  DELETE /api/appointments/:id      — Cancel appointment
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const { body, validationResult } = require('express-validator');
const supabase    = require('../lib/supabase');
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

// ── GET /api/appointments ─────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { date, status, page = 1, limit = 30 } = req.query;
    const offset = (page - 1) * limit;

    let q = supabase
      .from('appointments')
      .select(`
        id, date, time, service, reason, status, notes, created_at,
        patients(id, name, phone)
      `, { count: 'exact' })
      .eq('clinic_id', req.clinicId)
      .neq('status', 'cancelled')
      .order('date', { ascending: true })
      .order('time', { ascending: true })
      .range(offset, offset + Number(limit) - 1);

    if (date)   q = q.eq('date', date);
    if (status) q = q.eq('status', status);

    const { data, error, count } = await q;
    if (error) throw error;

    res.json({ appointments: data, total: count, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
});

// ── GET /api/appointments/today ───────────────────────────────────────────────
router.get('/today', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id, date, time, service, reason, status, notes,
        patients(id, name, phone)
      `)
      .eq('clinic_id', req.clinicId)
      .eq('date', today)
      .neq('status', 'cancelled')
      .order('time', { ascending: true });

    if (error) throw error;
    res.json({ appointments: data, date: today });
  } catch (err) { next(err); }
});

// ── GET /api/appointments/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select(`*, patients(id, name, phone, email)`)
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Appointment not found.' });
    res.json({ appointment: data });
  } catch (err) { next(err); }
});

// ── POST /api/appointments ────────────────────────────────────────────────────
const createRules = [
  body('patient_id').notEmpty().withMessage('Patient ID is required'),
  body('date').isDate().withMessage('Valid date is required (YYYY-MM-DD)'),
  body('time').matches(/^\d{2}:\d{2}$/).withMessage('Valid time is required (HH:MM)'),
  body('service').trim().notEmpty().withMessage('Service type is required')
];

router.post('/', createRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { patient_id, date, time, service, reason, notes } = req.body;

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        clinic_id : req.clinicId,
        patient_id,
        date,
        time,
        service,
        reason  : reason || null,
        notes   : notes  || null,
        status  : 'scheduled'
      })
      .select(`*, patients(id, name, phone)`)
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'Appointment booked.', appointment: data });
  } catch (err) { next(err); }
});

// ── PUT /api/appointments/:id ─────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['date','time','service','reason','notes','status'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('appointments')
      .update(updates)
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select(`*, patients(id, name, phone)`)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Appointment not found.' });
    res.json({ message: 'Appointment updated.', appointment: data });
  } catch (err) { next(err); }
});

// ── PATCH /api/appointments/:id/status ────────────────────────────────────────
router.patch('/:id/status', [
  body('status').isIn(['scheduled','in-progress','completed','cancelled','no-show'])
    .withMessage('Invalid status value')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const { data, error } = await supabase
      .from('appointments')
      .update({ status: req.body.status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Appointment not found.' });
    res.json({ message: `Status updated to ${req.body.status}.`, appointment: data });
  } catch (err) { next(err); }
});

// ── DELETE /api/appointments/:id ──────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId);

    if (error) throw error;
    res.json({ message: 'Appointment cancelled.' });
  } catch (err) { next(err); }
});

module.exports = router;
