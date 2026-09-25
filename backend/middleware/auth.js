// ─────────────────────────────────────────────────────────────────────────────
//  Auth middleware — verifies Bearer JWT on every protected route
//  Attaches req.user, req.userRole, req.clinicId, req.clinic, req.staff
//
//  Decision flow:
//   1. Verify Supabase JWT — 401 if invalid/expired
//   2. Super-admin → skip clinic-state checks, next()
//   3. Clinic owner found → enforce is_active + suspended_at → 403 or next()
//   4. No owned clinic → query staff (full historical record, no is_active filter)
//      a. Staff row exists, is_active=false → 403 'Access denied.'
//      b. Staff row exists, is_active=true but clinic suspended → 403 'Access denied.'
//      c. Staff row exists, active + clinic active → next()
//      d. No staff row at all → 403 'Access denied.'  [auto-provision removed]
//
//  NOTE: requireAuth never creates any database rows. POST /api/auth/register
//  is the only route permitted to create a clinic.
// ─────────────────────────────────────────────────────────────────────────────
const supabase = require('../lib/supabase');
const { isSuperAdminUser } = require('./superAdmin');

// Generic denial — reveals nothing about why the request was denied.
const ACCESS_DENIED = { error: 'Access denied.' };

module.exports = async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7); // strip 'Bearer '

    // ── 1. Verify the Supabase access token ────────────────────────────────
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
    }

    // ── 2. Super-admin fast path (no clinic-state checks) ──────────────────
    const isSuperAdmin = isSuperAdminUser(user);
    if (isSuperAdmin) {
      req.user         = user;
      req.userRole     = 'super_admin';
      req.isSuperAdmin = true;
      req.clinicId     = null;
      req.clinic       = { id: null, name: 'SaaS Platform Control', owner_name: 'Platform Owner' };
      req.staff        = null;
      req.token        = token;
      return next();
    }

    // ── 3. Clinic owner / admin path ───────────────────────────────────────
    // Fetch the owned clinic with all security-relevant state columns.
    const { data: clinic } = await supabase
      .from('clinics')
      .select('id, name, owner_name, subscription_plan, is_active, suspended_at, suspension_reason')
      .eq('owner_id', user.id)
      .maybeSingle();

    if (clinic) {
      // Gate: clinic must be active and unsuspended.
      if (clinic.is_active === false || clinic.suspended_at !== null) {
        return res.status(403).json(ACCESS_DENIED);
      }

      req.user         = user;
      req.userRole     = 'admin';
      req.isSuperAdmin = false;
      req.clinicId     = clinic.id;
      req.clinic       = clinic;
      req.staff        = null;
      req.token        = token;
      return next();
    }

    // ── 4. Staff path ──────────────────────────────────────────────────────
    // Query WITHOUT is_active filter to capture historical/revoked records.
    const { data: staff } = await supabase
      .from('staff')
      .select('id, clinic_id, role, is_active, clinics(id, name, owner_name, subscription_plan, is_active, suspended_at)')
      .eq('auth_id', user.id)
      .maybeSingle();

    // 4a. Staff row exists but is offboarded/revoked — deny, no auto-provision.
    if (staff && staff.is_active === false) {
      return res.status(403).json(ACCESS_DENIED);
    }

    // 4b. Active staff but clinic is suspended/inactive — deny, no auto-provision.
    if (staff && staff.is_active === true) {
      const staffClinic = staff.clinics;
      if (!staffClinic || staffClinic.is_active === false || staffClinic.suspended_at !== null) {
        return res.status(403).json(ACCESS_DENIED);
      }

      // 4c. Active staff at an active, unsuspended clinic — allow.
      req.user         = user;
      req.userRole     = staff.role;
      req.isSuperAdmin = false;
      req.clinicId     = staffClinic.id;
      req.clinic       = staffClinic;
      req.staff        = staff;
      req.token        = token;
      return next();
    }

    // 4d. No staff row at all — deny. requireAuth never auto-provisions.
    //     POST /api/auth/register is the only route that creates a clinic.
    return res.status(403).json(ACCESS_DENIED);

  } catch (err) {
    console.error('[Auth Middleware Error]', err.message);
    return res.status(500).json({ error: 'Authentication check failed.' });
  }
};
