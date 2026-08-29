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

    if (!secret) {
      console.warn('⚠️ Webhook secret not configured, skipping validation');
      return res.status(200).send('Webhook ignored (no secret)');
    }

    // 1. Verify Signature
    const expectedSignature = crypto.createHmac('sha256', secret)
                                    .update(rawBody)
                                    .digest('hex');

    if (expectedSignature !== signature) {
      console.error('❌ Webhook signature mismatch');
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
      console.log(`[Webhook] Event ${eventId} already processed, skipping.`);
      return res.status(200).send('OK (Idempotent)');
    }

    // 4. Handle events
    if (eventType.startsWith('subscription.')) {
      await handleSubscriptionEvent(eventType, payload.payload.subscription.entity, eventId, payload);
    } else if (eventType.startsWith('payment.')) {
      // Topup payments handled here later
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('[Webhook] Error processing webhook:', err);
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
    .select('id, status, plan')
    .eq('clinic_id', clinicId)
    .single();

  if (!subRecord) {
    console.error(`[Webhook] No subscription row found for clinic ${clinicId}`);
    return;
  }

  let newStatus = subRecord.status;
  const now = new Date().toISOString();
  
  // State machine updates
  if (eventType === 'subscription.authenticated') {
    newStatus = 'trialing';
  } else if (eventType === 'subscription.activated' || eventType === 'subscription.charged') {
    newStatus = 'active';
  } else if (eventType === 'subscription.pending') {
    newStatus = 'past_due';
  } else if (eventType === 'subscription.halted' || eventType === 'subscription.cancelled') {
    newStatus = 'canceled';
  } else if (eventType === 'subscription.completed') {
    newStatus = 'expired';
  }

  const updates = {
    status: newStatus,
    updated_at: now
  };

  if (rzpSub.current_start) updates.current_period_start = new Date(rzpSub.current_start * 1000).toISOString();
  if (rzpSub.current_end) updates.current_period_end = new Date(rzpSub.current_end * 1000).toISOString();

  // Apply updates to subscriptions
  await supabase
    .from('subscriptions')
    .update(updates)
    .eq('id', subRecord.id);

  // If status changed to canceled or expired, remove marketplace visibility
  if (newStatus === 'canceled' || newStatus === 'expired') {
    await supabase.from('clinics').update({ is_marketplace_listed: false }).eq('id', clinicId);
  } else {
    // If active or trialing, set marketplace visibility based on plan features
    const isListed = PLAN_FEATURES[subRecord.plan]?.marketplace || false;
    await supabase.from('clinics').update({ is_marketplace_listed: isListed }).eq('id', clinicId);
  }

  // Record audit log
  await supabase.from('subscription_events').insert({
    clinic_id: clinicId,
    event_type: eventType,
    provider_event_id: eventId,
    payload: fullPayload
  });

  // Provision initial credits if entering trialing or active state
  if (eventType === 'subscription.authenticated' || eventType === 'subscription.activated') {
    const creditsToAllocate = PLAN_CREDITS[subRecord.plan] || 2500;
    
    // Upsert clinic_credits
    await supabase.from('clinic_credits').upsert({
      clinic_id: clinicId,
      credits_allocated: creditsToAllocate,
      credits_used: 0,
      period_start: updates.current_period_start || now,
      period_end: updates.current_period_end || null,
      updated_at: now
    }, { onConflict: 'clinic_id' });

    // Record allocation in ledger
    await supabase.from('credit_transactions').insert({
      clinic_id: clinicId,
      type: 'allocation',
      amount: creditsToAllocate,
      ai_mode: 'system'
    });
  }
}

module.exports = router;
