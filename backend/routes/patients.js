// ─────────────────────────────────────────────────────────────────────────────
//  Patients Routes
//  GET    /api/patients          — List all patients for this clinic
//  GET    /api/patients/:id      — Get single patient with visit history
//  POST   /api/patients          — Create new patient
//  PUT    /api/patients/:id      — Update patient details
//  DELETE /api/patients/:id      — Soft-delete patient
//  GET    /api/patients/search   — Search by name or phone
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const { body, query, validationResult } = require('express-validator');
const supabase    = require('../lib/supabase');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth); // All patient routes require auth

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// ── GET /api/patients ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;

    let q = supabase
      .from('patients')
      .select('id, name, phone, email, dob, gender, address, notes, created_at', { count: 'exact' })
      .eq('clinic_id', req.clinicId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (search) {
      q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data, error, count } = await q;
    if (error) throw error;

    res.json({ patients: data, total: count, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
});

// ── GET /api/patients/search ──────────────────────────────────────────────────
router.get('/search', [query('q').notEmpty()], async (req, res, next) => {
  try {
    const { q } = req.query;
    const { data, error } = await supabase
      .from('patients')
      .select('id, name, phone, email')
      .eq('clinic_id', req.clinicId)
      .eq('is_deleted', false)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(10);

    if (error) throw error;
    res.json({ patients: data });
  } catch (err) { next(err); }
});

// ── GET /api/patients/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { data: patient, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .eq('is_deleted', false)
      .single();

    if (error || !patient) return res.status(404).json({ error: 'Patient not found.' });

    // Also fetch appointments and treatments
    const { data: appointments } = await supabase
      .from('appointments')
      .select('id, date, time, service, reason, status, notes')
      .eq('patient_id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .order('date', { ascending: false })
      .limit(20);

    const { data: treatments } = await supabase
      .from('treatment_records')
      .select('id, procedure, notes, prescription, cost, created_at')
      .eq('patient_id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({ patient, appointments: appointments || [], treatments: treatments || [] });
  } catch (err) { next(err); }
});

// ── POST /api/patients ────────────────────────────────────────────────────────
const createRules = [
  body('name').trim().notEmpty().withMessage('Patient name is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('email').optional().isEmail().withMessage('Invalid email'),
  body('dob').optional().isDate().withMessage('Invalid date of birth'),
  body('gender').optional().isIn(['male', 'female', 'other'])
];

router.post('/', createRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { name, phone, email, dob, gender, address, notes } = req.body;

    const { data, error } = await supabase
      .from('patients')
      .insert({ clinic_id: req.clinicId, name, phone, email, dob, gender, address, notes })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A patient with this phone number already exists.' });
      throw error;
    }
    res.status(201).json({ message: 'Patient created.', patient: data });
  } catch (err) { next(err); }
});

// ── PUT /api/patients/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['name','phone','email','dob','gender','address','notes'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const { data, error } = await supabase
      .from('patients')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Patient not found.' });
    res.json({ message: 'Patient updated.', patient: data });
  } catch (err) { next(err); }
});

// ── DELETE /api/patients/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('patients')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId);

    if (error) throw error;
    res.json({ message: 'Patient removed.' });
  } catch (err) { next(err); }
});

module.exports = router;
