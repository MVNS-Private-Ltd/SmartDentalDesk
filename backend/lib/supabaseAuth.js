// ─────────────────────────────────────────────────────────────────────────────
//  supabaseAuth.js
//  Returns a fresh Supabase client instance using the ANON key.
//  Intended exclusively for user-facing auth operations (signInWithPassword,
//  signOut, etc.) so that session state from those operations NEVER bleeds into
//  the shared service-role DB client (lib/supabase.js).
// ─────────────────────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl  = process.env.SUPABASE_URL;
const anonKey      = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

/**
 * Returns a fresh, isolated Supabase client for a single auth operation.
 * Using a fresh instance per call avoids any in-memory session sharing
 * with the shared service-role DB client.
 */
function createAnonClient() {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

module.exports = { createAnonClient };
