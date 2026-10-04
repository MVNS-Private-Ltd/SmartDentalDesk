# Soft Launch Monitoring Checklist

Use this checklist during the first 7 days of the soft launch to ensure system stability and security.

## Daily Checks
- [ ] **Review Super Admin Monitoring Dashboard (`/super-admin-monitoring.html`)**
  - Check for any SEV-1 or SEV-2 security events.
  - Verify System Health shows "Online" and DB Connectivity is "ok".
  - Ensure Email Service is "Configured (production)".
  - Ensure Payment Webhooks is "Configured".
- [ ] **Check Render Logs**
  - Look for any unhandled promise rejections or memory warnings.
  - Search for `[AUDIT]` entries that did not trigger halts but indicate suspicious behavior.
- [ ] **Check Supabase Dashboard**
  - Monitor database CPU and memory usage.
  - Review connection pool limits.
  - Check Auth logs for unusual geographical login attempts.

## Weekly Checks
- [ ] **Review AI Token Usage**
  - Ensure AI interactions are not exceeding expected thresholds.
  - Verify no bypass attempts were successful.
- [ ] **Review Payment Failures**
  - Check `webhook.payment_failed` events. Reach out to affected clinics if systemic.
- [ ] **Review Email Delivery**
  - Check Resend dashboard for bounce rates or spam reports. Ensure the verified domain reputation remains high.

## Escalation Triggers
- **If > 5 Tenant Violations in a day:** Pause API, notify all clinics, investigate RLS/Middleware bypass.
- **If > 10% Payment Failure Rate:** Check Razorpay status page, verify webhook signatures.
- **If Database CPU > 80%:** Scale Supabase instance immediately.
