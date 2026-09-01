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
  body('plan').optional().isIn(['starter', 'growth', 'premium']).withMessage('Invalid plan')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    if (req.isSuperAdmin) return res.status(403).json({ error: 'Super admin cannot create subscriptions.' });

    const clinicId = req.clinicId;
    const plan = req.body.plan || 'premium'; // Default to premium for 3-month free trial

    // 1. Check existing subscription
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('status, plan, trial_ends_at, provider_customer_id')
      .eq('clinic_id', clinicId)
      .maybeSingle();

    // 2. Calculate trial end (exactly 3 calendar months)
    const trialEndDate = new Date();
    trialEndDate.setMonth(trialEndDate.getMonth() + 3);
    const allocatedCredits = PLAN_CREDITS[plan] || 10000;

    if (existingSub && ['trialing', 'active'].includes(existingSub.status)) {
      return res.json({
        direct_activation: true,
        trial_ends_at: existingSub.trial_ends_at || trialEndDate.toISOString(),
        redirect_url: './dashboard.html',
        message: 'Subscription is already active.'
      });
    }

    // 3. Map plan to Razorpay Plan ID
    const planIdEnvVarMap = {
      starter: process.env.RAZORPAY_PLAN_STARTER,
      growth: process.env.RAZORPAY_PLAN_GROWTH,
      premium: process.env.RAZORPAY_PLAN_PREMIUM
    };
    const rzpPlanId = planIdEnvVarMap[plan];

    // If Razorpay is not configured or plan IDs are missing, provide direct trial activation
    if (!razorpay || !rzpPlanId) {
      console.warn(`[Billing] Razorpay not configured for ${plan}. Granting direct trial.`);
      const subRecord = {
        clinic_id: clinicId,
        plan: plan,
        status: 'trialing',
        trial_start_at: new Date().toISOString(),
        trial_ends_at: trialEndDate.toISOString(),
      };

      const { error: subErr } = await supabase
        .from('subscriptions')
        .upsert(subRecord, { onConflict: 'clinic_id' });

      if (subErr) {
        console.error('[Billing] Subscription upsert error:', subErr);
        throw subErr;
      }

      // Initialize credits allocation
      const { error: creditErr } = await supabase
        .from('clinic_credits')
        .upsert({
          clinic_id: clinicId,
          credits_allocated: allocatedCredits,
          credits_used: 0,
          last_reset_at: new Date().toISOString()
        }, { onConflict: 'clinic_id' });

      if (creditErr) {
        console.error('[Billing] Credits upsert error:', creditErr);
      }

      // Enable marketplace if plan allows
      await supabase.from('clinics').update({
        is_marketplace_listed: PLAN_FEATURES[plan]?.marketplace || true
      }).eq('id', clinicId);

      return res.json({
        direct_activation: true,
        trial_ends_at: trialEndDate.toISOString(),
        redirect_url: './dashboard.html',
        message: '3-Month Free Trial activated successfully.'
      });
    }

    // 4. Find or Create Razorpay Customer
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

    // 5. Create Razorpay Subscription with start_at set to trial end
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
      provider_customer_id: rzpCustomerId,
      provider_subscription_id: rzpSub.id,
      provider_plan_id: rzpPlanId,
      trial_start_at: new Date().toISOString(),
      trial_ends_at: trialEndDate.toISOString(),
    };

    const { error: subErr } = await supabase
      .from('subscriptions')
      .upsert(subRecord, { onConflict: 'clinic_id' });

    if (subErr) {
      console.error('[Billing] Subscription upsert error:', subErr);
      throw subErr;
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
