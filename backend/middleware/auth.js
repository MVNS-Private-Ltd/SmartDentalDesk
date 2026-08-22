// ─────────────────────────────────────────────────────────────────────────────
//  Auth middleware — verifies Bearer JWT on every protected route
//  Attaches req.user (Supabase auth user) and req.clinicId to the request
// ─────────────────────────────────────────────────────────────────────────────
const supabase = require('../lib/supabase');

module.exports = async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7); // strip 'Bearer '

    // Verify the Supabase access token and get the user
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
    }

    // Fetch the associated clinic for this user (Admin/Owner)
    let { data: clinic, error: clinicErr } = await supabase
      .from('clinics')
      .select('id, name, owner_name, subscription_plan')
      .eq('owner_id', user.id)
      .maybeSingle();

    let userRole = 'admin';

    // If not found in clinics, check if user is a staff member
    if (!clinic) {
      const { data: staff, error: staffErr } = await supabase
        .from('staff')
        .select('*, clinics(id, name, owner_name, subscription_plan)')
        .eq('auth_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      
      if (staffErr || !staff || !staff.clinics) {
        return res.status(403).json({ error: 'No active clinic or staff profile associated with this account.' });
      }
      clinic = staff.clinics;
      userRole = staff.role; // e.g., 'receptionist'
    }

    // Attach to request for use in route handlers
    req.user     = user;
    req.userRole = userRole;
    req.clinicId = clinic.id;
    req.clinic   = clinic;
    req.staff    = (userRole !== 'admin' && staff) ? staff : null;

    next();
  } catch (err) {
    console.error('[Auth Middleware Error]', err);
    return res.status(500).json({ error: 'Authentication check failed.' });
  }
};
