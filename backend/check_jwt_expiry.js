require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

async function checkExpiry() {
  const email = `test_jwt_${Date.now()}@example.com`;
  const password = 'TestSecurePassword123!';
  let userId;
  
  try {
    const { data: authData, error: signUpErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true
    });
    if (signUpErr) throw signUpErr;
    userId = authData.user.id;

    const anonClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({ email, password });
    if (signInErr) throw signInErr;
    
    const token = signInData.session.access_token;
    
    const decoded = jwt.decode(token);
    
    if (decoded && decoded.exp && decoded.iat) {
      const lifetimeSeconds = decoded.exp - decoded.iat;
      console.log(`JWT_LIFETIME_SECONDS=${lifetimeSeconds}`);
    } else {
      console.log('Failed to decode JWT or missing claims.');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (userId) {
      await supabase.auth.admin.deleteUser(userId);
    }
  }
}

checkExpiry();
