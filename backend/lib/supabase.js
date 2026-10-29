// ─────────────────────────────────────────────────────────────────────────────
//  Supabase clients — shared singletons for the backend
//
//  supabase      → SERVICE ROLE client — bypasses RLS entirely.
//                  Use for all DB reads/writes. Never call .auth methods on
//                  this instance; doing so can pollute the shared session and
//                  cause subsequent queries to run as the authenticated user
//                  instead of service-role, making RLS fire unexpectedly.
//
//  supabaseAnon  → ANON client — subject to RLS.
//                  Use ONLY for Supabase Auth operations (signInWithOtp,
//                  verifyOtp, signOut, etc.) that need to run as the end-user.
// ─────────────────────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl     = process.env.SUPABASE_URL;
const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey         = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// ── Service-role client (bypasses RLS) ───────────────────────────────────────
// autoRefreshToken and persistSession MUST be false so the SDK never stores
// or replaces the service-role JWT with an end-user session.
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken : false,
    persistSession   : false,
    detectSessionInUrl: false,
  }
});

// ── Anon client (subject to RLS) ─────────────────────────────────────────────
// Used exclusively for Auth API calls (OTP send/verify) so that verifyOtp()
// never touches the service-role singleton and cannot pollute its auth state.
const supabaseAnon = anonKey
  ? createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken : false,
        persistSession   : false,
        detectSessionInUrl: false,
      }
    })
  : null;

module.exports = supabase;
module.exports.supabaseAnon = supabaseAnon;
