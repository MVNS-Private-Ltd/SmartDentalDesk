const supabase = require('../lib/supabase');

module.exports = async function requireActiveSubscription(req, res, next) {
  try {
    // Skip for super_admin
    if (req.isSuperAdmin) return next();

    const clinicId = req.clinicId;
    if (!clinicId) return res.status(403).json({ error: 'No clinic associated.' });

    // Check suspension
    const clinic = req.clinic;
    if (clinic?.suspension_reason) {
      return res.status(403).json({
        error: 'Your account has been suspended. Please contact support.',
        code: 'ACCOUNT_SUSPENDED'
      });
    }

    const { data: sub, error } = await supabase
      .from('subscriptions')
      .select('status, plan, trial_ends_at, current_period_end')
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (error) {
      console.error('[Subscription Middleware] DB Error:', error);
      return res.status(500).json({ error: 'Failed to verify subscription status.' });
    }

    // No subscription at all
    if (!sub) {
      return res.status(402).json({
        error: 'No active subscription found. Start your free trial or choose a plan to continue.',
        code: 'NO_SUBSCRIPTION',
        redirect: '/pricing.html'
      });
    }

    const now = new Date();

    // ── Trialing ───────────────────────────────────────────────────────────────
    // Always validate server-side trial expiry — do not trust client state alone.
    if (sub.status === 'trialing') {
      if (sub.trial_ends_at && new Date(sub.trial_ends_at) < now) {
        // Trial has expired server-side — block access, show plan-selection message.
        // We do NOT auto-convert to a paid subscription; the clinic must choose.
        return res.status(402).json({
          error: 'Your free trial has ended. Choose a plan to continue.',
          code: 'TRIAL_EXPIRED',
          redirect: '/pricing.html'
        });
      }
      req.subscriptionStatus = sub.status;
      req.subscriptionPlan   = sub.plan;
      return next();
    }

    // ── Active ─────────────────────────────────────────────────────────────────
    if (sub.status === 'active') {
      req.subscriptionStatus = sub.status;
      req.subscriptionPlan   = sub.plan;
      return next();
    }

    // ── Cancel-pending ─────────────────────────────────────────────────────────
    // Renewal has been cancelled but the clinic paid for access until period end.
    // Grant access until current_period_end, then block — never trust status alone.
    if (sub.status === 'cancel_pending') {
      if (!sub.current_period_end || new Date(sub.current_period_end) < now) {
        // Paid entitlement has expired — now block and prompt plan selection.
        return res.status(402).json({
          error: 'Your paid subscription period has ended. Choose a plan to continue.',
          code: 'SUBSCRIPTION_ENDED',
          redirect: '/pricing.html'
        });
      }
      req.subscriptionStatus = sub.status;
      req.subscriptionPlan   = sub.plan;
      return next();
    }

    // ── Past due ───────────────────────────────────────────────────────────────
    if (sub.status === 'past_due') {
      res.setHeader('X-Billing-Warning', 'payment_failed');
      return res.status(402).json({
        error: 'Payment failed. Please update your payment method.',
        code: 'PAYMENT_FAILED',
        redirect: '/pricing.html'
      });
    }

    // ── Canceled / expired ─────────────────────────────────────────────────────
    // "canceled" here means: access has been fully terminated (no remaining period).
    if (sub.status === 'canceled' || sub.status === 'expired') {
      return res.status(402).json({
        error: 'Your subscription has ended. Choose a plan to continue.',
        code: 'SUBSCRIPTION_ENDED',
        redirect: '/pricing.html'
      });
    }

    return res.status(403).json({ error: 'Invalid subscription state.' });

  } catch (err) {
    console.error('[Subscription Middleware] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error during subscription check.' });
  }
};
