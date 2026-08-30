const express = require('express');
const supabase = require('../lib/supabase');
const { PLAN_CREDITS } = require('../lib/plans');

const router = express.Router();

router.post('/reset-credits', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('clinic_id, plan, current_period_start, current_period_end, clinic_credits(last_reset_at)')
      .in('status', ['active', 'trialing']);

    if (error) throw error;

    let processedCount = 0;

    for (const sub of subscriptions) {
      // Supabase join returns object or array, assume single object or first element
      const credits = Array.isArray(sub.clinic_credits) ? sub.clinic_credits[0] : sub.clinic_credits;
      
      // Idempotency: if already reset for this active billing period, skip
      if (credits && credits.last_reset_at && new Date(credits.last_reset_at) >= new Date(sub.current_period_start)) {
        continue;
      }

      const allocated = PLAN_CREDITS[sub.plan] || 0;

      // Reset monthly allocation and mark last_reset_at
      await supabase.from('clinic_credits').upsert({
        clinic_id: sub.clinic_id,
        credits_allocated: allocated,
        credits_used: 0,
        last_reset_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'clinic_id' });

      // Log allocation
      await supabase.from('credit_transactions').insert({
        clinic_id: sub.clinic_id,
        type: 'allocation',
        amount: allocated,
        ai_mode: 'system'
      });

      processedCount++;
    }

    res.json({ success: true, processed: processedCount });
  } catch (err) {
    console.error('Cron Reset Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
