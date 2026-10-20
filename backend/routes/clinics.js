const express     = require('express');
const { body, validationResult } = require('express-validator');
const multer      = require('multer');
const supabase    = require('../lib/supabase');
const requireAuth = require('../middleware/auth');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg }); return false; }
  return true;
}

// Multer for clinic cover image uploads (memory storage → Supabase Storage)
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  }
});

// ── GET /api/clinics/settings ────────────────────────────────────────────────
// Returns all clinic fields including public marketplace profile fields
router.get('/settings', requireAuth, async (req, res, next) => {
  try {
    if (!req.clinicId) {
      return res.json({ settings: null });
    }
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
    
    const { logAuditEvent } = require('../lib/auditLogger');
    logAuditEvent('clinic.profile_updated', { clinicId: req.clinicId, userId: req.user.id });
    
    res.json({ message: 'Profile updated successfully.', settings: data });
  } catch (err) { next(err); }
});

// ── POST /api/clinics/request-deletion ────────────────────────────────────────
// Request account deletion (logged for security and manual processing)
router.post('/request-deletion', requireAuth, [
  body('reason').optional().trim().isLength({ max: 500 })
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { reason } = req.body;
    
    const { logAuditEvent } = require('../lib/auditLogger');
    logAuditEvent('clinic.deletion_requested', { clinicId: req.clinicId, userId: req.user.id, reason });
    
    // In a real flow, this might insert into an admin tasks table or send an email.
    res.json({ message: 'Account deletion request submitted. Our team will process this shortly.' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/clinics/upload-image ────────────────────────────────────────────
// Uploads a clinic cover/gallery image to Supabase Storage and returns the public URL
router.post('/upload-image', requireAuth, uploadImage.single('image'), async (req, res, next) => {
  try {
    if (!req.clinicId) return res.status(400).json({ error: 'Clinic context required.' });
    if (!req.file)     return res.status(400).json({ error: 'No image file provided.' });

    const ext      = req.file.originalname.split('.').pop().toLowerCase();
    const fileName = `${req.clinicId}/${Date.now()}_cover.${ext}`;

    // Upload to Supabase Storage (service-role bypasses RLS)
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('clinic_images')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true   // allow re-upload (overwrite old cover)
      });

    if (uploadErr) throw uploadErr;

    // Build public URL
    const { data: { publicUrl } } = supabase.storage
      .from('clinic_images')
      .getPublicUrl(uploadData.path);

    res.json({ url: publicUrl });
  } catch (err) { next(err); }
});

module.exports = router;
