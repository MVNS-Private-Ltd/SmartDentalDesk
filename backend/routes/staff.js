// ─────────────────────────────────────────────────────────────────────────────
//  Staff Routes
//  GET    /api/staff       — List staff members for current clinic
//  GET    /api/staff/:id   — Single staff member details
//  POST   /api/staff       — Add staff member (with optional dashboard login)
//  PUT    /api/staff/:id   — Update staff member (profile, role, or password)
//  DELETE /api/staff/:id   — Delete staff member & invalidate login
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const { body, validationResult } = require('express-validator');
const supabase    = require('../lib/supabase');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Only clinic admins/owners (and super admins) may modify staff
function adminOnly(req, res, next) {
  if (req.userRole !== 'admin' && req.userRole !== 'super_admin') {
    return res.status(403).json({ error: 'Only clinic administrators can manage staff.' });
  }
  next();
}

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { 
    res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() }); 
    return false; 
  }
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
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ staff: data || [] });
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
  body('name').trim().notEmpty().withMessage('Full name is required'),
  body('role').isIn(['dentist','hygienist','receptionist','assistant','manager','other'])
    .withMessage('Valid role is required'),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').optional({ checkFalsy: true }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];

router.post('/', adminOnly, createRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { name, role, email, phone, schedule, specialization, joining_date, password } = req.body;

    const trimmedEmail = email ? email.trim() : null;
    const trimmedPass = password ? password.trim() : null;

    if (trimmedPass && !trimmedEmail) {
      return res.status(400).json({ error: 'Email address is required when setting up dashboard login access.' });
    }

    let authId = null;

    // If an email and password are provided, create an auth user for login
    if (trimmedEmail && trimmedPass) {
      const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
        email: trimmedEmail,
        password: trimmedPass,
        email_confirm: true,
        user_metadata: { name: name.trim(), role: role }
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered') || signUpError.message.includes('already exists')) {
          return res.status(409).json({ error: 'An account with this email already exists in the system.' });
        }
        throw signUpError;
      }
      authId = authData.user.id;
    }

    const { data, error } = await supabase
      .from('staff')
      .insert({
        clinic_id     : req.clinicId,
        auth_id       : authId,
        name          : name.trim(),
        role          : role,
        email         : trimmedEmail,
        phone         : phone ? phone.trim() : null,
        schedule      : schedule ? schedule.trim() : null,
        specialization: specialization ? specialization.trim() : null,
        joining_date  : joining_date || null,
        is_active     : true
      })
      .select()
      .single();

    if (error) {
      // If db insert failed and auth user was created, clean up orphaned auth user
      if (authId) {
        try { await supabase.auth.admin.deleteUser(authId); } catch (e) { /* ignore cleanup error */ }
      }
      console.error('Failed to create staff record:', error);
      throw error;
    }

    res.status(201).json({ 
      message: 'Staff member added successfully.', 
      staff: data,
      has_login: !!authId
    });
  } catch (err) { next(err); }
});

// ── PUT /api/staff/:id ────────────────────────────────────────────────────────
router.put('/:id', adminOnly, async (req, res, next) => {
  try {
    const { name, role, email, phone, schedule, specialization, joining_date, is_active, password } = req.body;

    // 1. Fetch current staff record
    const { data: currentStaff, error: fetchErr } = await supabase
      .from('staff')
      .select('*')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (fetchErr || !currentStaff) {
      return res.status(404).json({ error: 'Staff member not found.' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (role !== undefined) updates.role = role;
    if (email !== undefined) updates.email = email ? email.trim() : null;
    if (phone !== undefined) updates.phone = phone ? phone.trim() : null;
    if (schedule !== undefined) updates.schedule = schedule ? schedule.trim() : null;
    if (specialization !== undefined) updates.specialization = specialization ? specialization.trim() : null;
    if (joining_date !== undefined) updates.joining_date = joining_date || null;
    if (is_active !== undefined) updates.is_active = is_active;
    updates.updated_at = new Date().toISOString();

    const targetEmail = updates.email !== undefined ? updates.email : currentStaff.email;

    // 2. Handle Password / Login updates
    if (password && password.trim().length >= 6) {
      if (!targetEmail) {
        return res.status(400).json({ error: 'An email is required to configure dashboard login.' });
      }

      if (currentStaff.auth_id) {
        // Update existing auth user
        const { error: authUpdateErr } = await supabase.auth.admin.updateUserById(currentStaff.auth_id, {
          password: password.trim(),
          email: targetEmail
        });
        if (authUpdateErr) throw authUpdateErr;
      } else {
        // Create new auth user
        const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
          email: targetEmail,
          password: password.trim(),
          email_confirm: true,
          user_metadata: { name: updates.name || currentStaff.name, role: updates.role || currentStaff.role }
        });
        if (signUpError) {
          if (signUpError.message.includes('already registered')) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
          }
          throw signUpError;
        }
        updates.auth_id = authData.user.id;
      }
    } else if (password && password.trim().length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // 3. Update staff in database
    const { data: updatedStaff, error: updateErr } = await supabase
      .from('staff')
      .update(updates)
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    res.json({ message: 'Staff member updated successfully.', staff: updatedStaff });
  } catch (err) { next(err); }
});

// ── DELETE /api/staff/:id ─────────────────────────────────────────────────────
router.delete('/:id', adminOnly, async (req, res, next) => {
  try {
    // 1. Fetch staff to check for auth_id
    const { data: staff, error: fetchErr } = await supabase
      .from('staff')
      .select('id, auth_id')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (fetchErr || !staff) {
      return res.status(404).json({ error: 'Staff member not found.' });
    }

    // 2. Remove auth user if present
    if (staff.auth_id) {
      try {
        await supabase.auth.admin.deleteUser(staff.auth_id);
      } catch (authErr) {
        console.warn('Could not delete auth user for staff:', authErr.message);
      }
    }

    // 3. Delete staff record
    const { error: delErr } = await supabase
      .from('staff')
      .delete()
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId);

    if (delErr) throw delErr;

    res.json({ message: 'Staff member removed successfully.' });
  } catch (err) { next(err); }
});

module.exports = router;
