const { createClient } = require('@supabase/supabase-js');

/**
 * Creates a Supabase client scoped to the authenticated user's JWT.
 * This ensures that Row-Level Security (RLS) policies are applied 
 * on the database level, preventing cross-tenant data leakage.
 * 
 * @param {string} accessToken - The user's Supabase JWT access token
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function createScopedClient(accessToken) {
  if (!accessToken) {
    throw new Error('Access token is required to create a scoped Supabase client');
  }

  // Use the ANON key here. The JWT token will identify the user and apply their RLS policies.
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: { persistSession: false }
  });
}

module.exports = {
  createScopedClient
};
