const supabase = require('./supabase');
const { CREDIT_COSTS } = require('./plans');

// Soft tracking for Phase 1 (No hard enforcement/blocking)
async function trackAiUsage(clinicId, aiMode) {
  try {
    const cost = CREDIT_COSTS[aiMode] || 1;

    // 1. Log transaction
    const { data: txn, error: txnErr } = await supabase.from('credit_transactions').insert({
      clinic_id: clinicId,
      type: 'usage',
      amount: -cost,
      ai_mode: aiMode
    }).select('id').single();

    if (txnErr) {
      console.error('[Credits] Failed to log transaction:', txnErr);
      return null;
    }

    // 2. Update clinic_credits usage counter
    // For Phase 1 tracking, a simple read-modify-write is acceptable.
    // Phase 2 will replace this with atomic Postgres functions.
    const { data: current } = await supabase
      .from('clinic_credits')
      .select('credits_used')
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (current) {
      await supabase
        .from('clinic_credits')
        .update({ credits_used: current.credits_used + cost })
        .eq('clinic_id', clinicId);
    }

    return txn.id;
  } catch (err) {
    console.error('[Credits] Tracking error:', err);
    return null;
  }
}

module.exports = { trackAiUsage };
