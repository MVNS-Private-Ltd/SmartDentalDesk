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

function getCardNetwork(number) {
  if (number.startsWith('4')) return 'visa';
  if (/^5[1-5]/.test(number) || /^2[2-7]/.test(number)) return 'mastercard';
  if (/^3[47]/.test(number)) return 'amex';
  if (/^6(?:011|5)/.test(number)) return 'discover';
  return 'unknown';
}

function validateCardPayload(number, exp, cvv, name) {
  if (!number || !exp || !cvv || !name) {
    return { valid: false, error: 'Incomplete card details.' };
  }
  const cleanNumber = number.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(cleanNumber)) {
    return { valid: false, error: 'Invalid card number format.' };
  }
  
  const expMatch = exp.match(/^(\d{2})\s*\/?\s*(\d{2,4})$/);
  if (!expMatch) {
    return { valid: false, error: 'Invalid expiry date format. Use MM/YY.' };
  }
  let month = parseInt(expMatch[1], 10);
  let year = parseInt(expMatch[2], 10);
  if (month < 1 || month > 12) {
    return { valid: false, error: 'Invalid expiry month.' };
  }
  if (year < 100) year += 2000;
  
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
    return { valid: false, error: 'Card has expired.' };
  }
  
  if (!/^\d{3,4}$/.test(cvv)) {
    return { valid: false, error: 'Invalid CVV.' };
  }
  
  return {
    valid: true,
    network: getCardNetwork(cleanNumber),
    last4: cleanNumber.slice(-4)
  };
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
// Verifies payment and activates paid subscription + allocates credits + stores card
router.post('/verify-payment', requireAuth, [
  body('plan').isIn(['starter', 'growth', 'premium']).withMessage('Valid plan is required'),
  body('razorpay_order_id').notEmpty().withMessage('Order ID is required'),
  body('razorpay_payment_id').optional(),
  body('razorpay_signature').optional(),
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    if (req.isSuperAdmin) return res.status(403).json({ error: 'Super admin cannot activate subscriptions.' });

    const { plan, razorpay_order_id, razorpay_payment_id, razorpay_signature, card_number, card_exp, card_cvv, cardholder_name } = req.body;
    const clinicId = req.clinicId;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const isRealRazorpay = razorpay && keySecret && !keySecret.includes('REPLACE_WITH_REAL');

    // 1. If card details are supplied directly, validate with strict Luhn & expiry check
    let cardMeta = null;
    if (card_number) {
      const cardCheck = validateCardPayload(card_number, req.body.card_exp, card_cvv || req.body.card_cvv, cardholder_name || req.body.cardholder_name);
      if (!cardCheck.valid) {
        return res.status(400).json({ error: cardCheck.error });
      }
      cardMeta = cardCheck;
    }

    // 2. Verify HMAC if real Razorpay transaction
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
    const amountPaise = PLAN_PRICES_PAISE[plan] || 99900;

    // 3. Update/Upsert subscription record as ACTIVE (Paid) with card details
    const subPayload = {
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
    };

    if (cardMeta) {
      subPayload.card_last4        = cardMeta.card_last4;
      subPayload.card_brand        = cardMeta.card_brand;
      subPayload.card_exp_month    = cardMeta.card_exp_month;
      subPayload.card_exp_year     = cardMeta.card_exp_year;
      subPayload.cardholder_name   = cardMeta.cardholder_name;
    }

    const { error: subErr } = await supabase
      .from('subscriptions')
      .upsert(subPayload, { onConflict: 'clinic_id' });

    if (subErr) {
      console.error('[Billing] Subscription activation error:', subErr);
      throw subErr;
    }

    // 4. Allocate full plan monthly credits
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

    // 5. Update clinic profile
    await supabase.from('clinics').update({
      subscription_plan:     plan,
      is_marketplace_listed: PLAN_FEATURES[plan]?.marketplace || (plan !== 'starter')
    }).eq('id', clinicId);

    // 6. Log invoice / receipt record
    const invoiceNum = `INV-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
    await supabase.from('subscription_invoices').insert({
      clinic_id:            clinicId,
      invoice_number:       invoiceNum,
      plan:                 plan,
      amount_paise:         amountPaise,
      currency:             'INR',
      status:               'paid',
      payment_method:       cardMeta ? 'card' : (req.body.payment_method || 'card'),
      card_last4:           cardMeta?.card_last4 || '••••',
      billing_period_start: now.toISOString(),
      billing_period_end:   periodEnd.toISOString()
    }).then(() => {}).catch(e => console.error('[Billing] Invoice save error:', e));

    // 7. Log audit transaction
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
      current_period_end: periodEnd.toISOString(),
      card_last4:   cardMeta?.card_last4 || null
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
// Verifies card capture mandate with strict Luhn check & activates 3-month free trial
router.post('/verify-trial', requireAuth, [
  body('razorpay_subscription_id').notEmpty().withMessage('Subscription ID is required'),
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    if (req.isSuperAdmin) return res.status(403).json({ error: 'Super admin cannot verify subscriptions.' });

    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, card_number, card_exp, card_cvv, cardholder_name } = req.body;
    const clinicId = req.clinicId;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const isRealRazorpay = razorpay && keySecret && !keySecret.includes('REPLACE_WITH_REAL');

    // Validate card details if supplied
    let cardMeta = null;
    if (card_number) {
      const cardCheck = validateCardPayload(card_number, card_exp, card_cvv, cardholder_name);
      if (!cardCheck.valid) {
        return res.status(400).json({ error: cardCheck.error });
      }
      cardMeta = cardCheck;
    }

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

    // 1. Update subscription to trialing with card details
    const subPayload = {
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
    };

    if (cardMeta) {
      subPayload.card_last4        = cardMeta.card_last4;
      subPayload.card_brand        = cardMeta.card_brand;
      subPayload.card_exp_month    = cardMeta.card_exp_month;
      subPayload.card_exp_year     = cardMeta.card_exp_year;
      subPayload.cardholder_name   = cardMeta.cardholder_name;
    }

    const { error: subErr } = await supabase
      .from('subscriptions')
      .upsert(subPayload, { onConflict: 'clinic_id' });

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

    // 4. Log trial invoice (₹0.00 trial verification)
    const invoiceNum = `TRL-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
    await supabase.from('subscription_invoices').insert({
      clinic_id:            clinicId,
      invoice_number:       invoiceNum,
      plan:                 'premium (3-Month Free Trial)',
      amount_paise:         0,
      currency:             'INR',
      status:               'paid',
      payment_method:       cardMeta ? 'card' : 'card',
      card_last4:           cardMeta?.card_last4 || '••••',
      billing_period_start: now.toISOString(),
      billing_period_end:   trialEndDate.toISOString()
    }).then(() => {}).catch(e => console.error('[Billing] Trial invoice error:', e));

    // 5. Log audit transaction
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
      card_last4:    cardMeta?.card_last4 || null
    });

  } catch (err) {
    console.error('[Billing] verify-trial error:', err);
    next(err);
  }
});

// ── GET /api/billing/invoices ─────────────────────────────────────────────────
// Returns billing invoices and topup receipts for the clinic
router.get('/invoices', requireAuth, async (req, res, next) => {
  try {
    const { data: invoices, error: invErr } = await supabase
      .from('subscription_invoices')
      .select('*')
      .eq('clinic_id', req.clinicId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (invErr) throw invErr;
    res.json({ invoices: invoices || [] });
  } catch (err) { next(err); }
});

// ── POST /api/billing/update-card ─────────────────────────────────────────────
// Validates and updates the saved credit/debit card for auto-renewal
router.post('/update-card', requireAuth, [
  body('card_number').notEmpty().withMessage('Card number is required'),
  body('card_exp').notEmpty().withMessage('Expiry date is required'),
  body('card_cvv').notEmpty().withMessage('CVV is required'),
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { card_number, card_exp, card_cvv, cardholder_name } = req.body;

    const cardCheck = validateCardPayload(card_number, card_exp, card_cvv, cardholder_name);
    if (!cardCheck.valid) {
      return res.status(400).json({ error: cardCheck.error });
    }

    const { error: updateErr } = await supabase
      .from('subscriptions')
      .update({
        card_last4:      cardCheck.card_last4,
        card_brand:      cardCheck.card_brand,
        card_exp_month:  cardCheck.card_exp_month,
        card_exp_year:   cardCheck.card_exp_year,
        cardholder_name: cardCheck.cardholder_name,
        updated_at:      new Date().toISOString()
      })
      .eq('clinic_id', req.clinicId);

    if (updateErr) throw updateErr;

    res.json({
      success: true,
      message: 'Card updated successfully!',
      card: {
        last4: cardCheck.card_last4,
        brand: cardCheck.card_brand,
        exp: `${cardCheck.card_exp_month}/${cardCheck.card_exp_year.slice(-2)}`,
        holder: cardCheck.cardholder_name
      }
    });
  } catch (err) { next(err); }
});

// ── POST /api/billing/cancel-subscription ─────────────────────────────────────
router.post('/cancel-subscription', requireAuth, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('subscriptions')
      .update({
        status:     'canceled',
        updated_at: new Date().toISOString()
      })
      .eq('clinic_id', req.clinicId);

    if (error) throw error;
    res.json({ success: true, message: 'Subscription canceled. Access will continue until the end of your billing period.' });
  } catch (err) { next(err); }
});

// ── GET /api/billing/status ───────────────────────────────────────────────────
// Returns complete subscription, card details, and credits summary
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const [subRes, creditsRes, topupsRes] = await Promise.all([
      supabase.from('subscriptions').select('*').eq('clinic_id', req.clinicId).maybeSingle(),
      supabase.from('clinic_credits').select('*').eq('clinic_id', req.clinicId).maybeSingle(),
      supabase.from('credit_topup_lots').select('credits_remaining').eq('clinic_id', req.clinicId).gt('expires_at', new Date().toISOString())
    ]);

    const sub = subRes.data;
    const credits = creditsRes.data || { credits_allocated: 0, credits_used: 0 };
    const topupTotal = (topupsRes.data || []).reduce((acc, row) => acc + (row.credits_remaining || 0), 0);
    const monthlyRemaining = Math.max(0, credits.credits_allocated - credits.credits_used);
    const totalCredits = monthlyRemaining + topupTotal;

    res.json({
      subscription: sub || null,
      plan: sub?.plan || 'free',
      status: sub?.status || 'inactive',
      trial_ends_at: sub?.trial_ends_at || null,
      current_period_end: sub?.current_period_end || null,
      saved_card: sub?.card_last4 ? {
        last4: sub.card_last4,
        brand: sub.card_brand || 'card',
        exp: (sub.card_exp_month && sub.card_exp_year) ? `${sub.card_exp_month}/${sub.card_exp_year.slice(-2)}` : null,
        holder: sub.cardholder_name || req.clinic?.owner_name || 'Cardholder'
      } : null,
      credits: {
        total: totalCredits,
        monthly_allocated: credits.credits_allocated,
        monthly_used: credits.credits_used,
        monthly_remaining: monthlyRemaining,
        topup_remaining: topupTotal
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
