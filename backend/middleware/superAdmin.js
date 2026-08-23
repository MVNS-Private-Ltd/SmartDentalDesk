// ─────────────────────────────────────────────────────────────────────────────
//  Super Admin Middleware
//  Verifies that the incoming request is from an authorized SaaS Platform Owner
// ─────────────────────────────────────────────────────────────────────────────
const supabase = require('../lib/supabase');

function getSuperAdminEmails() {
  const envEmails = process.env.SUPER_ADMIN_EMAILS || 'mayank557sharma@gmail.com';
  return envEmails
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

function isSuperAdminUser(user) {
  if (!user || !user.email) return false;
  const userEmail = user.email.toLowerCase().trim();
  const allowed = getSuperAdminEmails();
  
  if (allowed.includes(userEmail)) return true;
  if (user.user_metadata?.role === 'super_admin') return true;
  return false;
}

module.exports = async function requireSuperAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);

    // Verify the token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    }

    if (!isSuperAdminUser(user)) {
      return res.status(403).json({
        error: 'Forbidden: You do not have Super Admin / Platform Owner privileges.'
      });
    }

    req.user = user;
    req.isSuperAdmin = true;
    req.userRole = 'super_admin';

    next();
  } catch (err) {
    console.error('[Super Admin Auth Error]', err);
    return res.status(500).json({ error: 'Super Admin authentication verification failed.' });
  }
};

module.exports.isSuperAdminUser = isSuperAdminUser;
module.exports.getSuperAdminEmails = getSuperAdminEmails;
