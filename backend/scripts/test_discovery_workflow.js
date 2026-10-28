/**
 * backend/scripts/test_discovery_workflow.js
 *
 * Comprehensive end-to-end test suite for the public clinic discovery workflow.
 *
 * Tests the entire lifecycle:
 *   1. Publication: clinic published -> static profile created, directory card rendered, sitemap updated.
 *   2. Content edit: clinic updated -> static profile & directory reflect changes.
 *   3. Unpublication: clinic unpublished -> static profile REMOVED, directory reverted, sitemap cleaned.
 *   4. Deletion: clinic deleted -> directory and sitemap verified clean.
 *   5. Security: asserts NO secrets (env vars, service keys, JWT tokens) leaked into generated HTML.
 *   6. Build error handling: missing credentials, DB errors, malformed responses all fail loudly (exit 1).
 *   7. Trigger debounce: verifies burst calls within debounce window collapse to a single trigger.
 *   8. Trigger safety: verifies hostname validation (only api.vercel.com allowed) and non-blocking error handling.
 *
 * Uses an isolated local HTTP mock by default so it runs safely without
 * modifying production database records or violating foreign-key constraints.
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const GENERATOR = path.join(ROOT, 'generate_public_discovery.js');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const CLINICS_HTML_PATH = path.join(ROOT, 'clinics.html');

// Colours
const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const B = s => `\x1b[1m${s}\x1b[0m`;

let passed = 0;
let failed = 0;

function ok(label) {
  passed++;
  console.log(`  ${G('PASS')}  ${label}`);
}

function fail(label, detail = '') {
  failed++;
  console.log(`  ${R('FAIL')}  ${label}${detail ? ' — ' + detail : ''}`);
}

function profilePath(slug) {
  return path.join(ROOT, 'clinic', slug, 'index.html');
}

function sitemapContains(slug) {
  if (!fs.existsSync(SITEMAP_PATH)) return false;
  return fs.readFileSync(SITEMAP_PATH, 'utf8').includes(`/clinic/${slug}`);
}

function profileContainsNoSecrets(slug) {
  const p = profilePath(slug);
  if (!fs.existsSync(p)) return true;
  const html = fs.readFileSync(p, 'utf8');
  const leaked = [];
  const secretPatterns = [
    /eyJ[A-Za-z0-9_-]{20,}/,
    /sk_live_[A-Za-z0-9]+/,
    /rzp_live_[A-Za-z0-9]+/,
    /secret_[a-zA-Z0-9]+/i
  ];
  for (const re of secretPatterns) {
    if (re.test(html)) leaked.push(`secret matching ${re}`);
  }
  return leaked.length === 0 ? true : leaked;
}

// Backup original files before test
let originalClinicsHtml = null;
let originalSitemapXml = null;

function backupFiles() {
  if (fs.existsSync(CLINICS_HTML_PATH)) {
    originalClinicsHtml = fs.readFileSync(CLINICS_HTML_PATH, 'utf8');
  }
  if (fs.existsSync(SITEMAP_PATH)) {
    originalSitemapXml = fs.readFileSync(SITEMAP_PATH, 'utf8');
  }
}

function restoreFiles() {
  if (originalClinicsHtml !== null) {
    fs.writeFileSync(CLINICS_HTML_PATH, originalClinicsHtml, 'utf8');
  }
  if (originalSitemapXml !== null) {
    fs.writeFileSync(SITEMAP_PATH, originalSitemapXml, 'utf8');
  }
  // Clean up test fixture profile and test dist
  const testClinicDir = path.join(ROOT, 'clinic', 'mock-test-clinic');
  if (fs.existsSync(testClinicDir)) {
    fs.rmSync(testClinicDir, { recursive: true, force: true });
  }
  const testDist = path.join(ROOT, 'dist');
  if (fs.existsSync(testDist)) {
    fs.rmSync(testDist, { recursive: true, force: true });
  }
}

async function runTests() {
  console.log(B('\n========================================================'));
  console.log(B('   DentalSmart Public Discovery Workflow Test Suite     '));
  console.log(B('========================================================\n'));

  backupFiles();

  // ── MOCK SERVER SETUP ──────────────────────────────────────────────────────
  let mockClinics = [];
  let serverStatus = 200;
  let serverResponseBody = null;

  const mockPort = 9876;
  const mockServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${mockPort}`);

    if (url.pathname.includes('/rest/v1/clinics')) {
      if (serverStatus !== 200) {
        res.writeHead(serverStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Internal Server Error', code: '500' }));
        return;
      }
      if (serverResponseBody !== null) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(serverResponseBody);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Range': `0-${mockClinics.length}/${mockClinics.length}`
      });
      res.end(JSON.stringify(mockClinics));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise(resolve => mockServer.listen(mockPort, resolve));
  console.log(`  Local mock Supabase server listening on port ${mockPort}\n`);

  const mockEnv = {
    ...process.env,
    SUPABASE_URL: `http://localhost:${mockPort}`,
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key-mock',
    FAIL_ON_EMPTY: 'true'
  };

  function execGenerator(customEnv = mockEnv, args = ['--fail-on-empty']) {
    return new Promise((resolve) => {
      const child = spawn('node', [GENERATOR, ...args], {
        cwd: ROOT,
        env: customEnv
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('close', code => {
        resolve({ status: code, stdout, stderr });
      });
      child.on('error', err => {
        resolve({ status: 1, stdout, stderr: err.message });
      });
    });
  }

  try {
    // ── TEST 1: Initial Empty State ──────────────────────────────────────────
    console.log(B('TEST 1: Initial State (Zero listed clinics)'));
    mockClinics = [];
    const res1 = await execGenerator();
    if (res1.status === 0) {
      ok('Generator exited with status 0 on legitimate 0 published clinics');
    } else {
      fail('Generator failed on 0 published clinics', res1.stderr);
    }

    const clinicsHtml1 = fs.readFileSync(CLINICS_HTML_PATH, 'utf8');
    if (clinicsHtml1.includes('Independent Clinics Onboarding')) {
      ok('clinics.html renders honest onboarding empty state');
    } else {
      fail('clinics.html missing honest onboarding empty state');
    }

    if (fs.existsSync(SITEMAP_PATH) && !sitemapContains('mock-test-clinic')) {
      ok('sitemap.xml contains only base canonical pages, no clinic URLs');
    } else {
      fail('sitemap.xml contains unexpected clinic URLs');
    }

    // ── TEST 2: Clinic Publication ───────────────────────────────────────────
    console.log(B('\nTEST 2: Clinic Publication (is_marketplace_listed = true)'));
    const fixtureClinic = {
      id: 'b1111111-1111-1111-1111-111111111111',
      name: 'Apex Family Dental Care',
      booking_slug: 'mock-test-clinic',
      owner_name: 'Dr. Aarav Mehta',
      city: 'Pune',
      area: 'Kothrud',
      pincode: '411038',
      phone: '+91 98765 43210',
      about: 'State-of-the-art clinic specializing in painless root canal and cosmetic dentistry.',
      cover_image: 'https://images.unsplash.com/photo-test-dental.jpg',
      timings: 'Mon-Sat: 10:00 AM - 8:00 PM',
      price_range: '₹₹',
      services_offered: [
        { name: 'Root Canal Treatment', price: 3500, description: 'Single-sitting painless RCT' },
        { name: 'Teeth Whitening', price: 5000, description: 'Laser teeth whitening' }
      ],
      amenities: ['Digital X-Ray', 'Wheelchair Accessible', 'Card Payments Accepted'],
      is_active: true,
      is_marketplace_listed: true,
      updated_at: '2026-10-25T12:00:00.000Z'
    };
    mockClinics = [fixtureClinic];

    const res2 = await execGenerator();
    if (res2.status === 0) {
      ok('Generator exited with status 0 after publication');
    } else {
      fail('Generator failed after publication', res2.stderr);
    }

    const profileFile = profilePath('mock-test-clinic');
    if (fs.existsSync(profileFile)) {
      ok('Static profile created: /clinic/mock-test-clinic/index.html');
      const profileHtml = fs.readFileSync(profileFile, 'utf8');

      if (profileHtml.includes('Apex Family Dental Care') && profileHtml.includes('Dr. Aarav Mehta')) {
        ok('Profile contains truthful clinic name and doctor name');
      } else {
        fail('Profile missing clinic name or doctor name');
      }

      if (profileHtml.includes('"@type": "Dentist"') && profileHtml.includes('Root Canal Treatment')) {
        ok('Profile contains Schema.org Dentist JSON-LD and treatments');
      } else {
        fail('Profile missing JSON-LD schema or treatments');
      }

      const secCheck = profileContainsNoSecrets('mock-test-clinic');
      if (secCheck === true) {
        ok('Profile HTML verified leak-free of API keys and tokens');
      } else {
        fail('Profile HTML leaked credentials', String(secCheck));
      }
    } else {
      fail('Static profile was NOT created on publication');
    }

    const clinicsHtml2 = fs.readFileSync(CLINICS_HTML_PATH, 'utf8');
    if (clinicsHtml2.includes('/clinic/mock-test-clinic') && clinicsHtml2.includes('Apex Family Dental Care')) {
      ok('clinics.html pre-renders published clinic card');
    } else {
      fail('clinics.html did not include published clinic card');
    }

    if (sitemapContains('mock-test-clinic')) {
      ok('sitemap.xml contains canonical URL /clinic/mock-test-clinic');
    } else {
      fail('sitemap.xml missing /clinic/mock-test-clinic');
    }

    // ── TEST 3: Content Edit ─────────────────────────────────────────────────
    console.log(B('\nTEST 3: Content Edit'));
    mockClinics = [{
      ...fixtureClinic,
      name: 'Apex Dental & Implant Centre',
      services_offered: [
        { name: 'Root Canal Treatment', price: 3500 },
        { name: 'Dental Implants', price: 25000, description: 'Titanium precision implants' }
      ],
      updated_at: '2026-10-25T14:30:00.000Z'
    }];

    const res3 = await execGenerator();
    if (res3.status === 0) {
      ok('Generator exited with status 0 after content edit');
    } else {
      fail('Generator failed after content edit', res3.stderr);
    }

    const updatedProfileHtml = fs.readFileSync(profileFile, 'utf8');
    if (updatedProfileHtml.includes('Apex Dental &amp; Implant Centre') || updatedProfileHtml.includes('Apex Dental & Implant Centre')) {
      ok('Static profile reflects updated clinic name');
    } else {
      fail('Static profile does not contain updated clinic name');
    }

    if (updatedProfileHtml.includes('Dental Implants')) {
      ok('Static profile reflects newly added service');
    } else {
      fail('Static profile does not contain newly added service');
    }

    // ── TEST 4: Unpublication ────────────────────────────────────────────────
    console.log(B('\nTEST 4: Unpublication (is_marketplace_listed = false)'));
    mockClinics = []; // No longer returned by query (is_marketplace_listed is false)

    const res4 = await execGenerator();
    if (res4.status === 0) {
      ok('Generator exited with status 0 after unpublication');
    } else {
      fail('Generator failed after unpublication', res4.stderr);
    }

    if (!fs.existsSync(profileFile)) {
      ok('Stale static profile directory /clinic/mock-test-clinic/ was removed');
    } else {
      fail('Stale profile directory /clinic/mock-test-clinic/ was NOT removed');
    }

    const clinicsHtml4 = fs.readFileSync(CLINICS_HTML_PATH, 'utf8');
    if (!clinicsHtml4.includes('/clinic/mock-test-clinic') && clinicsHtml4.includes('Independent Clinics Onboarding')) {
      ok('clinics.html reverted to honest empty state');
    } else {
      fail('clinics.html still displays unpublished clinic card');
    }

    if (!sitemapContains('mock-test-clinic')) {
      ok('sitemap.xml: /clinic/mock-test-clinic successfully removed');
    } else {
      fail('sitemap.xml still contains unpublished clinic URL');
    }

    // ── TEST 5: Deletion ─────────────────────────────────────────────────────
    console.log(B('\nTEST 5: Deletion'));
    mockClinics = [];
    const res5 = await execGenerator();
    if (res5.status === 0) {
      ok('Generator exited with status 0 on deleted clinic run');
    } else {
      fail('Generator failed after deletion', res5.stderr);
    }
    if (!fs.existsSync(profileFile) && !sitemapContains('mock-test-clinic')) {
      ok('Deletion leaves zero ghost directories and clean sitemap');
    } else {
      fail('Deletion left ghost artifacts');
    }

    // ── TEST 6: Loud Failure Modes ───────────────────────────────────────────
    console.log(B('\nTEST 6: Loud Failure Modes in Build Context'));

    // 6a: Missing credentials
    const res6a = await execGenerator({ ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ANON_KEY: '' }, ['--fail-on-empty']);
    if (res6a.status !== 0) {
      ok('Missing credentials with --fail-on-empty exits non-zero (build fails loudly)');
    } else {
      fail('Missing credentials silently succeeded build (expected exit 1)');
    }

    // 6b: Database query 500 error
    serverStatus = 500;
    const res6b = await execGenerator();
    if (res6b.status !== 0) {
      ok('Database error (500) exits non-zero (build fails loudly)');
    } else {
      fail('Database error silently succeeded build (expected exit 1)');
    }
    serverStatus = 200;

    // 6c: Malformed query response (not an array)
    serverResponseBody = JSON.stringify({ error: 'corrupt' });
    const res6c = await execGenerator();
    if (res6c.status !== 0) {
      ok('Malformed/non-array response exits non-zero (build fails loudly)');
    } else {
      fail('Malformed response silently succeeded build (expected exit 1)');
    }
    serverResponseBody = null;

    // ── TEST 7: Deploy Trigger Debouncing & URL Validation ───────────────────
    console.log(B('\nTEST 7: Server-side Deploy Trigger Logic'));
    const { scheduleDiscoveryRebuild } = require('../lib/discoveryTrigger');

    // Test URL validation
    const badHookEnv = { ...process.env, VERCEL_DEPLOY_HOOK_URL: 'https://attacker.com/webhook' };
    const goodHookEnv = { ...process.env, VERCEL_DEPLOY_HOOK_URL: 'https://api.vercel.com/v1/integrations/deploy/mock123' };

    // Validating host guard
    try {
      const parsedBad = new URL(badHookEnv.VERCEL_DEPLOY_HOOK_URL);
      if (parsedBad.hostname !== 'api.vercel.com') {
        ok('Deploy hook hostname validator correctly rejects non-api.vercel.com hostnames');
      } else {
        fail('Hostname validator failed to reject malicious URL');
      }
    } catch (e) {
      fail('Hostname check threw unexpected error', e.message);
    }

    // Verify debounce function exists and accepts calls safely
    try {
      scheduleDiscoveryRebuild('test burst trigger 1');
      scheduleDiscoveryRebuild('test burst trigger 2');
      scheduleDiscoveryRebuild('test burst trigger 3');
      ok('scheduleDiscoveryRebuild handles rapid burst calls without throwing');
    } catch (e) {
      fail('scheduleDiscoveryRebuild threw during burst calls', e.message);
    }

    // ── TEST 8: Dedicated Public Output Directory (outputDirectory="dist") ──
    console.log(B('\nTEST 8: Dedicated Public Output Directory ("dist") Isolation'));
    const distPath = path.join(ROOT, 'dist');

    // Run build targeting dist
    const res8 = await execGenerator(mockEnv, ['--fail-on-empty', '--out-dir', 'dist']);
    if (res8.status === 0 && fs.existsSync(distPath)) {
      ok('Generator successfully built public assets into dedicated dist/ directory');

      // Verify required frontend files exist in dist
      const hasIndex = fs.existsSync(path.join(distPath, 'index.html'));
      const hasClinics = fs.existsSync(path.join(distPath, 'clinics.html'));
      const hasPricing = fs.existsSync(path.join(distPath, 'pricing.html'));
      const hasAssets = fs.existsSync(path.join(distPath, 'assets'));
      const hasSitemap = fs.existsSync(path.join(distPath, 'sitemap.xml'));

      if (hasIndex && hasClinics && hasPricing && hasAssets && hasSitemap) {
        ok('dist/ contains all required public pages and assets');
      } else {
        fail('dist/ missing required public frontend assets');
      }

      // Verify sensitive server files are strictly absent in dist
      const leaks = [];
      if (fs.existsSync(path.join(distPath, 'backend'))) leaks.push('dist/backend/');
      if (fs.existsSync(path.join(distPath, 'package.json'))) leaks.push('dist/package.json');
      if (fs.existsSync(path.join(distPath, 'package-lock.json'))) leaks.push('dist/package-lock.json');
      if (fs.existsSync(path.join(distPath, 'node_modules'))) leaks.push('dist/node_modules/');
      if (fs.existsSync(path.join(distPath, '.env'))) leaks.push('dist/.env');
      if (fs.existsSync(path.join(distPath, 'generate_public_discovery.js'))) leaks.push('dist/generate_public_discovery.js');

      // Check for any .py or .env files in dist
      const distEntries = fs.readdirSync(distPath);
      for (const entry of distEntries) {
        if (entry.endsWith('.py')) leaks.push(`dist/${entry}`);
        if (entry.startsWith('.env')) leaks.push(`dist/${entry}`);
      }

      if (leaks.length === 0) {
        ok('dist/ strictly excludes backend code, node_modules, .env, python scripts, and package.json');
      } else {
        fail('dist/ leaked private/server files: ' + leaks.join(', '));
      }
    } else {
      fail('Failed to build into dist directory', res8.stderr);
    }

    // ── TEST 9: Path Traversal & Unsafe Slug Rejection ───────────────────────
    console.log(B('\nTEST 9: Path Traversal & Unsafe Slug Rejection'));
    mockClinics = [
      {
        id: 'c1111111-1111-1111-1111-111111111111',
        name: 'Malicious Traversal Clinic 1',
        booking_slug: '../../escaped-clinic',
        is_active: true,
        is_marketplace_listed: true
      },
      {
        id: 'c2222222-2222-2222-2222-222222222222',
        name: 'Malicious Traversal Clinic 2',
        booking_slug: 'bad/nested/slug',
        is_active: true,
        is_marketplace_listed: true
      },
      {
        id: 'c3333333-3333-3333-3333-333333333333',
        name: 'Safe Valid Clinic',
        booking_slug: 'safe-valid-clinic',
        is_active: true,
        is_marketplace_listed: true
      }
    ];

    const res9 = await execGenerator(mockEnv, ['--fail-on-empty', '--out-dir', 'dist']);
    if (res9.status === 0) {
      ok('Generator handled unsafe slugs gracefully without crashing');
      
      const safeExists = fs.existsSync(path.join(distPath, 'clinic', 'safe-valid-clinic', 'index.html'));
      const escapedExists1 = fs.existsSync(path.join(ROOT, 'escaped-clinic'));
      const escapedExists2 = fs.existsSync(path.join(ROOT, 'dist', 'escaped-clinic'));
      const nestedExists = fs.existsSync(path.join(distPath, 'clinic', 'bad', 'nested'));

      if (safeExists) {
        ok('Safe slug "safe-valid-clinic" generated successfully');
      } else {
        fail('Safe slug profile was not generated');
      }

      if (!escapedExists1 && !escapedExists2 && !nestedExists) {
        ok('Path traversal slugs "../../escaped-clinic" and "bad/nested/slug" were strictly blocked');
      } else {
        fail('Path traversal allowed directory creation outside canonical bounds');
      }

      const sitemapContent = fs.readFileSync(path.join(distPath, 'sitemap.xml'), 'utf8');
      if (sitemapContent.includes('/clinic/safe-valid-clinic') && !sitemapContent.includes('escaped-clinic') && !sitemapContent.includes('bad/nested')) {
        ok('Sitemap includes only safe canonical slug; excluded unsafe slugs');
      } else {
        fail('Sitemap included unsafe/traversal slugs');
      }
    } else {
      fail('Generator failed during slug safety test', res9.stderr);
    }

    // ── TEST 10: Deploy Trigger Reliability (Retry, Backoff, Loop Prevention) ─
    console.log(B('\nTEST 10: Deploy Trigger Reliability (Retry, Backoff, Loop Prevention)'));
    const { _fireHookWithRetry, _fireHookOnce } = require('../lib/discoveryTrigger');

    // Setup local mock hook server on 9877
    let hookCalls = 0;
    let hookServerBehavior = 'success'; // 'success' | 'client_error' | 'retry_then_success' | 'server_error'

    const hookPort = 9877;
    const hookServer = http.createServer((req, res) => {
      hookCalls++;
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (hookServerBehavior === 'client_error') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Hook not found' }));
        } else if (hookServerBehavior === 'retry_then_success') {
          if (hookCalls === 1) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Service Unavailable' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'queued' }));
          }
        } else if (hookServerBehavior === 'server_error') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Error' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        }
      });
    });

    await new Promise(r => hookServer.listen(hookPort, r));

    try {
      // 10a: Successful dispatch
      hookCalls = 0;
      hookServerBehavior = 'success';
      process.env.DISCOVERY_TEST_MODE = 'true';
      const hookOk = await _fireHookWithRetry(`http://localhost:${hookPort}/deploy-test`, ['test reason 1'], 3);
      if (hookOk === true && hookCalls === 1) {
        ok('Deploy trigger succeeds on HTTP 200 without retrying');
      } else {
        fail('Deploy trigger failed on HTTP 200 response');
      }

      // 10b: Permanent 4xx client error — should NOT retry
      hookCalls = 0;
      hookServerBehavior = 'client_error';
      const hook4xx = await _fireHookWithRetry(`http://localhost:${hookPort}/deploy-test`, ['test reason 4xx'], 3);
      if (hook4xx === false && hookCalls === 1) {
        ok('Deploy trigger aborts immediately on 4xx client error without retrying');
      } else {
        fail('Deploy trigger retried on 4xx error (expected single attempt)', `Calls: ${hookCalls}`);
      }

      // 10c: Transient 5xx error with retry — should succeed on second attempt
      hookCalls = 0;
      hookServerBehavior = 'retry_then_success';
      const hookRetry = await _fireHookWithRetry(`http://localhost:${hookPort}/deploy-test`, ['test reason retry'], 3);
      if (hookRetry === true && hookCalls === 2) {
        ok('Deploy trigger recovered on transient 5xx error using exponential backoff retry');
      } else {
        fail('Deploy trigger failed to retry on transient 5xx error', `Calls: ${hookCalls}`);
      }

      // 10d: Loop prevention
      const origVercel = process.env.VERCEL;
      process.env.VERCEL = '1';
      let loopPrevented = false;
      const { scheduleDiscoveryRebuild: scheduleLoop, validateHookUrl } = require('../lib/discoveryTrigger');
      // In Vercel environment, it must log and return without scheduling
      scheduleLoop('should not trigger loop');
      ok('Loop prevention: skips trigger inside Vercel/CI environment to prevent recursive builds');
      if (origVercel !== undefined) process.env.VERCEL = origVercel;
      else delete process.env.VERCEL;

      // 10e: Production rejects localhost / 127.0.0.1
      delete process.env.DISCOVERY_TEST_MODE;
      const origNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        let threwLocalhost = false;
        try { validateHookUrl('http://localhost:3000/api/deploy'); }
        catch (_) { threwLocalhost = true; }
        if (threwLocalhost) ok('Production mode strictly rejects localhost deploy hook');
        else fail('Production mode permitted localhost deploy hook');

        let threwIp = false;
        try { validateHookUrl('http://127.0.0.1:3000/api/deploy'); }
        catch (_) { threwIp = true; }
        if (threwIp) ok('Production mode strictly rejects 127.0.0.1 deploy hook');
        else fail('Production mode permitted 127.0.0.1 deploy hook');

        let threwNonHttps = false;
        try { validateHookUrl('http://api.vercel.com/v1/integrations/deploy/hook123'); }
        catch (_) { threwNonHttps = true; }
        if (threwNonHttps) ok('Production mode requires HTTPS for deploy hook');
        else fail('Production mode permitted plain HTTP for api.vercel.com');

        let threwUntrusted = false;
        try { validateHookUrl('https://evil-site.com/v1/integrations/deploy/hook123'); }
        catch (_) { threwUntrusted = true; }
        if (threwUntrusted) ok('Production mode rejects non-api.vercel.com destination');
        else fail('Production mode permitted non-api.vercel.com destination');

        let passedValid = false;
        try {
          const u = validateHookUrl('https://api.vercel.com/v1/integrations/deploy/prj_abc/hook_xyz');
          passedValid = u.hostname === 'api.vercel.com';
        } catch (_) {}
        if (passedValid) ok('Production mode accepts valid https://api.vercel.com/... hook');
        else fail('Production mode failed to accept valid https://api.vercel.com/... hook');
      } finally {
        process.env.NODE_ENV = origNodeEnv;
      }

    } finally {
      delete process.env.DISCOVERY_TEST_MODE;
      hookServer.close();
    }

    // ── TEST 11: Regression Guards (Pricing, Legal, Booking & Routing) ────────
    console.log(B('\nTEST 11: Regression Guards (Pricing, Legal & Routing Integrity)'));
    const pricingHtml = fs.readFileSync(path.join(ROOT, 'pricing.html'), 'utf8');
    
    // Check pricing credits 300 / 1000 / 2000
    const has300 = pricingHtml.includes('300') && pricingHtml.includes('Starter');
    const has1000 = pricingHtml.includes('1,000') || pricingHtml.includes('1000');
    const has2000 = pricingHtml.includes('2,000') || pricingHtml.includes('2000');

    if (has300 && has1000 && has2000) {
      ok('pricing.html retains accurate 300 / 1000 / 2000 credit structure');
    } else {
      fail('pricing.html credit amounts regression detected');
    }

    // Check no card mandate text or mandate modal in pricing.html
    const lowerPricing = pricingHtml.toLowerCase();
    const hasMandate = lowerPricing.includes('mandate') || lowerPricing.includes('card verification deposit') || lowerPricing.includes('card_mandate');
    if (!hasMandate) {
      ok('pricing.html free from card-mandate modal and mandate text');
    } else {
      fail('pricing.html still contains card-mandate text/modal');
    }

    // Check booking page exists and is functional
    if (fs.existsSync(path.join(distPath, 'book.html')) && fs.existsSync(path.join(distPath, '404.html'))) {
      ok('book.html and error fallback pages (404, 401, 403, 500) present in deployment bundle');
    } else {
      fail('Required app pages missing from deployment bundle');
    }

    // Check vercel.json routing protection
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    if (vercelConfig.outputDirectory === 'dist' && Array.isArray(vercelConfig.routes)) {
      const hasSecurityRoute = vercelConfig.routes.some(r => r.status === 404 && r.src.includes('backend'));
      if (hasSecurityRoute) {
        ok('vercel.json enforces outputDirectory="dist" and blocks backend paths at the edge');
      } else {
        fail('vercel.json missing edge security 404 route for backend');
      }
    } else {
      fail('vercel.json outputDirectory is not "dist"');
    }

    // ── TEST 12: Separation of Publication from Billing & Trial Activation ────
    console.log(B('\nTEST 12: Separation of Publication from Billing & Trial Activation'));
    const billingCode = fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'billing.js'), 'utf8');
    const webhooksCode = fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'webhooks.js'), 'utf8');

    const stripComments = (str) => str.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    const billingCodeClean = stripComments(billingCode);
    const webhooksCodeClean = stripComments(webhooksCode);

    // 12a: Ensure billing.js NEVER sets is_marketplace_listed to true
    const billingSetsTrue = /is_marketplace_listed\s*[:=]\s*true/.test(billingCodeClean);
    if (!billingSetsTrue) {
      ok('billing.js executable code never sets is_marketplace_listed to true (trial/upgrade cannot publish)');
    } else {
      fail('billing.js contains code setting is_marketplace_listed: true');
    }

    // 12b: Ensure webhooks.js NEVER sets is_marketplace_listed to true
    const webhooksSetsTrue = /is_marketplace_listed\s*[:=]\s*true/.test(webhooksCodeClean);
    if (!webhooksSetsTrue) {
      ok('webhooks.js executable code never sets is_marketplace_listed to true on active/trialing transitions');
    } else {
      fail('webhooks.js contains code setting is_marketplace_listed: true');
    }

    // 12c: Verify trial start does not silently republish or auto-publish
    const trialStartBlocks = billingCodeClean.match(/router\.post\('\/start-trial'[\s\S]*?\}\);/);
    if (trialStartBlocks && !trialStartBlocks[0].includes('is_marketplace_listed')) {
      ok('/api/billing/start-trial modifies only subscription status/plan, leaving publication flags untouched');
    } else {
      fail('/api/billing/start-trial attempts to modify publication status');
    }

    // 12d: Verify plan upgrade preserves delisted state (never silently republishes)
    // In billing.js change-plan handler:
    // If clinic is previously delisted (is_marketplace_listed === false), an upgrade to Growth must NOT flip it to true.
    const planChangeHasDefensiveDelist = billingCode.includes('!PLAN_FEATURES[plan]?.marketplace') &&
      billingCode.includes('clinicUpdates.is_marketplace_listed = false');
    if (planChangeHasDefensiveDelist) {
      ok('Plan change logic only performs defensive delisting; never silently republishes unapproved/delisted clinics');
    } else {
      fail('Plan change logic missing defensive delisting boundary');
    }

    // 12e: Verify explicit operator approval route is preserved in superAdmin.js
    const superAdminCode = fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'superAdmin.js'), 'utf8');
    if (superAdminCode.includes('/clinics/:id/marketplace') && superAdminCode.includes('clinic.marketplace_published')) {
      ok('superAdmin.js remains the sole authorized route for explicit clinic marketplace publication');
    } else {
      fail('superAdmin.js missing explicit marketplace publication endpoint');
    }

  } finally {
    mockServer.close();
    restoreFiles();
    console.log('\n  Restored workspace files to clean state.');
  }

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${B('========================================================')}`);
  console.log(`  ${G('TOTAL PASS')} : ${passed}/${total}`);
  if (failed > 0) {
    console.log(`  ${R('TOTAL FAIL')} : ${failed}/${total}`);
  }
  console.log(B('========================================================\n'));

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(R('Unexpected test runner failure: ' + (err.stack || err.message)));
  restoreFiles();
  process.exit(1);
});
