const { createClient } = require('@supabase/supabase-js');
const adminSupabase = require('./supabase');
const jwt = require('jsonwebtoken');
const { isSuperAdminUser } = require('../middleware/superAdmin');

/**
 * Creates a Supabase client scoped to the authenticated user's JWT.
 * This ensures that Row-Level Security (RLS) policies are applied 
 * on the database level, preventing cross-tenant data leakage.
 * 
 * If isSuperAdmin is true (or if caller is super admin / req object passed),
 * returns adminSupabase client with service-role permissions so platform owners
 * can manage and impersonate clinics without being blocked by tenant RLS.
 * 
 * @param {string|object} tokenOrReq - The user's Supabase JWT access token or Express req
 * @param {boolean} [isSuperAdmin] - Whether caller has super admin privileges
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function createScopedClient(tokenOrReq, isSuperAdmin = false) {
  // Support passing the express req object directly
  if (tokenOrReq && typeof tokenOrReq === 'object') {
    if (tokenOrReq.isSuperAdmin) return adminSupabase;
    return createScopedClient(tokenOrReq.token, false);
  }

  if (isSuperAdmin) {
    return adminSupabase;
  }

  const token = typeof tokenOrReq === 'string' ? tokenOrReq : null;
  if (!token) {
    throw new Error('Access token is required to create a scoped Supabase client');
  }

  // Inspect JWT to see if user is a Super Admin
  try {
    const decoded = jwt.decode(token);
    if (decoded && (isSuperAdminUser(decoded) || isSuperAdminUser({ email: decoded.email, user_metadata: decoded.user_metadata }))) {
      return adminSupabase;
    }
  } catch (_) {}

  // Use the ANON key here. The JWT token will identify the user and apply their RLS policies.
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    auth: { persistSession: false }
  });
}

module.exports = {
  createScopedClient
};
