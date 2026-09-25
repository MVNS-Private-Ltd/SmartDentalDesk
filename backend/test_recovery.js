require('dotenv').config();
const supabase = require('./lib/supabase');
const speakeasy = require('speakeasy');
const bcrypt = require('bcryptjs');

async function testRecoveryFlow() {
  console.log('--- Starting MFA Recovery Test ---');
  
  const email = 'test_recovery_' + Date.now() + '@example.com';
  const password = 'TestPassword123!';

  // 1. Create user
  console.log(`Creating test user: ${email}`);
  const { data: authData, error: signUpErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (signUpErr) throw signUpErr;
  const user = authData.user;

  // Sign in
  const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;
  const token = signInData.session.access_token;

  // 2. Setup MFA
  console.log('Setting up MFA...');
  const setupRes = await fetch('http://localhost:5000/api/auth/mfa/setup', {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json());
  
  const secret = setupRes.secret;
  
  const totp = speakeasy.totp({
    secret,
    encoding: 'base32'
  });

  // 3. Verify MFA (initial enrollment) - should return codes
  console.log('Verifying MFA (Initial)...');
  const verifyRes = await fetch('http://localhost:5000/api/auth/mfa/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ code: totp })
  });
  
  const verifyBody = await verifyRes.json();
  if (!verifyBody.recoveryCodes || verifyBody.recoveryCodes.length !== 10) {
    throw new Error('Did not receive 10 recovery codes on initial setup');
  }
  const codes = verifyBody.recoveryCodes;
  console.log(`Received 10 codes. Example: ${codes[0]}`);

  // 4. Test bad recovery code
  console.log('Testing bad recovery code login...');
  const badLoginRes = await fetch('http://localhost:5000/api/auth/login/recovery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, code: 'INVALID-CODE-000' })
  });
  if (badLoginRes.status !== 401) {
    throw new Error(`Expected 401 for bad code, got ${badLoginRes.status}`);
  }
  const badLoginBody = await badLoginRes.json();
  if (badLoginBody.session || badLoginBody.user) {
    throw new Error('Tokens leaked on failed recovery login!');
  }
  console.log('Bad recovery code correctly rejected without leaking session.');

  // 5. Test good recovery code
  console.log('Testing GOOD recovery code login...');
  const goodLoginRes = await fetch('http://localhost:5000/api/auth/login/recovery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, code: codes[0] })
  });
  if (goodLoginRes.status !== 200) {
    console.error(await goodLoginRes.json());
    throw new Error(`Expected 200 for good code, got ${goodLoginRes.status}`);
  }
  const goodLoginBody = await goodLoginRes.json();
  if (!goodLoginBody.session) {
    throw new Error('Did not receive final session on successful recovery login!');
  }
  console.log('Good recovery code accepted, new session issued.');

  // Verify the code is used
  const { data: dbCodes } = await supabase
    .from('mfa_recovery_codes')
    .select('*')
    .eq('auth_user_id', user.id)
    .not('used_at', 'is', null);
    
  if (dbCodes.length !== 1) {
    throw new Error('Recovery code was not marked as used in DB!');
  }
  console.log('Recovery code correctly marked as used.');

  // Cleanup
  console.log('Cleaning up test user...');
  await supabase.auth.admin.deleteUser(user.id);
  console.log('--- Test Complete & Successful ---');
}

testRecoveryFlow().catch(console.error);
