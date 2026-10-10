# dentalsmart: Incident Response Runbook

This runbook outlines standard operating procedures for handling critical events detected during the soft launch.

## Severity Levels
- **SEV-1 (Critical):** Data breach, complete system outage, payment webhook failure affecting all clinics.
- **SEV-2 (High):** Tenant isolation violation, repeated AI bypass, mass email delivery failure.
- **SEV-3 (Medium):** Individual clinic brute-force attack, spam listing reports.

---

## 1. Tenant Isolation Violation (SEV-2)
**Trigger:** `tenant_violation` event logged in Audit Logger.
**Impact:** A user attempted to access or modify data belonging to another clinic.

**Response Steps:**
1. Check the `resourceType` and `resourceId` in the audit log.
2. Verify if it was a frontend bug (e.g., stale cache) or a malicious API call.
3. If the system halted the user (`system.halt_triggered`), their requests are already being blocked (403).
4. Review the offending User ID in Supabase Auth.
5. If malicious intent is confirmed, suspend the user and notify the clinic owner.

## 2. Repeated Authentication Failures (SEV-3)
**Trigger:** `auth_brute_force` halt triggered.
**Impact:** Potential credential stuffing or brute-force attack against a clinic account.

**Response Steps:**
1. Identify the targeted `email` and the originating `ip` from the `auth.login_failed` logs.
2. The system automatically rate-limits the IP (429 Too Many Requests).
3. If the attack persists across multiple IPs, consider enabling stricter Cloudflare WAF rules for the `/api/auth/login` endpoint.
4. If an account is successfully compromised, trigger the password reset flow manually and invalidate sessions.

## 3. Webhook Signature Failures (SEV-2)
**Trigger:** `webhook_signature_failure` halt triggered.
**Impact:** Someone is attempting to spoof Razorpay payment webhooks.

**Response Steps:**
1. Verify the Razorpay Webhook Secret in Render matches the Razorpay Dashboard.
2. The system automatically halts processing from the attacking IP.
3. Check for any missed legitimate webhooks during the attack window on the Razorpay Dashboard and replay them if necessary.

## 4. AI Review Bypass Attempts (SEV-2)
**Trigger:** `ai.review_bypass_attempt` log or `ai_bypass` halt.
**Impact:** A clinic is trying to send AI-generated patient communications without human review.

**Response Steps:**
1. Identify the `clinicId`.
2. The system automatically disables their AI features temporarily.
3. Review their API usage patterns. If they are using a bot to hit the email endpoint, issue a formal warning.

## 5. System Outage or Database Unreachable (SEV-1)
**Trigger:** `system-health` endpoint reports `status: error` or `unreachable`.
**Impact:** API is down; clinics cannot log in or manage patients.

**Response Steps:**
1. Check Render dashboard for Node.js process crashes (OOM, unhandled rejections).
2. Check Supabase dashboard for database load, connection limits, or project pausing.
3. Post an update to the Super Admin Broadcast banner (if API is partially up) or status page.
4. Scale up the database instance if connection limits are exhausted.
