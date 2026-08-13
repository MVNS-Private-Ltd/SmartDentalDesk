// ─────────────────────────────────────────────────────────────────────────────
//  Staff Routes
//  GET    /api/staff       — List staff members
//  GET    /api/staff/:id   — Single staff member
//  POST   /api/staff       — Add staff member
//  PUT    /api/staff/:id   — Update staff member
//  DELETE /api/staff/:id   — Remove staff member
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const { body, validationResult } = require('express-validator');
const supabase    = require('../lib/supabase');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg }); return false; }
  return true;
}

// ── GET /api/staff ────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('clinic_id', req.clinicId)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    res.json({ staff: data });
  } catch (err) { next(err); }
});

// ── GET /api/staff/:id ────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Staff member not found.' });
    res.json({ staff: data });
  } catch (err) { next(err); }
});

// ── POST /api/staff ───────────────────────────────────────────────────────────
const createRules = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('role').isIn(['dentist','hygienist','receptionist','assistant','manager','other'])
    .withMessage('Invalid role'),
  body('email').optional().isEmail().withMessage('Invalid email')
];

router.post('/', createRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { name, role, email, phone, schedule, specialization, joining_date } = req.body;

    const { data, error } = await supabase
      .from('staff')
      .insert({
        clinic_id    : req.clinicId,
        name,
        role,
        email        : email         || null,
        phone        : phone         || null,
        schedule     : schedule      || null,
        specialization: specialization || null,
        joining_date : joining_date  || null,
        is_active    : true
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'Staff member added.', staff: data });
  } catch (err) { next(err); }
});

// ── PUT /api/staff/:id ────────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['name','role','email','phone','schedule','specialization','joining_date','is_active'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('staff')
      .update(updates)
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Staff member not found.' });
    res.json({ message: 'Staff updated.', staff: data });
  } catch (err) { next(err); }
});

// ── DELETE /api/staff/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('staff')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId);

    if (error) throw error;
    res.json({ message: 'Staff member deactivated.' });
  } catch (err) { next(err); }
});

module.exports = router;
