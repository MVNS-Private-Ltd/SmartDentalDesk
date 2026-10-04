// ─────────────────────────────────────────────────────────────────────────────
//  Audit Logger — lib/auditLogger.js
//
//  Centralized secure logging for security and operational events.
//  Sanitizes patient data, secrets, and credentials before logging.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

/**
 * Mask an email address for logging.
 * @param {string} email
 * @returns {string}
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '[invalid]';
  const parts = email.split('@');
  if (parts.length !== 2) return '[masked]';
  const [local, domain] = parts;
  const maskedLocal = local.length > 2 ? local.slice(0, 2) + '***' : '***';
  return `${maskedLocal}@${domain}`;
}

/**
 * Log a security or operational event securely.
 * Never logs raw patient names, clinical data, API keys, or raw payloads.
 *
 * @param {string} event - The event name (e.g., 'auth.login_failed', 'webhook.duplicate')
 * @param {object} details - Event context (masked automatically if sensitive keys passed)
 */
// In-memory buffer for recent events (for admin dashboard monitoring)
const recentEvents = [];
const MAX_EVENTS = 100;

function logAuditEvent(event, details = {}) {
  const safeDetails = {
    ts: new Date().toISOString(),
    event
  };

  if (details.clinicId) safeDetails.clinicId = details.clinicId;
  if (details.userId) safeDetails.userId = details.userId;
  if (details.email) safeDetails.email = maskEmail(details.email);
  if (details.ip) safeDetails.ip = details.ip;
  if (details.reason) safeDetails.reason = String(details.reason);
  if (details.resourceType) safeDetails.resourceType = details.resourceType;
  if (details.resourceId) safeDetails.resourceId = details.resourceId;
  if (details.errorCode) safeDetails.errorCode = details.errorCode;
  if (details.providerEventId) safeDetails.providerEventId = details.providerEventId;

  // Add to buffer
  recentEvents.unshift(safeDetails);
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.pop();
  }

  // Output as JSON to stdout for log aggregators
  console.log('[AUDIT]', JSON.stringify(safeDetails));
}

function getRecentEvents() {
  return recentEvents;
}

// Memory-based halt tracker for repeated violations
const haltTrackers = new Map();

/**
 * Track repeated anomalies and trigger a halt condition if threshold exceeded.
 * @param {string} type - e.g., 'tenant_violation', 'webhook_signature_failure'
 * @param {string} key - e.g., ip address or clinic id
 * @param {number} threshold - limit before halt
 * @param {number} windowMs - time window for limit
 */
function trackAndHalt(type, key, threshold = 5, windowMs = 15 * 60 * 1000) {
  const trackerKey = `${type}:${key}`;
  const now = Date.now();
  
  if (!haltTrackers.has(trackerKey)) {
    haltTrackers.set(trackerKey, { count: 1, firstSeen: now, halted: false });
    return false;
  }

  const tracker = haltTrackers.get(trackerKey);

  // Reset if outside window
  if (now - tracker.firstSeen > windowMs) {
    tracker.count = 1;
    tracker.firstSeen = now;
    tracker.halted = false;
    return false;
  }

  tracker.count += 1;

  if (tracker.count >= threshold && !tracker.halted) {
    tracker.halted = true;
    logAuditEvent('system.halt_triggered', {
      reason: `Threshold exceeded for ${type}`,
      resourceId: key
    });
    // For a real halt, you might store this in DB, disable the feature flag, or alert Super Admins
    return true; // Indicates caller should halt
  }

  return tracker.halted;
}

module.exports = {
  logAuditEvent,
  maskEmail,
  trackAndHalt,
  getRecentEvents
};
