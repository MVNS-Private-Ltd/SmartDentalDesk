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
const { createAnonClient } = require('../lib/supabaseAuth');
const requireAuth = require('../middleware/auth');
const { isSuperAdminUser } = require('../middleware/superAdmin');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { sendMail } = require('../lib/mailer');

// ── Rate Limiters & Helpers ───────────────────────────────────────────────────
const recoveryLimiterIP = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many recovery attempts from this IP. Please try again later.' }
});

const recoveryLimiterEmail = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.body.email?.toLowerCase().trim() || 'unknown',
  message: { error: 'Too many recovery attempts for this account. Please try again later.' }
});

function generateRecoveryCodes(count = 10) {
  const codes = [];
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excludes 0, O, 1, I, l
  while (codes.length < count) {
    let code = '';
    while (code.length < 12) {
      const bytes = crypto.randomBytes(12);
      for (let i = 0; i < bytes.length; i++) {
        if (code.length < 12) {
          code += chars[bytes[i] % chars.length];
        }
      }
    }
    code = `${code.slice(0,4)}-${code.slice(4,8)}-${code.slice(8,12)}`;
    codes.push(code);
  }
  return codes;
}

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

    // 3. Auto-provision 3-Month Free Trial subscription + credits for the new clinic
    //    This ensures new signups never get stuck on pricing.html with no subscription.
    try {
      const trialStart = new Date();
      const trialEnd = new Date();
      trialEnd.setMonth(trialEnd.getMonth() + 3);

      await supabase.from('subscriptions').upsert({
        clinic_id:                clinic.id,
        plan:                     'premium',
        status:                   'trialing',
        billing_cycle:            'monthly',
        provider_subscription_id: `sub_trial_${clinic.id.slice(0, 8)}`,
        trial_start_at:           trialStart.toISOString(),
        trial_ends_at:            trialEnd.toISOString(),
        current_period_start:     trialStart.toISOString(),
        current_period_end:       trialEnd.toISOString(),
        updated_at:               trialStart.toISOString()
      }, { onConflict: 'clinic_id' });

      await supabase.from('clinic_credits').upsert({
        clinic_id:         clinic.id,
        credits_allocated: 10000,
        credits_used:      0,
        period_start:      trialStart.toISOString(),
        period_end:        trialEnd.toISOString(),
        updated_at:        trialStart.toISOString()
      }, { onConflict: 'clinic_id' });

      // Update clinic plan to premium (trial)
      await supabase.from('clinics').update({
        subscription_plan:     'premium',
        is_marketplace_listed: true
      }).eq('id', clinic.id);

    } catch (trialErr) {
      // Non-fatal — log but don't fail registration
      console.error('[Register] Failed to auto-provision trial:', trialErr.message);
    }

    // 4. Sign in to get the session token (or just use the one we might have obtained)
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

    let userName = isSuperAdmin ? (clinic?.owner_name || 'Platform Super Admin') : (userRole === 'admin' ? (clinic?.owner_name || data.user.email) : (staff?.name || data.user.email));

    // --- MFA CHECK ---
    if (userRole === 'super_admin' || userRole === 'admin') {
      const { data: security } = await supabase
        .from('user_security')
        .select('*')
        .eq('auth_user_id', data.user.id)
        .maybeSingle();

      if (security && security.mfa_enabled && security.mfa_verified) {
        // Issue temporary MFA token instead of full session
        const mfaToken = jwt.sign(
          { 
            userId: data.user.id,
            access_token: data.session.access_token, 
            refresh_token: data.session.refresh_token,
            role: userRole,
            isSuperAdmin,
            user: { id: data.user.id, email: data.user.email, name: userName },
            clinic: clinic || null
          }, 
          process.env.JWT_SECRET, 
          { expiresIn: '5m' }
        );
        return res.json({ mfa_required: true, mfa_token: mfaToken });
      }
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
        name : userName
      },
      clinic: clinic || null
    });

  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login/mfa ──────────────────────────────────────────────────
router.post('/login/mfa', async (req, res, next) => {
  try {
    const { mfa_token, code } = req.body;
    if (!mfa_token || !code) return res.status(400).json({ error: 'Token and code required' });

    const decoded = jwt.verify(mfa_token, process.env.JWT_SECRET);
    
    const { data: security } = await supabase
      .from('user_security')
      .select('mfa_secret')
      .eq('auth_user_id', decoded.userId)
      .single();

    if (!security || !security.mfa_secret) return res.status(400).json({ error: 'MFA not configured' });

    const verified = speakeasy.totp.verify({
      secret: security.mfa_secret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!verified) return res.status(401).json({ error: 'Invalid MFA code' });

    res.json({
      message: 'Signed in successfully!',
      access_token: decoded.access_token,
      refresh_token: decoded.refresh_token,
      role: decoded.role,
      is_super_admin: decoded.isSuperAdmin,
      user: decoded.user,
      clinic: decoded.clinic
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'MFA session expired. Please sign in again.' });
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
      const crypto      = require('crypto');
      const bookingSlug = crypto.randomBytes(3).toString('hex') + Math.random().toString(36).substring(2, 5);

      const { data: newClinic, error: insertErr } = await supabase
        .from('clinics')
        .insert({
          owner_id         : user.id,
          name             : clinicName,
          owner_name       : googleName,
          email            : user.email,
          booking_slug     : bookingSlug,
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
        console.error('[OAuth Session] Failed to auto-provision clinic:', insertErr.message, insertErr.details, insertErr.code);
        return res.status(500).json({
          error: 'Could not set up clinic account. Please try again.',
          detail: process.env.NODE_ENV === 'development' ? insertErr.message : undefined
        });
      }
      clinic = newClinic;

      // Auto-provision 3-month free trial (same as register route)
      try {
        const trialStart = new Date();
        const trialEnd   = new Date();
        trialEnd.setMonth(trialEnd.getMonth() + 3);

        await supabase.from('subscriptions').upsert({
          clinic_id                : clinic.id,
          plan                     : 'premium',
          status                   : 'trialing',
          billing_cycle            : 'monthly',
          provider_subscription_id : `sub_trial_${clinic.id.slice(0, 8)}`,
          trial_start_at           : trialStart.toISOString(),
          trial_ends_at            : trialEnd.toISOString(),
          current_period_start     : trialStart.toISOString(),
          current_period_end       : trialEnd.toISOString(),
          updated_at               : trialStart.toISOString()
        }, { onConflict: 'clinic_id' });

        await supabase.from('clinic_credits').upsert({
          clinic_id        : clinic.id,
          credits_allocated: 10000,
          credits_used     : 0,
          period_start     : trialStart.toISOString(),
          period_end       : trialEnd.toISOString(),
          updated_at       : trialStart.toISOString()
        }, { onConflict: 'clinic_id' });

        await supabase.from('clinics').update({
          subscription_plan    : 'premium',
          is_marketplace_listed: true
        }).eq('id', clinic.id);

      } catch (trialErr) {
        console.error('[OAuth Session] Failed to auto-provision trial:', trialErr.message);
      }
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

// ── GET /api/auth/mfa/setup ───────────────────────────────────────────────────
router.get('/mfa/setup', requireAuth, async (req, res, next) => {
  try {
    const secret = speakeasy.generateSecret({ name: `SmartDentalDesk (${req.user.email})` });
    
    await supabase.from('user_security').upsert({
      auth_user_id: req.user.id,
      mfa_secret: secret.base32,
      mfa_enabled: false,
      mfa_verified: false,
      updated_at: new Date().toISOString()
    });

    qrcode.toDataURL(secret.otpauth_url, (err, data_url) => {
      if (err) throw err;
      res.json({ secret: secret.base32, qrCode: data_url });
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/mfa/verify ─────────────────────────────────────────────────
router.post('/mfa/verify', requireAuth, async (req, res, next) => {
  try {
    const { code } = req.body;
    
    const { data: security } = await supabase
      .from('user_security')
      .select('mfa_secret, mfa_enabled, mfa_verified')
      .eq('auth_user_id', req.user.id)
      .single();

    if (!security || !security.mfa_secret) return res.status(400).json({ error: 'MFA not configured' });

    const verified = speakeasy.totp.verify({
      secret: security.mfa_secret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!verified) return res.status(400).json({ error: 'Invalid MFA code' });

    const isInitialEnrollment = !security.mfa_enabled;

    await supabase.from('user_security').update({
      mfa_enabled: true,
      mfa_verified: true,
      updated_at: new Date().toISOString()
    }).eq('auth_user_id', req.user.id);

    let recoveryCodes = undefined;
    if (isInitialEnrollment) {
      const plainCodes = generateRecoveryCodes(10);
      recoveryCodes = plainCodes; // only return this once
      
      const insertData = plainCodes.map(c => {
        const hash = bcrypt.hashSync(c, 10);
        return {
          auth_user_id: req.user.id,
          code_hash: hash
        };
      });

      // Insert hashes via service_role client to bypass RLS
      const { error: insertErr } = await supabase.from('mfa_recovery_codes').insert(insertData);
      if (insertErr) console.error('[MFA Setup] Error inserting recovery codes:', insertErr);

      await sendMail({
        to: req.user.email,
        subject: 'MFA Enabled & Recovery Codes Generated',
        text: 'Multi-Factor Authentication is now enabled for your account. Please ensure you have securely saved your new recovery codes. They will only be shown to you once.'
      }).catch(err => console.error('[Email] Failed to send MFA enrollment email', err));
    }

    res.json({ 
      message: 'MFA verified successfully!',
      ...(recoveryCodes && { recoveryCodes })
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/login/recovery ─────────────────────────────────────────────
router.post('/login/recovery', recoveryLimiterIP, recoveryLimiterEmail, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  body('code').notEmpty().trim().withMessage('Recovery code is required')
], async (req, res, next) => {
  const genericError = 'Invalid email, password, or recovery code, or MFA is disabled.';
  try {
    if (!validate(req, res)) return;
    const { email, password, code } = req.body;

    // 1. Verify email/password via a FRESH isolated anon client.
    //    NEVER use the shared service-role supabase singleton for signInWithPassword:
    //    calling it would overwrite the singleton's in-memory auth session, causing
    //    all subsequent supabase.from() calls to run as the USER (RLS applies)
    //    instead of as service_role (RLS bypassed).
    const authClient = createAnonClient();
    const { data: authData, error: authErr } = await authClient.auth.signInWithPassword({ email, password });
    
    // We do NOT return if authErr immediately; we must always respond generic
    if (authErr) {
      console.warn(`[Recovery Login] Credential failure for ${email}: ${authErr.message}`);
      return res.status(401).json({ error: genericError });
    }

    const userId = authData.user.id;

    // Helper to safely fail and sign out temp session
    const failSafe = async (msg) => {
      console.warn(`[Recovery Login] ${msg} for ${email}`);
      await supabase.auth.admin.signOut(userId, 'global');
      return res.status(401).json({ error: genericError });
    };

    // 2. Lookup and verify the recovery code hash
    const { data: security } = await supabase
      .from('user_security')
      .select('mfa_enabled, mfa_verified')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (!security || !security.mfa_enabled) {
      return failSafe('MFA not enabled/enrolled');
    }

    // Fetch unused recovery codes via service role
    const { data: codes, error: codesErr } = await supabase
      .from('mfa_recovery_codes')
      .select('id, code_hash')
      .eq('auth_user_id', userId)
      .is('used_at', null)
      .is('revoked_at', null);

    if (codesErr || !codes || codes.length === 0) {
      return failSafe('No active recovery codes found');
    }

    let matchedCode = null;
    for (const row of codes) {
      if (bcrypt.compareSync(code, row.code_hash)) {
        matchedCode = row;
        break;
      }
    }

    if (!matchedCode) {
      return failSafe('Invalid recovery code provided');
    }

    // 3. Atomically mark code used and reset MFA
    const { error: markErr } = await supabase
      .from('mfa_recovery_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', matchedCode.id)
      .is('used_at', null); // Optimistic locking

    if (markErr) {
      return failSafe('Failed to atomic update code');
    }

    await supabase
      .from('user_security')
      .update({
        mfa_secret: null,
        mfa_enabled: false,
        mfa_verified: false,
        updated_at: new Date().toISOString()
      })
      .eq('auth_user_id', userId);

    // 4. Revoke EVERY existing session globally
    await supabase.auth.admin.signOut(userId, 'global');

    // 5. Issue fresh final session using another isolated anon client.
    //    Again: NEVER reuse the service-role singleton for signInWithPassword.
    const finalAuthClient = createAnonClient();
    const { data: finalAuth, error: finalAuthErr } = await finalAuthClient.auth.signInWithPassword({ email, password });
    if (finalAuthErr) {
      // Very unlikely since we just verified
      console.error('[Recovery Login] Final session issue failed', finalAuthErr);
      return res.status(500).json({ error: 'Failed to issue final session.' });
    }

    // Emit Audit Log
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || null;
    const { data: clinic } = await supabase.from('clinics').select('id').eq('owner_id', userId).maybeSingle();
    const clinicId = clinic?.id || null;

    if (clinicId) {
      await supabase.from('audit_logs').insert({
        clinic_id: clinicId,
        user_id: userId,
        action: 'MFA_RECOVERY_LOGIN',
        entity: 'mfa_recovery_codes',
        entity_id: matchedCode.id, // Only storing ID, NOT the code itself
        ip_address: ip,
        metadata: {
          note: 'MFA reset via recovery code. Old sessions revoked.'
        }
      });
    }

    // Send email
    await sendMail({
      to: finalAuth.user.email,
      subject: 'Security Alert: MFA Recovery Code Used',
      text: 'A recovery code was just used to log into your account. Multi-Factor Authentication has been disabled, and all previous active sessions have been revoked. Please log in and re-enroll in MFA immediately.'
    }).catch(err => console.error('[Email] Failed to send recovery email', err));

    res.json({
      message: 'Recovery successful. MFA has been disabled. All previous sessions revoked.',
      user: finalAuth.user,
      session: finalAuth.session // The fresh final session
    });

  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/mfa/recovery-codes ─────────────────────────────────────────
router.post('/mfa/recovery-codes', recoveryLimiterIP, requireAuth, [
  body('code').notEmpty().withMessage('Current TOTP code is required for regeneration')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { code } = req.body;
    const userId = req.user.id;

    // 1. Verify fresh TOTP proof
    const { data: security } = await supabase
      .from('user_security')
      .select('mfa_secret, mfa_enabled')
      .eq('auth_user_id', userId)
      .single();

    if (!security || !security.mfa_enabled || !security.mfa_secret) {
      return res.status(400).json({ error: 'MFA is not enabled for this account' });
    }

    const verified = speakeasy.totp.verify({
      secret: security.mfa_secret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!verified) {
      return res.status(401).json({ error: 'Invalid MFA code' });
    }

    // 2. Atomically revoke old unused codes
    await supabase
      .from('mfa_recovery_codes')
      .update({ revoked_at: new Date().toISOString() })
      .eq('auth_user_id', userId)
      .is('used_at', null)
      .is('revoked_at', null);

    // 3. Generate and store 10 new codes
    const plainCodes = generateRecoveryCodes(10);
    const insertData = plainCodes.map(c => {
      const hash = bcrypt.hashSync(c, 10);
      return {
        auth_user_id: userId,
        code_hash: hash
      };
    });

    const { error: insertErr } = await supabase.from('mfa_recovery_codes').insert(insertData);
    if (insertErr) throw insertErr;

    // Audit log
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || null;
    const clinicId = req.clinicId;
    if (clinicId) {
      await supabase.from('audit_logs').insert({
        clinic_id: clinicId,
        user_id: userId,
        action: 'MFA_RECOVERY_REGENERATED',
        entity: 'mfa_recovery_codes',
        entity_id: userId, 
        ip_address: ip,
        metadata: {
          note: 'New recovery codes generated. Old unused codes revoked.'
        }
      });
    }

    // Email
    await sendMail({
      to: req.user.email,
      subject: 'MFA Recovery Codes Regenerated',
      text: 'You have successfully generated a new set of MFA recovery codes. Your old unused codes have been revoked.'
    }).catch(err => console.error('[Email] Failed to send regen email', err));

    // Return once
    res.json({
      message: 'Recovery codes regenerated successfully',
      recoveryCodes: plainCodes
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
