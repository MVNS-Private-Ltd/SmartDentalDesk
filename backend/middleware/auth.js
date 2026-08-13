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

    // Fetch the associated clinic for this user
    const { data: clinic, error: clinicErr } = await supabase
      .from('clinics')
      .select('id, name, owner_name, subscription_plan')
      .eq('owner_id', user.id)
      .single();

    if (clinicErr || !clinic) {
      return res.status(403).json({ error: 'No clinic associated with this account.' });
    }

    // Attach to request for use in route handlers
    req.user     = user;
    req.clinicId = clinic.id;
    req.clinic   = clinic;

    next();
  } catch (err) {
    console.error('[Auth Middleware Error]', err);
    return res.status(500).json({ error: 'Authentication check failed.' });
  }
};
