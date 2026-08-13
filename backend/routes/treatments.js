// ─────────────────────────────────────────────────────────────────────────────
//  Treatment Records Routes
//  GET  /api/treatments               — All treatment records for clinic
//  GET  /api/treatments/patient/:pid  — All treatments for a patient
//  GET  /api/treatments/:id           — Single treatment record
//  POST /api/treatments               — Log a new treatment
//  PUT  /api/treatments/:id           — Edit treatment record
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

// ── GET /api/treatments ───────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from('treatment_records')
      .select(`
        id, procedure, notes, prescription, cost, created_at,
        patients(id, name, phone),
        appointments(id, date, time, service)
      `, { count: 'exact' })
      .eq('clinic_id', req.clinicId)
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (error) throw error;
    res.json({ treatments: data, total: count });
  } catch (err) { next(err); }
});

// ── GET /api/treatments/patient/:pid ─────────────────────────────────────────
router.get('/patient/:pid', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('treatment_records')
      .select(`id, procedure, notes, prescription, cost, created_at, appointments(date, time)`)
      .eq('clinic_id', req.clinicId)
      .eq('patient_id', req.params.pid)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ treatments: data });
  } catch (err) { next(err); }
});

// ── GET /api/treatments/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('treatment_records')
      .select(`*, patients(id, name, phone), appointments(id, date, time, service)`)
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Treatment record not found.' });
    res.json({ treatment: data });
  } catch (err) { next(err); }
});

// ── POST /api/treatments ──────────────────────────────────────────────────────
const createRules = [
  body('patient_id').notEmpty().withMessage('Patient ID is required'),
  body('procedure').trim().notEmpty().withMessage('Procedure description is required'),
  body('cost').optional().isFloat({ min: 0 }).withMessage('Cost must be a positive number')
];

router.post('/', createRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { patient_id, appointment_id, procedure, notes, prescription, cost, tooth_number, photos } = req.body;

    const { data, error } = await supabase
      .from('treatment_records')
      .insert({
        clinic_id     : req.clinicId,
        patient_id,
        appointment_id: appointment_id || null,
        procedure,
        notes         : notes        || null,
        prescription  : prescription || null,
        cost          : cost         || null,
        tooth_number  : tooth_number || null,
        photos        : photos       || []
      })
      .select(`*, patients(id, name)`)
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'Treatment record saved.', treatment: data });
  } catch (err) { next(err); }
});

// ── PUT /api/treatments/:id ───────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['procedure','notes','prescription','cost','tooth_number','photos'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('treatment_records')
      .update(updates)
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Treatment record not found.' });
    res.json({ message: 'Treatment updated.', treatment: data });
  } catch (err) { next(err); }
});

module.exports = router;
