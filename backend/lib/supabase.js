// ─────────────────────────────────────────────────────────────────────────────
//  Supabase client — shared singleton for the backend
//  Uses the SERVICE ROLE key — never expose this to the browser!
// ─────────────────────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl     = process.env.SUPABASE_URL;
const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// Service-role client: bypasses RLS — use for server-side operations only
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

module.exports = supabase;
