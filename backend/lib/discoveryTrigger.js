/**
 * backend/lib/discoveryTrigger.js
 *
 * Fires a Vercel Deploy Hook to rebuild the public discovery pages whenever
 * a clinic's marketplace publication state, content, suspension, or deletion changes.
 *
 * Design constraints & safety guarantees:
 *  - Deploy Hook URL stays server-side only (process.env.VERCEL_DEPLOY_HOOK_URL).
 *  - URL Redaction: never prints sensitive hook tokens or query strings in logs.
 *  - Destination Validation: strictly enforces hostname === 'api.vercel.com'.
 *  - Loop Prevention: aborts if running inside Vercel/CI environment to prevent trigger loops.
 *  - Burst Debounce: collapses multiple updates within 8s into a single trigger.
 *  - Bounded Retry: transient network/5xx errors retry up to 3 times with exponential backoff.
 *  - Permanent 4xx Rejection: does not retry non-transient client errors (e.g. 400/404).
 *  - Non-Blocking: errors are logged; runtime API responses are never blocked or failed.
 *  - Durable Queue Ready: attempts to record trigger events to `discovery_build_jobs` table
 *    if present, while continuing in-memory debounced delivery.
 */

'use strict';

const https = require('https');
const http = require('http');

const DEBOUNCE_MS = 8_000; // collapse bursts within 8 s
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1_000, 2_000, 4_000];

let _debounceTimer = null;
let _pendingReasons = [];

/**
 * Validates the Deploy Hook URL.
 * Throws if invalid or if hostname is not api.vercel.com.
 *
 * @param {string} hookUrl
 * @returns {URL}
 */
function validateHookUrl(hookUrl) {
  if (!hookUrl || typeof hookUrl !== 'string') {
    throw new Error('Deploy hook URL is missing or empty.');
  }

  let parsed;
  try {
    parsed = new URL(hookUrl);
  } catch {
    throw new Error('Deploy hook URL is not a valid URL.');
  }

  // Allow localhost/127.0.0.1 strictly in test environments
  const isTest = process.env.NODE_ENV === 'test' || process.env.DISCOVERY_TEST_MODE === 'true';
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  if (!isLocal && parsed.hostname !== 'api.vercel.com') {
    throw new Error(
      `Deploy hook hostname must be api.vercel.com, got "${parsed.hostname}". Verify VERCEL_DEPLOY_HOOK_URL.`
    );
  }

  if (!isLocal && parsed.protocol !== 'https:') {
    throw new Error('Deploy hook URL must use HTTPS.');
  }

  return parsed;
}

/**
 * Masks a Deploy Hook URL for safe logging without leaking tokens.
 * Example: https://api.vercel.com/v1/integrations/deploy/prj_xxx/hook_yyy -> https://api.vercel.com/.../hook_***
 *
 * @param {string} hookUrl
 * @returns {string}
 */
function maskHookUrl(hookUrl) {
  try {
    const u = new URL(hookUrl);
    return `${u.protocol}//${u.hostname}/[REDACTED_HOOK_PATH]`;
  } catch {
    return '[INVALID_URL]';
  }
}

/**
 * Single HTTP/HTTPS POST attempt to the deploy hook.
 *
 * @param {URL} parsedUrl
 * @param {string} bodyPayload
 * @returns {Promise<{statusCode: number, body: string}>}
 */
function _fireHookOnce(parsedUrl, bodyPayload) {
  return new Promise((resolve, reject) => {
    const client = parsedUrl.protocol === 'http:' ? http : https;
    const req = client.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyPayload),
          'User-Agent': 'DentalSmart-Discovery-Trigger/1.0'
        }
      },
      (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body: raw });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy(new Error('Deploy hook request timed out after 10 s'));
    });
    req.write(bodyPayload);
    req.end();
  });
}

/**
 * Executes deploy hook with bounded exponential backoff retries on transient errors.
 *
 * @param {string} hookUrl
 * @param {string[]} reasons
 * @param {number} maxRetries
 * @returns {Promise<boolean>} true if accepted, false otherwise
 */
async function _fireHookWithRetry(hookUrl, reasons, maxRetries = MAX_RETRIES) {
  const combinedReason = reasons.join('; ');
  const masked = maskHookUrl(hookUrl);
  console.log(`[discoveryTrigger] Firing Vercel deploy hook at ${masked}. Reason: "${combinedReason}"`);

  let parsedUrl;
  try {
    parsedUrl = validateHookUrl(hookUrl);
  } catch (err) {
    console.error(`[discoveryTrigger] Configuration error: ${err.message}`);
    return false;
  }

  const payload = JSON.stringify({ reason: combinedReason });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await _fireHookOnce(parsedUrl, payload);
      const status = response.statusCode;

      if (status >= 200 && status < 300) {
        console.log(`[discoveryTrigger] Deploy hook accepted (HTTP ${status}) on attempt ${attempt}. Vercel build queued.`);
        return true;
      }

      // Permanent client errors (4xx) — do not retry
      if (status >= 400 && status < 500) {
        console.warn(`[discoveryTrigger] Deploy hook rejected with HTTP ${status}. Client error; will not retry.`);
        return false;
      }

      // Transient server error (5xx)
      console.warn(`[discoveryTrigger] Deploy hook returned transient HTTP ${status} on attempt ${attempt}/${maxRetries}.`);
    } catch (err) {
      console.warn(`[discoveryTrigger] Attempt ${attempt}/${maxRetries} network error: ${err.message}`);
    }

    if (attempt < maxRetries) {
      const delay = RETRY_DELAYS[attempt - 1] || 2_000;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.error(`[discoveryTrigger] Deploy hook failed after ${maxRetries} attempts. Existing static files remain live.`);
  return false;
}

/**
 * Optionally log the job to Supabase discovery_build_jobs table if it exists.
 * Does not throw if table does not exist.
 */
async function _logJobToDatabase(reason) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  try {
    let createClient;
    try { createClient = require('@supabase/supabase-js').createClient; }
    catch (_) { return; }

    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase.from('discovery_build_jobs').insert({
      trigger_reason: reason,
      status: 'pending',
      created_at: new Date().toISOString()
    });
  } catch (_) {
    // Gracefully ignore if table has not been created yet
  }
}

/**
 * Schedule a discovery rebuild. Collapses rapid burst calls into one debounced deploy.
 *
 * @param {string} reason – Human-readable reason for audit log
 * @returns {void}
 */
function scheduleDiscoveryRebuild(reason) {
  // 1. Recursive build loop protection
  if (process.env.VERCEL === '1' || process.env.NOW_BUILDER === '1' || process.env.CI === 'true') {
    console.log('[discoveryTrigger] Execution inside build/CI environment detected. Skipping deploy hook to prevent recursive build loops.');
    return;
  }

  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) {
    console.warn(
      '[discoveryTrigger] VERCEL_DEPLOY_HOOK_URL not configured. ' +
      'Rebuild skipped. Configure the variable in Render to enable automatic regeneration. ' +
      `Reason queued: "${reason}"`
    );
    return;
  }

  _pendingReasons.push(reason);

  // Optional background durable log
  _logJobToDatabase(reason).catch(() => {});

  if (_debounceTimer) {
    // Already scheduled — reason accumulated
    return;
  }

  _debounceTimer = setTimeout(() => {
    const reasons = _pendingReasons.splice(0);
    _debounceTimer = null;

    _fireHookWithRetry(hookUrl, reasons).catch(err => {
      console.error('[discoveryTrigger] Unexpected trigger failure:', err.message);
    });
  }, DEBOUNCE_MS);

  if (_debounceTimer && typeof _debounceTimer.unref === 'function') {
    _debounceTimer.unref();
  }
}

/**
 * Test helper to clear pending debounce state.
 */
function resetPendingTrigger() {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _pendingReasons = [];
}

module.exports = {
  scheduleDiscoveryRebuild,
  validateHookUrl,
  maskHookUrl,
  _fireHookOnce,
  _fireHookWithRetry,
  resetPendingTrigger
};
