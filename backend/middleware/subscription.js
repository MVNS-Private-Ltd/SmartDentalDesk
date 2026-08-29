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
      
    // No subscription = Blocked
    if (!sub) {
      return res.status(402).json({
        error: 'No active subscription found. Please complete your registration and start your trial.',
        code: 'NO_SUBSCRIPTION',
        redirect: '/pricing.html'
      });
    }
    
    // Trialing
    if (sub.status === 'trialing') {
      req.subscriptionStatus = sub.status;
      req.subscriptionPlan = sub.plan;
      return next();
    }
    
    // Active
    if (sub.status === 'active') {
      req.subscriptionStatus = sub.status;
      req.subscriptionPlan = sub.plan;
      return next();
    }

    // Past due: block access
    if (sub.status === 'past_due') {
      res.setHeader('X-Billing-Warning', 'payment_failed');
      return res.status(402).json({
        error: 'Payment failed. Please update your payment method.',
        code: 'PAYMENT_FAILED',
        redirect: '/pricing.html'
      });
    }
    
    // Canceled/expired: Block access
    if (sub.status === 'canceled' || sub.status === 'expired') {
      return res.status(402).json({
        error: 'Your subscription has ended. Please renew to access your dashboard.',
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
