const express     = require('express');
const { body, validationResult } = require('express-validator');
const supabase    = require('../lib/supabase');
const requireAuth = require('../middleware/auth');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg }); return false; }
  return true;
}

// ── GET /api/clinics/settings ────────────────────────────────────────────────
router.get('/settings', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('clinics')
      .select('name, email, phone, address, booking_slug, appointment_settings')
      .eq('id', req.clinicId)
      .single();

    if (error) throw error;
    res.json({ settings: data });
  } catch (err) { next(err); }
});

// ── PUT /api/clinics/settings ────────────────────────────────────────────────
const updateRules = [
  body('name').optional().trim().notEmpty(),
  body('phone').optional().trim(),
  body('address').optional().trim(),
  body('appointment_settings').optional().isObject()
];

router.put('/settings', requireAuth, updateRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const allowed = ['name', 'phone', 'address', 'appointment_settings'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('clinics')
      .update(updates)
      .eq('id', req.clinicId)
      .select('name, email, phone, address, booking_slug, appointment_settings')
      .single();

    if (error) throw error;
    res.json({ message: 'Settings updated.', settings: data });
  } catch (err) { next(err); }
});

module.exports = router;
