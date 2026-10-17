const express = require('express');
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { PLAN_CREDITS, PLAN_FEATURES } = require('../lib/plans');

const router = express.Router();

// The body parser is raw in server.js, so req.body is a Buffer
router.post('/', async (req, res) => {
  try {
    const rawBody = req.body;
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const { logAuditEvent, trackAndHalt } = require('../lib/auditLogger');

    if (!secret) {
      console.warn('⚠️ Webhook secret not configured, skipping validation');
      return res.status(200).send('Webhook ignored (no secret)');
    }

    // 1. Verify Signature
    const expectedSignature = crypto.createHmac('sha256', secret)
                                    .update(rawBody)
                                    .digest('hex');

    if (expectedSignature !== signature) {
      logAuditEvent('webhook.signature_failed', { ip: req.ip });
      if (trackAndHalt('webhook_signature_failure', req.ip, 5, 10 * 60 * 1000)) {
        return res.status(429).send('Too many invalid signatures');
      }
      return res.status(400).send('Invalid signature');
    }

    // 2. Parse payload
    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventType = payload.event;
    const eventId = req.headers['x-razorpay-event-id'];

    console.log(`[Webhook] Received ${eventType} (ID: ${eventId})`);

    // 3. Idempotency Check
    const { data: existingEvent } = await supabase
      .from('subscription_events')
      .select('id')
      .eq('provider_event_id', eventId)
      .maybeSingle();

    if (existingEvent) {
      logAuditEvent('webhook.duplicate_event', { providerEventId: eventId });
      trackAndHalt('webhook_duplicate', req.ip, 10, 10 * 60 * 1000); // just track
      return res.status(200).send('OK (Idempotent)');
    }

    // 4. Handle events
    if (eventType.startsWith('subscription.')) {
      await handleSubscriptionEvent(eventType, payload.payload.subscription.entity, eventId, payload);
    } else if (eventType.startsWith('payment.failed')) {
      logAuditEvent('webhook.payment_failed', { providerEventId: eventId });
    } else if (eventType.startsWith('payment.')) {
      // Topup payments handled here later
    }

    res.status(200).send('OK');
  } catch (err) {
    const { logAuditEvent } = require('../lib/auditLogger');
    logAuditEvent('webhook.processing_error', { reason: err.message });
    res.status(500).send('Internal Error');
  }
});

async function handleSubscriptionEvent(eventType, rzpSub, eventId, fullPayload) {
  const rzpSubId = rzpSub.id;
  const clinicId = rzpSub.notes?.clinic_id;
  const planName = rzpSub.notes?.plan || 'starter'; // Default fallback

  if (!clinicId) {
    console.error(`[Webhook] Missing clinic_id in notes for sub ${rzpSubId}`);
    return;
  }

  // Find existing subscription
  const { data: subRecord } = await supabase
    .from('subscriptions')
    .select('id, status, plan, current_period_end')
    .eq('clinic_id', clinicId)
    .single();

  if (!subRecord) {
    console.error(`[Webhook] No subscription row found for clinic ${clinicId}`);
    return;
  }

  let newStatus = subRecord.status;
  const now = new Date().toISOString();

  // ── State machine ──────────────────────────────────────────────────────────
  if (eventType === 'subscription.authenticated') {
    newStatus = 'trialing';

  } else if (eventType === 'subscription.activated' || eventType === 'subscription.charged') {
    // A charge has occurred — subscription is now active regardless of previous state.
    // If it was cancel_pending (Razorpay fired a final charge before cancel took effect),
    // that is unexpected; keep as active and let the next cycle end handle it.
    newStatus = 'active';

  } else if (eventType === 'subscription.pending') {
    newStatus = 'past_due';

  } else if (eventType === 'subscription.cancelled') {
    // Razorpay fires this when cancellation actually takes effect at cycle end.
    // If we had cancel_pending locally, this is the expected terminal event —
    // the paid period has genuinely ended and Razorpay has confirmed it.
    // Transition to 'canceled' (full termination, no remaining access).
    if (subRecord.status === 'cancel_pending' || subRecord.status === 'active') {
      newStatus = 'canceled';
    } else if (subRecord.status === 'trialing') {
      // Trial mandate cancelled — immediate termination
      newStatus = 'canceled';
    }
    // If already canceled, expired, or other terminal state: no change.

  } else if (eventType === 'subscription.halted') {
    newStatus = 'canceled';

  } else if (eventType === 'subscription.completed') {
    newStatus = 'expired';
  }

  const updates = {
    status:     newStatus,
    updated_at: now
  };

  if (rzpSub.current_start) updates.current_period_start = new Date(rzpSub.current_start * 1000).toISOString();
  if (rzpSub.current_end)   updates.current_period_end   = new Date(rzpSub.current_end   * 1000).toISOString();

  // Apply status update
  await supabase
    .from('subscriptions')
    .update(updates)
    .eq('id', subRecord.id);

  // Marketplace visibility:
  // - Remove only when fully canceled/expired (not while cancel_pending — access still valid)
  // - Restore when active or trialing
  if (newStatus === 'canceled' || newStatus === 'expired') {
    await supabase.from('clinics').update({ is_marketplace_listed: false }).eq('id', clinicId);
  } else if (newStatus === 'active' || newStatus === 'trialing') {
    const isListed = PLAN_FEATURES[subRecord.plan]?.marketplace || false;
    await supabase.from('clinics').update({ is_marketplace_listed: isListed }).eq('id', clinicId);
  }
  // cancel_pending: leave marketplace visibility unchanged — access still valid

  // Record audit log
  await supabase.from('subscription_events').insert({
    clinic_id:        clinicId,
    event_type:       eventType,
    provider_event_id: eventId,
    payload:          fullPayload
  });

  // Provision initial credits if entering trialing or active state for the first time
  if (eventType === 'subscription.authenticated' || eventType === 'subscription.activated') {
    const creditsToAllocate = PLAN_CREDITS[subRecord.plan] || 900;

    await supabase.from('clinic_credits').upsert({
      clinic_id:         clinicId,
      credits_allocated: creditsToAllocate,
      credits_used:      0,
      period_start:      updates.current_period_start || now,
      period_end:        updates.current_period_end   || null,
      updated_at:        now
    }, { onConflict: 'clinic_id' });

    await supabase.from('credit_transactions').insert({
      clinic_id: clinicId,
      type:      'allocation',
      amount:    creditsToAllocate,
      ai_mode:   'system'
    });
  }
}

module.exports = router;
