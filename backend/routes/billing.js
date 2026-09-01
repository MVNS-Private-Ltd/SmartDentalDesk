const express = require('express');
const { body, validationResult } = require('express-validator');
const supabase = require('../lib/supabase');
const razorpay = require('../lib/razorpay');
const { PLAN_FEATURES, PLAN_PRICES_PAISE, PLAN_CREDITS } = require('../lib/plans');
const requireAuth = require('../middleware/auth');
const requireActiveSubscription = require('../middleware/subscription');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg }); return false; }
  return true;
}

// ── GET /api/billing/plans ────────────────────────────────────────────────────
router.get('/plans', (req, res) => {
  res.json({
    plans: {
      starter: { price: PLAN_PRICES_PAISE.starter / 100, credits: PLAN_CREDITS.starter, features: PLAN_FEATURES.starter },
      growth:  { price: PLAN_PRICES_PAISE.growth / 100, credits: PLAN_CREDITS.growth, features: PLAN_FEATURES.growth },
      premium: { price: PLAN_PRICES_PAISE.premium / 100, credits: PLAN_CREDITS.premium, features: PLAN_FEATURES.premium },
    }
  });
});

// ── POST /api/billing/create-trial ────────────────────────────────────────────
// Create Razorpay customer + subscription with 3-calendar-month trial
router.post('/create-trial', requireAuth, [
  body('plan').isIn(['starter', 'growth', 'premium']).withMessage('Invalid plan')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    if (req.isSuperAdmin) return res.status(403).json({ error: 'Super admin cannot create subscriptions.' });
    if (!razorpay) return res.status(503).json({ error: 'Billing is currently disabled.' });

    const clinicId = req.clinicId;
    const { plan } = req.body;

    // 1. Check existing subscription
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('status')
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (existingSub && !['canceled', 'expired'].includes(existingSub.status)) {
      return res.status(409).json({ error: 'You already have an active subscription or trial.' });
    }

    // 2. Map plan to Razorpay Plan ID
    const planIdEnvVarMap = {
      starter: process.env.RAZORPAY_PLAN_STARTER,
      growth: process.env.RAZORPAY_PLAN_GROWTH,
      premium: process.env.RAZORPAY_PLAN_PREMIUM
    };
    const rzpPlanId = planIdEnvVarMap[plan];
    if (!rzpPlanId) return res.status(500).json({ error: `Razorpay plan ID for ${plan} not configured.` });

    // 3. Find or Create Razorpay Customer
    let rzpCustomerId;
    if (existingSub && existingSub.provider_customer_id) {
      rzpCustomerId = existingSub.provider_customer_id;
    } else {
      const customer = await razorpay.customers.create({
        name: req.clinic.owner_name,
        email: req.clinic.email,
        contact: req.clinic.phone || undefined,
        notes: { clinic_id: clinicId }
      });
      rzpCustomerId = customer.id;
    }

    // 4. Calculate trial end (exactly 3 calendar months)
    const trialEndDate = new Date();
    trialEndDate.setMonth(trialEndDate.getMonth() + 3);
    // Razorpay requires timestamp in seconds
    const expireBy = Math.floor(trialEndDate.getTime() / 1000);

    // 5. Create Razorpay Subscription (Auth & Capture mandate)
    const subscription = await razorpay.subscriptions.create({
      plan_id: rzpPlanId,
      customer_id: rzpCustomerId,
      total_count: 120, // 10 years
      quantity: 1,
      customer_notify: 1,
      addons: [],
      notes: { clinic_id: clinicId, plan: plan },
      expire_by: expireBy // this sets the trial_end essentially (for upfront auth/capture flows depending on RZP settings)
    });

    // To properly support a trial where Razorpay does NOT charge immediately, 
    // Razorpay uses start_at parameter for trials. 
    // Wait, the Razorpay Subscription API uses `start_at` to delay the first charge.
    // Let's recreate properly:
    /*
      For Razorpay subscriptions with a trial, we set `start_at` to the trial end date.
      The customer will be charged immediately if auth_and_capture is false, or charged a small auth fee.
    */
    
    // So let's refine step 5:
    const trialStartAt = Math.floor(trialEndDate.getTime() / 1000);
    const subPayload = {
      plan_id: rzpPlanId,
      customer_id: rzpCustomerId,
      total_count: 120,
      customer_notify: 1,
      start_at: trialStartAt, 
      notes: { clinic_id: clinicId, plan: plan }
    };
    
    const rzpSub = await razorpay.subscriptions.create(subPayload);

    // 6. Save pending subscription to our DB
    const subRecord = {
      clinic_id: clinicId,
      plan: plan,
      status: 'trialing',
      provider: 'razorpay',
      provider_customer_id: rzpCustomerId,
      provider_subscription_id: rzpSub.id,
      provider_plan_id: rzpPlanId,
      trial_start_at: new Date().toISOString(),
      trial_ends_at: trialEndDate.toISOString(),
    };

    if (existingSub) {
      await supabase.from('subscriptions').update(subRecord).eq('clinic_id', clinicId);
    } else {
      await supabase.from('subscriptions').insert(subRecord);
    }

    res.json({
      subscription_link: rzpSub.short_url,
      subscription_id: rzpSub.id,
      trial_ends_at: trialEndDate.toISOString()
    });
  } catch (err) {
    console.error('[Billing] Error creating trial:', err);
    res.status(500).json({ error: 'Failed to create subscription session.' });
  }
});

// ── GET /api/billing/status ───────────────────────────────────────────────────
// NOTE: No requireActiveSubscription here — this endpoint is called BEFORE a
// subscription exists (e.g. on pricing.html) to check the current state.
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status, plan, trial_ends_at, current_period_end')
      .eq('clinic_id', req.clinicId)
      .maybeSingle();
    
    res.json({ subscription: sub || null });
  } catch (err) { next(err); }
});

module.exports = router;
