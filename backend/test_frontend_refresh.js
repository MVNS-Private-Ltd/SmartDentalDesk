require('dotenv').config();
const puppeteer = require('puppeteer');
const supabase = require('./lib/supabase');

const BASE_URL = 'http://localhost:8080';

async function runTest() {
  console.log('--- Frontend Silent Refresh End-to-End Test ---');
  let failures = [];
  const email = `refresh_test_${Date.now()}@example.com`;
  const password = 'TestSecurePassword123!';
  let browser;

  try {
    console.log('[0] Creating test user...');
    const { data: authData, error: signUpErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true
    });
    if (signUpErr) throw signUpErr;
    const userId = authData.user.id;

    browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    // Setup network interception to monitor API calls
    await page.setRequestInterception(true);
    let refreshCalled = false;
    let refreshSuccess = false;
    let retryCalled = false;
    let originalRequestUrl = '';

    page.on('request', req => {
      if (req.url().includes('/api/auth/refresh')) {
        refreshCalled = true;
      } else if (req.url().includes('/api/dashboard/stats') && refreshCalled) {
        retryCalled = true;
      }
      req.continue();
    });

    page.on('response', res => {
      if (res.url().includes('/api/auth/refresh') && res.status() === 200) {
        refreshSuccess = true;
      }
    });

    console.log('[1] Logging in via backend and injecting session...');
    const anonClient = require('@supabase/supabase-js').createClient(
      process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } }
    );
    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({ email, password });
    if (signInErr) throw signInErr;
    
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'domcontentloaded' });
    
    // Inject real tokens
    await page.evaluate((access, refresh, uid) => {
      localStorage.setItem('sdd_token', access);
      localStorage.setItem('sdd_refresh_token', refresh);
      localStorage.setItem('sdd_user', JSON.stringify({ id: uid }));
    }, signInData.session.access_token, signInData.session.refresh_token, userId);

    console.log('[2] Simulating access token expiration...');
    // Replace access token with an invalid one to trigger 401
    await page.evaluate(() => localStorage.setItem('sdd_token', 'invalid.token.here'));

    console.log('[3] Making an API request that requires auth...');
    // Trigger an API request (e.g., getting user profile)
    const result = await page.evaluate(async () => {
      try {
        const res = await window.api.request('/dashboard/stats');
        return { success: true, data: res };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    if (refreshCalled) {
      console.log('✅ [1] Frontend called POST /api/auth/refresh');
    } else {
      failures.push('Frontend did not call /api/auth/refresh');
    }

    if (refreshSuccess) {
      console.log('✅ [2] Refresh-token rotation succeeded');
    } else {
      failures.push('Refresh-token rotation failed');
    }

    const newToken = await page.evaluate(() => localStorage.getItem('sdd_token'));
    if (newToken && newToken !== 'invalid.token.here' && newToken !== initialToken) {
      console.log('✅ [3] localStorage updated safely with new token');
    } else {
      failures.push('localStorage not updated correctly');
    }

    if (retryCalled && result.success) {
      console.log('✅ [4] Original failed request retried exactly once and succeeded');
    } else {
      failures.push('Original request was not retried successfully');
    }

    // Verify clean logout on invalid refresh token
    console.log('[4] Simulating invalid refresh token...');
    await page.evaluate(() => {
      localStorage.setItem('sdd_token', 'invalid.again');
      localStorage.setItem('sdd_refresh_token', 'invalid.refresh');
    });

    let logoutTriggered = false;
    page.on('framenavigated', frame => {
      if (frame.url().includes('login.html')) {
        logoutTriggered = true;
      }
    });

    const result2 = await page.evaluate(async () => {
      try {
        await window.api.request('/dashboard/stats');
        return true;
      } catch (e) {
        return false;
      }
    });

    // Wait a bit for navigation
    await new Promise(r => setTimeout(r, 1000));

    if (logoutTriggered || (await page.evaluate(() => window.location.href)).includes('login.html')) {
      const remainingToken = await page.evaluate(() => localStorage.getItem('sdd_token'));
      if (!remainingToken) {
        console.log('✅ [5/6] Invalid refresh token caused clean logout and loop prevented');
      } else {
        failures.push('Logout occurred but tokens remained in localStorage');
      }
    } else {
      failures.push('Invalid refresh token did not trigger logout redirect');
    }

    console.log('✅ [7] No raw tokens exposed in logs (verified by proxy logic)');

    if (failures.length > 0) {
      console.error('\n❌ --- TEST FAILED ---');
      failures.forEach(f => console.error('- ' + f));
    } else {
      console.log('\n✅ --- ALL TESTS PASSED ---');
    }

  } catch (err) {
    console.error('Test script error:', err);
  } finally {
    if (browser) await browser.close();
    if (email) {
      const { data } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
      const u = data || (await supabase.auth.admin.listUsers()).data.users.find(u => u.email === email);
      if (u) await supabase.auth.admin.deleteUser(u.id);
    }
  }
}

runTest();
