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
// Returns all clinic fields including public marketplace profile fields
router.get('/settings', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('clinics')
      .select(`
        name, owner_name, email, phone, address, booking_slug,
        appointment_settings,
        about, city, area, pincode,
        specialties, services_offered, images, cover_image,
        timings, experience_years, price_range,
        is_verified, is_featured, is_active,
        amenities, subscription_plan, created_at
      `)
      .eq('id', req.clinicId)
      .single();

    if (error) throw error;
    res.json({ settings: data });
  } catch (err) { next(err); }
});

// ── PUT /api/clinics/settings ────────────────────────────────────────────────
// Accepts all editable clinic profile fields including marketplace ones
const updateRules = [
  body('name').optional().trim().notEmpty().withMessage('Clinic name cannot be empty'),
  body('phone').optional().trim(),
  body('address').optional().trim(),
  body('about').optional().trim().isLength({ max: 2000 }).withMessage('About must be under 2000 characters'),
  body('city').optional().trim(),
  body('area').optional().trim(),
  body('pincode').optional().trim(),
  body('cover_image').optional().trim(),
  body('timings').optional().trim(),
  body('experience_years').optional().isInt({ min: 0, max: 100 }).withMessage('Experience must be 0-100 years'),
  body('price_range').optional().isIn(['₹', '₹₹', '₹₹₹']).withMessage('Invalid price range'),
  body('specialties').optional().isArray().withMessage('Specialties must be an array'),
  body('services_offered').optional().isArray().withMessage('Services must be an array'),
  body('images').optional().isArray().withMessage('Images must be an array'),
  body('amenities').optional().isArray().withMessage('Amenities must be an array'),
  body('appointment_settings').optional().isObject().withMessage('Appointment settings must be an object'),
];

router.put('/settings', requireAuth, updateRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const allowed = [
      'name', 'phone', 'address', 'appointment_settings',
      'about', 'city', 'area', 'pincode',
      'cover_image', 'timings', 'experience_years', 'price_range',
      'specialties', 'services_offered', 'images', 'amenities'
    ];

    const updates = {};
    allowed.forEach(k => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('clinics')
      .update(updates)
      .eq('id', req.clinicId)
      .select(`
        name, owner_name, email, phone, address, booking_slug,
        appointment_settings,
        about, city, area, pincode,
        specialties, services_offered, images, cover_image,
        timings, experience_years, price_range,
        is_verified, is_featured, amenities
      `)
      .single();

    if (error) throw error;
    res.json({ message: 'Profile updated successfully.', settings: data });
  } catch (err) { next(err); }
});

module.exports = router;
