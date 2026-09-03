const express = require('express');
const crypto  = require('crypto');
const supabase = require('../lib/supabase');
const razorpay = require('../lib/razorpay');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// Pack IDs used in both billing.html and dashboard.html topup modals
const TOPUP_PACKS = {
  // billing.html IDs
  starter_pack: { credits: 500,   amount_paise: 9900   },
  value_pack:   { credits: 2000,  amount_paise: 29900  },
  power_pack:   { credits: 5000,  amount_paise: 59900  },
  // dashboard.html modal IDs
  pack_500:     { credits: 500,   amount_paise: 9900   },
  pack_2000:    { credits: 2000,  amount_paise: 29900  },
  pack_5000:    { credits: 5000,  amount_paise: 59900  },
};

router.use(requireAuth);
// NOTE: requireActiveSubscription deliberately removed so users on trial
//       can also top-up credits without being blocked.

// ── GET /api/credits/balance ──────────────────────────────────────────────────
router.get('/balance', async (req, res, next) => {
  try {
    const { data: credits, error } = await supabase
      .from('clinic_credits')
      .select('*')
      .eq('clinic_id', req.clinicId)
      .maybeSingle();

    if (error) throw error;

    const { data: topups } = await supabase
      .from('credit_topup_lots')
      .select('credits_remaining')
      .eq('clinic_id', req.clinicId)
      .gt('expires_at', new Date().toISOString());

    let topupBalance = 0;
    if (topups) {
      topupBalance = topups.reduce((sum, row) => sum + (row.credits_remaining || 0), 0);
    }

    res.json({
      monthly: credits || { credits_allocated: 0, credits_used: 0 },
      topup: topupBalance,
      total_remaining: (credits ? Math.max(0, (credits.credits_allocated || 0) - (credits.credits_used || 0)) : 0) + topupBalance
    });
  } catch (err) { next(err); }
});

// ── GET /api/credits/history ──────────────────────────────────────────────────
router.get('/history', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('clinic_id', req.clinicId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

// ── POST /api/credits/topup/create-order ─────────────────────────────────────
router.post('/topup/create-order', async (req, res, next) => {
  try {
    const { pack_id } = req.body;
    const pack = TOPUP_PACKS[pack_id];
    if (!pack) return res.status(400).json({ error: 'Invalid top-up pack selected' });

    const keyId     = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const isRealRazorpay = razorpay && keyId && keySecret
      && !keyId.includes('REPLACE_WITH_REAL')
      && !keyId.includes('placeholder');

    if (isRealRazorpay) {
      // Real Razorpay order
      const order = await razorpay.orders.create({
        amount: pack.amount_paise,
        currency: 'INR',
        receipt: `topup_${req.clinicId.slice(0, 8)}_${Date.now()}`
      });

      // Save pending order
      await supabase.from('topup_orders').insert({
        clinic_id:         req.clinicId,
        pack_id:           pack_id,
        credits_purchased: pack.credits,
        amount_paise:      pack.amount_paise,
        provider_order_id: order.id,
        status:            'created'
      });

      return res.json({
        order_id:    order.id,
        amount:      pack.amount_paise,
        currency:    'INR',
        key_id:      keyId,
        credits:     pack.credits,
        is_simulated: false
      });
    }

    // ── Sandbox / Demo mode ──────────────────────────────────────────────────
    const simOrderId = `order_sim_${crypto.randomBytes(8).toString('hex')}`;
    return res.json({
      order_id:     simOrderId,
      amount:       pack.amount_paise,
      currency:     'INR',
      key_id:       keyId || 'rzp_test_placeholder',
      credits:      pack.credits,
      pack_id:      pack_id,
      is_simulated: true
    });

  } catch (err) { next(err); }
});

// ── POST /api/credits/topup/verify ────────────────────────────────────────────
router.post('/topup/verify', async (req, res, next) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      pack_id,             // supplied in sandbox mode
      credits_added        // optional override
    } = req.body;

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const isRealRazorpay = razorpay && keySecret
      && !keySecret.includes('REPLACE_WITH_REAL')
      && !keySecret.includes('placeholder');

    let creditsToAdd = 0;
    let packInfo     = null;

    if (isRealRazorpay) {
      // ── Real Razorpay: verify HMAC signature ────────────────────────────
      const expectedSig = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (expectedSig !== razorpay_signature) {
        return res.status(400).json({ error: 'Invalid payment signature. Verification failed.' });
      }

      // Fetch saved order record
      const { data: orderRec, error: fetchErr } = await supabase
        .from('topup_orders')
        .select('*')
        .eq('provider_order_id', razorpay_order_id)
        .eq('clinic_id', req.clinicId)
        .single();

      if (fetchErr || !orderRec) throw new Error('Order not found or access denied');
      if (orderRec.status === 'paid') return res.json({ success: true, credits_added: 0, message: 'Already processed' });

      creditsToAdd = orderRec.credits_purchased;

      // Mark order paid
      await supabase.from('topup_orders').update({
        provider_payment_id: razorpay_payment_id,
        status: 'paid'
      }).eq('id', orderRec.id);

    } else {
      // ── Sandbox mode: credit based on pack_id ───────────────────────────
      if (pack_id) {
        packInfo = TOPUP_PACKS[pack_id];
      }
      creditsToAdd = (packInfo?.credits) || (credits_added || 0);
      if (creditsToAdd <= 0) {
        return res.status(400).json({ error: 'Cannot determine credits amount for this order.' });
      }
    }

    // Add topup lot (expires in 12 months)
    await supabase.from('credit_topup_lots').insert({
      clinic_id:        req.clinicId,
      credits_original: creditsToAdd,
      credits_remaining: creditsToAdd,
      expires_at:       new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    });

    // Log transaction
    await supabase.from('credit_transactions').insert({
      clinic_id: req.clinicId,
      type:      'topup',
      amount:    creditsToAdd
    });

    res.json({ success: true, credits_added: creditsToAdd });
  } catch (err) { next(err); }
});

module.exports = router;
