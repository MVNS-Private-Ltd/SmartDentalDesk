// ─────────────────────────────────────────────────────────────────────────────
//  Auth Routes
//  POST /api/auth/register  — Create clinic + Supabase auth user
//  POST /api/auth/login     — Sign in, return access token
//  POST /api/auth/logout    — Invalidate session
//  GET  /api/auth/me        — Return current user + clinic info
// ─────────────────────────────────────────────────────────────────────────────
const express   = require('express');
const { body, validationResult } = require('express-validator');
const supabase  = require('../lib/supabase');
const requireAuth = require('../middleware/auth');
const { isSuperAdminUser } = require('../middleware/superAdmin');

const router = express.Router();

// ── Validation rules ──────────────────────────────────────────────────────────
const registerRules = [
  body('name').trim().notEmpty().withMessage('Full name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('clinic_name').optional().trim()
];

const loginRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
];

// ── Helper: extract validation errors ────────────────────────────────────────
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
    return false;
  }
  return true;
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', registerRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const { name, email, password, clinic_name, phone } = req.body;

    let userId;

    // 1. Create Supabase auth user
    const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true // auto-confirm for now (no email verification step)
    });

    if (signUpError) {
      if (signUpError.message.includes('already registered')) {
        // Attempt to self-heal orphaned accounts
        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        
        if (signInErr) {
           return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
        }
        
        userId = signInData.user.id;
        
        // Check if they already have a clinic
        const { data: existingClinic } = await supabase.from('clinics').select('id').eq('owner_id', userId).maybeSingle();
        if (existingClinic) {
           return res.status(409).json({ error: 'A clinic for this account already exists. Please sign in.' });
        }
        // Check if they are active staff
        const { data: existingStaff } = await supabase.from('staff').select('id').eq('auth_id', userId).eq('is_active', true).maybeSingle();
        if (existingStaff) {
           return res.status(409).json({ error: 'You are registered as staff. Please sign in.' });
        }
        
        // If they reach here, they have no clinic and no staff profile. 
        // We will proceed to create a clinic for this orphaned user.
      } else {
        throw signUpError;
      }
    } else {
      userId = authData.user.id;
    }

    // 2. Create clinic record linked to the auth user
    const crypto = require('crypto');
    const bookingSlug = crypto.randomBytes(3).toString('hex') + Math.random().toString(36).substring(2, 5); // e.g. a1b2c3d4

    const { data: clinic, error: clinicError } = await supabase
      .from('clinics')
      .insert({
        owner_id        : userId,
        owner_name      : name,
        name            : clinic_name || `${name}'s Clinic`,
        email,
        phone           : phone || null,
        subscription_plan: 'free',
        booking_slug    : bookingSlug
      })
      .select()
      .single();

    if (clinicError) {
      // Rollback: delete the auth user we just created (only if we created it just now)
      if (!signUpError) {
        await supabase.auth.admin.deleteUser(userId);
      }
      throw clinicError;
    }

    // 3. Sign in to get the session token (or just use the one we might have obtained)
    const { data: session, error: signInError2 } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInError2) throw signInError2;

    res.status(201).json({
      message      : 'Account created successfully!',
      access_token : session.session.access_token,
      refresh_token: session.session.refresh_token,
      user: {
        id    : userId,
        email,
        name
      },
      clinic: {
        id  : clinic.id,
        name: clinic.name
      }
    });

  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', loginRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        return res.status(401).json({ error: 'Incorrect email or password.' });
      }
      throw error;
    }

    let userRole = 'admin';
    const isSuperAdmin = isSuperAdminUser(data.user);
    if (isSuperAdmin) {
      userRole = 'super_admin';
    }

    // Fetch clinic info (Admin/Owner)
    let { data: clinic } = await supabase
      .from('clinics')
      .select('id, name, owner_name, subscription_plan')
      .eq('owner_id', data.user.id)
      .maybeSingle();

    // If not clinic owner and not super admin, check if they are staff
    let staff = null;
    if (!clinic && !isSuperAdmin) {
      const { data: staffData } = await supabase
        .from('staff')
        .select('*, clinics(id, name, owner_name, subscription_plan)')
        .eq('auth_id', data.user.id)
        .eq('is_active', true)
        .maybeSingle();
      
      if (!staffData || !staffData.clinics) {
        return res.status(403).json({ error: 'No active clinic or staff profile associated with this account.' });
      }
      clinic = staffData.clinics;
      userRole = staffData.role;
      staff = staffData;
    }

    res.json({
      message      : 'Signed in successfully!',
      access_token : data.session.access_token,
      refresh_token: data.session.refresh_token,
      role         : userRole,
      is_super_admin: isSuperAdmin,
      user: {
        id   : data.user.id,
        email: data.user.email,
        name : isSuperAdmin ? (clinic?.owner_name || 'Platform Super Admin') : (userRole === 'admin' ? (clinic?.owner_name || data.user.email) : (staff?.name || data.user.email))
      },
      clinic: clinic || null
    });

  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/oauth-session ──────────────────────────────────────────────
// Called after Google OAuth redirect — verifies the token, fetches or auto-creates
// the clinic record for first-time Google sign-ins, returns the standard session shape.
router.post('/oauth-session', async (req, res, next) => {
  try {
    const { access_token, refresh_token } = req.body;
    if (!access_token) {
      return res.status(400).json({ error: 'access_token is required.' });
    }

    // 1. Verify token with Supabase
    const { data: { user }, error: userErr } = await supabase.auth.getUser(access_token);
    if (userErr || !user) {
      return res.status(401).json({ error: 'Invalid or expired Google session.' });
    }

    // 2. Fetch existing clinic for this user
    let { data: clinic } = await supabase
      .from('clinics')
      .select('id, name, owner_name, subscription_plan')
      .eq('owner_id', user.id)
      .maybeSingle();

    // 3. If first-time Google login, auto-provision clinic record
    if (!clinic) {
      const googleName  = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
      const clinicName  = `${googleName}'s Dental Clinic`;

      const { data: newClinic, error: insertErr } = await supabase
        .from('clinics')
        .insert({
          owner_id         : user.id,
          name             : clinicName,
          owner_name       : googleName,
          email            : user.email,
          subscription_plan: 'free',
          appointment_settings: {
            slot_duration_minutes: 30,
            auto_approve         : false,
            time_slots           : [
              '09:00 AM','09:30 AM','10:00 AM','10:30 AM',
              '11:00 AM','11:30 AM','02:00 PM','02:30 PM',
              '03:00 PM','03:30 PM','04:00 PM','04:30 PM'
            ],
            max_bookings_per_day : 20
          }
        })
        .select('id, name, owner_name, subscription_plan')
        .single();

      if (insertErr) {
        console.error('[OAuth Session] Failed to auto-provision clinic:', insertErr);
        return res.status(500).json({ error: 'Could not set up clinic account. Please try again.' });
      }
      clinic = newClinic;
    }

    const isSuperAdmin = isSuperAdminUser(user);
    const role = isSuperAdmin ? 'super_admin' : 'admin';

    // 4. Return session payload
    res.json({
      message      : 'Signed in with Google!',
      access_token,
      refresh_token: refresh_token || null,
      role,
      is_super_admin: isSuperAdmin,
      user: {
        id   : user.id,
        email: user.email,
        name : isSuperAdmin ? (clinic?.owner_name || 'Platform Super Admin') : (clinic?.owner_name || user.email)
      },
      clinic
    });

  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    // Supabase service role client doesn't have a user session to sign out
    // The frontend simply discards the token — we return success
    res.json({ message: 'Signed out successfully.' });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    role: req.userRole,
    user: {
      id   : req.user.id,
      email: req.user.email,
      name : req.userRole === 'admin' ? (req.clinic?.owner_name || req.user.email) : (req.staff?.name || req.user.email)
    },
    clinic: req.clinic,
    staff : req.staff || null
  });
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────────
//  Sends a Supabase password-reset email to the given address.
//  Always responds 200 to prevent email-enumeration attacks.
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const { email }     = req.body;
    const redirectTo    = process.env.RESET_PASSWORD_REDIRECT;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      ...(redirectTo && { redirectTo })
    });

    if (error) throw error;

    // Always return success — never reveal whether the email exists
    res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────────
//  Verifies the Supabase recovery access_token from the reset-link hash and
//  updates the user's password.
router.post('/reset-password', [
  body('access_token').notEmpty().withMessage('Reset token is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const { access_token, password } = req.body;

    // Verify the recovery token and get the associated user
    const { data: { user }, error: userError } = await supabase.auth.getUser(access_token);
    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    // Update password via admin client (bypasses RLS)
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (updateError) throw updateError;

    res.json({ message: 'Password updated successfully! You can now sign in.' });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/google-url ──────────────────────────────────────────────────
// Returns the Supabase OAuth URL to initiate Google login securely
router.get('/google-url', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const redirectUri = process.env.OAUTH_REDIRECT || 'https://smart-dental-desk.vercel.app/login.html';
  
  if (!supabaseUrl) {
    return res.status(500).json({ error: 'Supabase URL not configured on server.' });
  }
  
  const url = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUri)}`;
  res.json({ url });
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
// Refreshes the Supabase access token securely from the backend
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ error: 'Refresh token is required.' });
    }

    // Using global fetch (Node 18+)
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ refresh_token }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
