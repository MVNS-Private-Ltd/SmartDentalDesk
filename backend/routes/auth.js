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

    // 1. Create Supabase auth user
    const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true // auto-confirm for now (no email verification step)
    });

    if (signUpError) {
      if (signUpError.message.includes('already registered')) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      throw signUpError;
    }

    const userId = authData.user.id;

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
      // Rollback: delete the auth user we just created
      await supabase.auth.admin.deleteUser(userId);
      throw clinicError;
    }

    // 3. Sign in to get the session token
    const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInError) throw signInError;

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

    // Fetch clinic info
    const { data: clinic } = await supabase
      .from('clinics')
      .select('id, name, owner_name, subscription_plan')
      .eq('owner_id', data.user.id)
      .single();

    res.json({
      message      : 'Signed in successfully!',
      access_token : data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id   : data.user.id,
        email: data.user.email,
        name : clinic?.owner_name || data.user.email
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

    // Verify the token with Supabase and get the user
    const { data: { user }, error: userError } = await supabase.auth.getUser(access_token);
    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid or expired Google token.' });
    }

    // Try to fetch an existing clinic for this user
    let { data: clinic } = await supabase
      .from('clinics')
      .select('id, name, owner_name, subscription_plan')
      .eq('owner_id', user.id)
      .single();

    // First-time Google sign-in: auto-create a clinic record
    if (!clinic) {
      const crypto = require('crypto');
      const bookingSlug = crypto.randomBytes(3).toString('hex') + Math.random().toString(36).substring(2, 5);
      const displayName = user.user_metadata?.full_name || user.email.split('@')[0];

      const { data: newClinic, error: clinicError } = await supabase
        .from('clinics')
        .insert({
          owner_id         : user.id,
          owner_name       : displayName,
          name             : `${displayName}'s Clinic`,
          email            : user.email,
          phone            : null,
          subscription_plan: 'free',
          booking_slug     : bookingSlug
        })
        .select('id, name, owner_name, subscription_plan')
        .single();

      if (clinicError) throw clinicError;
      clinic = newClinic;
    }

    res.json({
      message      : 'Signed in with Google successfully!',
      access_token,
      refresh_token : refresh_token || null,
      user: {
        id   : user.id,
        email: user.email,
        name : clinic.owner_name
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
    user: {
      id   : req.user.id,
      email: req.user.email,
      name : req.clinic.owner_name
    },
    clinic: req.clinic
  });
});

module.exports = router;
