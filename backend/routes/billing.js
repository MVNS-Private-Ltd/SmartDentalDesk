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

// ── POST /api/billing/create-order ───────────────────────────────────────────
// Creates a Razorpay payment order for paid plan subscriptions (Starter/Growth/Premium)
router.post('/create-order', requireAuth, [
  body('plan').isIn(['starter', 'growth', 'premium']).withMessage('Valid plan is required')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    if (req.isSuperAdmin) return res.status(403).json({ error: 'Super admin cannot purchase subscriptions.' });

    const clinicId = req.clinicId;
    const plan = req.body.plan;
    const amountPaise = PLAN_PRICES_PAISE[plan];

    if (!amountPaise) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }

    const receipt = `sub_${clinicId.slice(0, 8)}_${Date.now()}`;
    const keyId = process.env.RAZORPAY_KEY_ID;
    const isRealRazorpay = razorpay && keyId && !keyId.includes('REPLACE_WITH_REAL');

    if (isRealRazorpay) {
      // 1. Real Razorpay Order
      const rzpOrder = await razorpay.orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: receipt,
        notes: {
          clinic_id: clinicId,
          plan: plan,
          type: 'subscription'
        }
      });

      return res.json({
        order_id: rzpOrder.id,
        amount: amountPaise,
        currency: 'INR',
        key_id: keyId,
        plan: plan,
        plan_name: plan.charAt(0).toUpperCase() + plan.slice(1),
        price_rupees: amountPaise / 100,
        clinic_name: req.clinic?.name || req.clinic?.owner_name || '',
        clinic_email: req.clinic?.email || '',
        clinic_phone: req.clinic?.phone || '',
        is_simulated: false
      });
    }

    // 2. Fallback / Test Sandbox mode (creates valid order structure for client checkout)
    const crypto = require('crypto');
    const simOrderId = `order_${crypto.randomBytes(8).toString('hex')}`;

    return res.json({
      order_id: simOrderId,
      amount: amountPaise,
      currency: 'INR',
      key_id: keyId || 'rzp_test_placeholder',
      plan: plan,
      plan_name: plan.charAt(0).toUpperCase() + plan.slice(1),
      price_rupees: amountPaise / 100,
      clinic_name: req.clinic?.name || req.clinic?.owner_name || '',
      clinic_email: req.clinic?.email || '',
      clinic_phone: req.clinic?.phone || '',
      is_simulated: true
    });

  } catch (err) {
    console.error('[Billing] Error creating subscription order:', err);
    next(err);
  }
});

// ── POST /api/billing/verify-payment ──────────────────────────────────────────
// Verifies payment and activates paid subscription + allocates credits
router.post('/verify-payment', requireAuth, [
  body('plan').isIn(['starter', 'growth', 'premium']).withMessage('Valid plan is required'),
  body('razorpay_order_id').notEmpty().withMessage('Order ID is required'),
  body('razorpay_payment_id').optional(),
  body('razorpay_signature').optional(),
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    if (req.isSuperAdmin) return res.status(403).json({ error: 'Super admin cannot activate subscriptions.' });

    const { plan, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const clinicId = req.clinicId;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const isRealRazorpay = razorpay && keySecret && !keySecret.includes('REPLACE_WITH_REAL');

    // 1. Verify HMAC if real Razorpay transaction
    if (isRealRazorpay && razorpay_signature && razorpay_payment_id) {
      const crypto = require('crypto');
      const body = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(body)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ error: 'Invalid payment signature. Verification failed.' });
      }
    }

    const now = new Date();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days period
    const allocatedCredits = PLAN_CREDITS[plan] || 1000;

    // 2. Update/Upsert subscription record as ACTIVE (Paid)
    const { error: subErr } = await supabase
      .from('subscriptions')
      .upsert({
        clinic_id:                clinicId,
        plan:                     plan,
        status:                   'active',
        billing_cycle:            'monthly',
        current_period_start:     now.toISOString(),
        current_period_end:       periodEnd.toISOString(),
        trial_start_at:           null,
        trial_ends_at:            null,
        provider_subscription_id: razorpay_payment_id || razorpay_order_id,
        updated_at:               now.toISOString()
      }, { onConflict: 'clinic_id' });

    if (subErr) {
      console.error('[Billing] Subscription activation error:', subErr);
      throw subErr;
    }

    // 3. Allocate full plan monthly credits
    const { error: creditErr } = await supabase
      .from('clinic_credits')
      .upsert({
        clinic_id:         clinicId,
        credits_allocated: allocatedCredits,
        credits_used:      0,
        period_start:      now.toISOString(),
        period_end:        periodEnd.toISOString(),
        updated_at:        now.toISOString()
      }, { onConflict: 'clinic_id' });

    if (creditErr) {
      console.error('[Billing] Credits upsert error:', creditErr);
    }

    // 4. Update clinic profile
    await supabase.from('clinics').update({
      subscription_plan:     plan,
      is_marketplace_listed: PLAN_FEATURES[plan]?.marketplace || (plan !== 'starter')
    }).eq('id', clinicId);

    // 5. Log audit transaction
    await supabase.from('credit_transactions').insert({
      clinic_id: clinicId,
      type:      'allocation',
      amount:    allocatedCredits
    }).then(() => {}).catch(e => console.error('[Billing] Audit log error:', e));

    return res.json({
      success:      true,
      redirect_url: './dashboard.html',
      message:      `Successfully subscribed to ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan!`,
      plan:         plan,
      credits:      allocatedCredits,
      current_period_end: periodEnd.toISOString()
    });

  } catch (err) {
    console.error('[Billing] verify-payment error:', err);
    next(err);
  }
});

// ── POST /api/billing/create-trial ────────────────────────────────────────────
// Create 3-Month Free Trial session
router.post('/create-trial', requireAuth, [
  body('plan').optional().isIn(['starter', 'growth', 'premium']).withMessage('Invalid plan')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    if (req.isSuperAdmin) return res.status(403).json({ error: 'Super admin cannot create subscriptions.' });

    const clinicId = req.clinicId;
    const plan = req.body.plan || 'premium';

    // 1. Check existing subscription
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('status, plan, trial_ends_at, provider_customer_id')
      .eq('clinic_id', clinicId)
      .maybeSingle();

    const trialEndDate = new Date();
    trialEndDate.setMonth(trialEndDate.getMonth() + 3);

    if (existingSub && ['trialing', 'active'].includes(existingSub.status)) {
      return res.json({
        direct_activation: true,
        trial_ends_at: existingSub.trial_ends_at || trialEndDate.toISOString(),
        redirect_url: './dashboard.html',
        message: 'Subscription is already active.'
      });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const planIdEnvVarMap = {
      starter: process.env.RAZORPAY_PLAN_STARTER,
      growth:  process.env.RAZORPAY_PLAN_GROWTH,
      premium: process.env.RAZORPAY_PLAN_PREMIUM
    };
    const rzpPlanId = planIdEnvVarMap[plan];
    const isRealRazorpay = razorpay && keyId && !keyId.includes('REPLACE_WITH_REAL') && rzpPlanId && !rzpPlanId.includes('REPLACE_WITH');

    if (isRealRazorpay) {
      let rzpCustomerId;
      if (existingSub && existingSub.provider_customer_id) {
        rzpCustomerId = existingSub.provider_customer_id;
      } else {
        const customer = await razorpay.customers.create({
          name: req.clinic?.owner_name || req.clinic?.name || 'Doctor',
          email: req.clinic?.email || '',
          contact: req.clinic?.phone || undefined,
          notes: { clinic_id: clinicId }
        });
        rzpCustomerId = customer.id;
      }

      const trialStartAt = Math.floor(trialEndDate.getTime() / 1000);
      const rzpSub = await razorpay.subscriptions.create({
        plan_id: rzpPlanId,
        customer_id: rzpCustomerId,
        total_count: 120,
        customer_notify: 1,
        start_at: trialStartAt,
        notes: { clinic_id: clinicId, plan: plan }
      });

      return res.json({
        subscription_link: rzpSub.short_url,
        subscription_id:   rzpSub.id,
        trial_ends_at:     trialEndDate.toISOString(),
        razorpay_key_id:   keyId,
        clinic_name:       req.clinic?.name || req.clinic?.owner_name || '',
        clinic_email:      req.clinic?.email || '',
        clinic_phone:      req.clinic?.phone || '',
        is_simulated:      false
      });
    }

    // Direct sandbox / test mandate response
    const crypto = require('crypto');
    const simSubId = `sub_sim_${crypto.randomBytes(8).toString('hex')}`;

    return res.json({
      subscription_id:   simSubId,
      trial_ends_at:     trialEndDate.toISOString(),
      razorpay_key_id:   keyId || 'rzp_test_placeholder',
      clinic_name:       req.clinic?.name || req.clinic?.owner_name || '',
      clinic_email:      req.clinic?.email || '',
      clinic_phone:      req.clinic?.phone || '',
      is_simulated:      true
    });

  } catch (err) {
    console.error('[Billing] Error creating trial:', err);
    res.status(500).json({ error: 'Failed to create subscription session.' });
  }
});

// ── POST /api/billing/verify-trial ────────────────────────────────────────────
// Verifies card capture mandate and activates 3-month free trial
router.post('/verify-trial', requireAuth, [
  body('razorpay_subscription_id').notEmpty().withMessage('Subscription ID is required'),
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    if (req.isSuperAdmin) return res.status(403).json({ error: 'Super admin cannot verify subscriptions.' });

    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
    const clinicId = req.clinicId;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const isRealRazorpay = razorpay && keySecret && !keySecret.includes('REPLACE_WITH_REAL');

    if (isRealRazorpay && razorpay_signature && razorpay_payment_id) {
      const crypto = require('crypto');
      const body = `${razorpay_payment_id}|${razorpay_subscription_id}`;
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(body)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ error: 'Invalid payment signature. Verification failed.' });
      }
    }

    const now = new Date();
    const trialEndDate = new Date();
    trialEndDate.setMonth(trialEndDate.getMonth() + 3);
    const plan = 'premium';
    const allocatedCredits = PLAN_CREDITS[plan] || 10000;

    // 1. Update subscription to trialing
    const { error: subErr } = await supabase
      .from('subscriptions')
      .upsert({
        clinic_id:                clinicId,
        plan:                     plan,
        status:                   'trialing',
        billing_cycle:            'monthly',
        provider_subscription_id: razorpay_subscription_id,
        trial_start_at:           now.toISOString(),
        trial_ends_at:            trialEndDate.toISOString(),
        current_period_start:     now.toISOString(),
        current_period_end:       trialEndDate.toISOString(),
        updated_at:               now.toISOString()
      }, { onConflict: 'clinic_id' });

    if (subErr) throw subErr;

    // 2. Allocate 10,000 trial credits
    const { error: creditErr } = await supabase
      .from('clinic_credits')
      .upsert({
        clinic_id:         clinicId,
        credits_allocated: allocatedCredits,
        credits_used:      0,
        period_start:      now.toISOString(),
        period_end:        trialEndDate.toISOString(),
        updated_at:        now.toISOString()
      }, { onConflict: 'clinic_id' });

    if (creditErr) console.error('[Billing] Credits upsert error:', creditErr);

    // 3. Enable marketplace
    await supabase.from('clinics').update({
      subscription_plan:     'premium',
      is_marketplace_listed: true
    }).eq('id', clinicId);

    // 4. Log audit transaction
    await supabase.from('credit_transactions').insert({
      clinic_id: clinicId,
      type:      'allocation',
      amount:    allocatedCredits
    }).then(() => {}).catch(e => console.error('[Billing] Audit log error:', e));

    return res.json({
      success:       true,
      redirect_url:  './dashboard.html',
      message:       '3-Month Free Trial activated successfully!',
      trial_ends_at: trialEndDate.toISOString(),
    });

  } catch (err) {
    console.error('[Billing] verify-trial error:', err);
    next(err);
  }
});

// ── GET /api/billing/status ───────────────────────────────────────────────────
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
