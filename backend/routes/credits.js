const express = require('express');
const supabase = require('../lib/supabase');
const requireAuth = require('../middleware/auth');
const requireActiveSubscription = require('../middleware/subscription');

const router = express.Router();

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

module.exports = router;
