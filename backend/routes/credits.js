const express = require('express');
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const razorpay = require('../lib/razorpay');
const requireAuth = require('../middleware/auth');
const requireActiveSubscription = require('../middleware/subscription');

const router = express.Router();

const TOPUP_PACKS = {
  starter_pack: { credits: 500, amount_paise: 9900 },
  value_pack:   { credits: 2000, amount_paise: 29900 },
  power_pack:   { credits: 5000, amount_paise: 59900 },
};

router.use(requireAuth);
router.use(requireActiveSubscription);

// ── GET /api/credits/balance ──────────────────────────────────────────────────
router.get('/balance', async (req, res, next) => {
  try {
    const { data: credits, error } = await supabase
      .from('clinic_credits')
      .select('*')
      .eq('clinic_id', req.clinicId)
      .maybeSingle();

    if (error) throw error;
    
    // Also fetch total topup balance
    const { data: topups } = await supabase
      .from('credit_topup_lots')
      .select('credits_remaining')
      .eq('clinic_id', req.clinicId)
      .gt('expires_at', new Date().toISOString());
      
    let topupBalance = 0;
    if (topups) {
      topupBalance = topups.reduce((sum, row) => sum + row.credits_remaining, 0);
    }

    res.json({
      monthly: credits || { credits_allocated: 0, credits_used: 0 },
      topup: topupBalance,
      total_remaining: (credits ? Math.max(0, credits.credits_allocated - credits.credits_used) : 0) + topupBalance
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
    res.json(data);
  } catch (err) { next(err); }
});

// ── POST /api/credits/topup/create-order ──────────────────────────────────────
router.post('/topup/create-order', async (req, res, next) => {
  try {
    const { pack_id } = req.body;
    const pack = TOPUP_PACKS[pack_id];
    if (!pack) return res.status(400).json({ error: 'Invalid top-up pack selected' });

    // 1. Create Razorpay Order
    const options = {
      amount: pack.amount_paise,
      currency: "INR",
      receipt: `receipt_${req.clinicId}_${Date.now()}`
    };
    const order = await razorpay.orders.create(options);

    // 2. Save pending order in DB
    const { error: insertErr } = await supabase.from('topup_orders').insert({
      clinic_id: req.clinicId,
      pack_id: pack_id,
      credits_purchased: pack.credits,
      amount_paise: pack.amount_paise,
      provider_order_id: order.id,
      status: 'created'
    });
    if (insertErr) throw insertErr;

    res.json({
      order_id: order.id,
      amount: pack.amount_paise,
      currency: "INR",
      key_id: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) { next(err); }
});

// ── POST /api/credits/topup/verify ────────────────────────────────────────────
router.post('/topup/verify', async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // 1. Verify HMAC
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // 2. Fetch Order
    const { data: orderRec, error: fetchErr } = await supabase
      .from('topup_orders')
      .select('*')
      .eq('provider_order_id', razorpay_order_id)
      .eq('clinic_id', req.clinicId)
      .single();
    
    if (fetchErr || !orderRec) throw new Error('Order not found or access denied');
    if (orderRec.status === 'paid') return res.json({ success: true, message: 'Already processed' });

    // 3. Mark Paid & Insert Topup Lot
    await supabase.from('topup_orders').update({
      provider_payment_id: razorpay_payment_id,
      status: 'paid'
    }).eq('id', orderRec.id);

    // Add to lots (12 months expiry)
    await supabase.from('credit_topup_lots').insert({
      clinic_id: req.clinicId,
      credits_original: orderRec.credits_purchased,
      credits_remaining: orderRec.credits_purchased,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    });

    // Add transaction
    await supabase.from('credit_transactions').insert({
      clinic_id: req.clinicId,
      type: 'topup',
      amount: orderRec.credits_purchased
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
