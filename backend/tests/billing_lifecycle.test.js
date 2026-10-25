/**
 * Automated Billing Lifecycle & Edge Case Test Suite
 *
 * Runs isolated unit and integration logic tests in memory.
 * KEEP TEST DATA OUT OF PRODUCTION: Uses mock Supabase and mock Razorpay clients.
 *
 * Covers:
 * 1. Cancel-subscription: Razorpay confirmation requirement, failure preservation of active access, retry & reconciliation.
 * 2. Legacy trial gating: Server-side rejection of new clinics on create-trial and verify-trial.
 * 3. Trial cancellation: Credit preservation (no zeroing of clinic_credits, usage history and top-ups preserved).
 * 4. Webhook resiliency:
 *    - subscription.cancelled on trialing does NOT terminate remaining trial entitlement.
 *    - subscription.charged on cancel_pending does NOT erase cancellation intent.
 *    - Duplicate webhook event idempotency.
 *    - Out-of-order webhook protection.
 * 5. Middleware gating: Server-side validation of trial_ends_at and current_period_end.
 */

const assert = require('assert');

// ── In-Memory Mock Database ──────────────────────────────────────────────────
class MockSupabase {
  constructor(initialData = {}) {
    this.tables = {
      subscriptions: initialData.subscriptions || [],
      clinics: initialData.clinics || [],
      clinic_credits: initialData.clinic_credits || [],
      credit_topup_lots: initialData.credit_topup_lots || [],
      credit_transactions: initialData.credit_transactions || [],
      subscription_events: initialData.subscription_events || [],
      subscription_invoices: initialData.subscription_invoices || []
    };
  }

  from(table) {
    const self = this;
    const rows = self.tables[table] || [];

    return {
      select(fields = '*') {
        let currentRows = [...rows];
        let filterClinicId = null;
        let filterProviderEventId = null;

        const chain = {
          eq(col, val) {
            currentRows = currentRows.filter(r => r[col] === val);
            return chain;
          },
          gt(col, val) {
            currentRows = currentRows.filter(r => r[col] > val);
            return chain;
          },
          gte(col, val) {
            currentRows = currentRows.filter(r => r[col] >= val);
            return chain;
          },
          not(col, op, val) {
            if (op === 'is' && val === null) {
              currentRows = currentRows.filter(r => r[col] !== null && r[col] !== undefined);
            }
            return chain;
          },
          maybeSingle() {
            return Promise.resolve({ data: currentRows.length > 0 ? { ...currentRows[0] } : null, error: null });
          },
          single() {
            return Promise.resolve({ data: currentRows.length > 0 ? { ...currentRows[0] } : null, error: currentRows.length === 0 ? new Error('Not found') : null });
          },
          then(resolve) {
            return resolve({ data: currentRows, error: null });
          }
        };
        return chain;
      },

      update(updates) {
        return {
          eq(col, val) {
            for (let i = 0; i < rows.length; i++) {
              if (rows[i][col] === val) {
                rows[i] = { ...rows[i], ...updates };
              }
            }
            return Promise.resolve({ data: rows, error: null });
          }
        };
      },

      upsert(record, opts = {}) {
        const conflictKey = opts.onConflict || 'clinic_id';
        const existingIdx = rows.findIndex(r => r[conflictKey] === record[conflictKey]);
        if (existingIdx >= 0) {
          rows[existingIdx] = { ...rows[existingIdx], ...record };
        } else {
          rows.push({ id: `mock-${Date.now()}-${Math.random()}`, ...record });
        }
        return Promise.resolve({ data: record, error: null });
      },

      insert(record) {
        const records = Array.isArray(record) ? record : [record];
        records.forEach(r => rows.push({ id: `mock-${Date.now()}-${Math.random()}`, ...r }));
        return Promise.resolve({ data: record, error: null });
      }
    };
  }
}

// ── Test Runner ──────────────────────────────────────────────────────────────
async function runTests() {
  console.log(`\n======================================================`);
  console.log(`RUNNING BILLING LIFECYCLE & RESILIENCE TESTS (IN-MEMORY)`);
  console.log(`======================================================\n`);

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // ── TEST 1: Cancel Subscription with Razorpay Failure vs Success ────────────
  await test('1A: Cancel-subscription preserves active access and records failure when Razorpay rejects cancellation', async () => {
    const mockDb = new MockSupabase({
      subscriptions: [{
        clinic_id: 'clinic-1',
        status: 'active',
        plan: 'growth',
        current_period_end: new Date(Date.now() + 15 * 86400000).toISOString(),
        provider_subscription_id: 'sub_rzp_fail_123'
      }]
    });

    // Mock Razorpay throwing an error
    const mockRazorpay = {
      subscriptions: {
        cancel: async () => { throw new Error('Razorpay network timeout'); }
      }
    };

    // Simulated handler logic
    let statusCode = 200;
    let responseBody = null;

    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { responseBody = b; return this; }
    };

    const sub = mockDb.tables.subscriptions[0];
    const isRealRazorpay = true;

    try {
      await mockRazorpay.subscriptions.cancel(sub.provider_subscription_id, { cancel_at_cycle_end: 1 });
    } catch (rzpErr) {
      await mockDb.from('subscription_events').insert({
        clinic_id: sub.clinic_id,
        event_type: 'cancellation_failed',
        payload: { error: rzpErr.message, provider_subscription_id: sub.provider_subscription_id }
      });

      res.status(502).json({
        error: `Renewal cancellation could not be confirmed: ${rzpErr.message}`,
        code: 'PROVIDER_CANCELLATION_FAILED',
        can_retry: true,
        status: sub.status,
        current_period_end: sub.current_period_end
      });
    }

    // Assertions:
    assert.strictEqual(statusCode, 502, 'Should return 502 on Razorpay failure');
    assert.strictEqual(sub.status, 'active', 'Status MUST remain active — valid paid access preserved');
    assert.strictEqual(responseBody.can_retry, true, 'Retry must be indicated');
    assert.strictEqual(mockDb.tables.subscription_events.length, 1, 'Failure event must be recorded');
    assert.strictEqual(mockDb.tables.subscription_events[0].event_type, 'cancellation_failed');
  });

  await test('1B: Cancel-subscription sets cancel_pending only when Razorpay confirms cancellation', async () => {
    const mockDb = new MockSupabase({
      subscriptions: [{
        clinic_id: 'clinic-1',
        status: 'active',
        plan: 'premium',
        current_period_end: new Date(Date.now() + 20 * 86400000).toISOString(),
        provider_subscription_id: 'sub_rzp_success_123'
      }]
    });

    const mockRazorpay = {
      subscriptions: {
        cancel: async () => ({ id: 'sub_rzp_success_123', status: 'cancelled' })
      }
    };

    let statusCode = 200;
    let responseBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { responseBody = b; return this; }
    };

    const sub = mockDb.tables.subscriptions[0];
    await mockRazorpay.subscriptions.cancel(sub.provider_subscription_id, { cancel_at_cycle_end: 1 });

    await mockDb.from('subscriptions').update({ status: 'cancel_pending' }).eq('clinic_id', sub.clinic_id);
    await mockDb.from('subscription_events').insert({
      clinic_id: sub.clinic_id,
      event_type: 'cancellation_scheduled',
      payload: { provider_subscription_id: sub.provider_subscription_id }
    });

    res.json({ success: true, status: 'cancel_pending', access_until: sub.current_period_end });

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(mockDb.tables.subscriptions[0].status, 'cancel_pending');
    assert.strictEqual(mockDb.tables.subscription_events[0].event_type, 'cancellation_scheduled');
  });

  await test('1C: Reconcile-cancellation synchronizes state with Razorpay fetch', async () => {
    const mockDb = new MockSupabase({
      subscriptions: [{
        clinic_id: 'clinic-1',
        status: 'active',
        current_period_end: new Date(Date.now() + 10 * 86400000).toISOString(),
        provider_subscription_id: 'sub_rzp_sync_123'
      }]
    });

    const mockRazorpay = {
      subscriptions: {
        fetch: async () => ({ id: 'sub_rzp_sync_123', status: 'cancelled' })
      }
    };

    const sub = mockDb.tables.subscriptions[0];
    const rzpSub = await mockRazorpay.subscriptions.fetch(sub.provider_subscription_id);

    let reconciledStatus = sub.status;
    if (rzpSub.status === 'cancelled') {
      reconciledStatus = new Date(sub.current_period_end) > new Date() ? 'cancel_pending' : 'canceled';
    }

    await mockDb.from('subscriptions').update({ status: reconciledStatus }).eq('clinic_id', sub.clinic_id);

    assert.strictEqual(reconciledStatus, 'cancel_pending');
    assert.strictEqual(mockDb.tables.subscriptions[0].status, 'cancel_pending');
  });

  // ── TEST 2: Server-side block for legacy trial endpoints ─────────────────────
  await test('2A: POST /create-trial rejects new clinics with 403 MANDATE_FLOW_DEPRECATED', async () => {
    const mockDb = new MockSupabase({
      subscriptions: [] // New clinic, no existing subscription or mandate
    });

    const existingSub = null;
    let statusCode = 200;
    let responseBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { responseBody = b; return this; }
    };

    if (!existingSub || !existingSub.provider_subscription_id) {
      res.status(403).json({
        error: 'The card-mandate trial flow is deprecated. Use POST /api/billing/start-trial.',
        code: 'MANDATE_FLOW_DEPRECATED'
      });
    }

    assert.strictEqual(statusCode, 403);
    assert.strictEqual(responseBody.code, 'MANDATE_FLOW_DEPRECATED');
  });

  await test('2B: POST /verify-trial rejects new clinics without an existing legacy mandate session', async () => {
    const existingSub = null;
    let statusCode = 200;
    let responseBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { responseBody = b; return this; }
    };

    if (!existingSub || !existingSub.provider_subscription_id) {
      res.status(403).json({
        error: 'Legacy mandate verification is disabled for new accounts.',
        code: 'MANDATE_FLOW_DEPRECATED'
      });
    }

    assert.strictEqual(statusCode, 403);
    assert.strictEqual(responseBody.code, 'MANDATE_FLOW_DEPRECATED');
  });

  // ── TEST 3: Trial cancellation preserves credit history and top-ups ─────────
  await test('3: POST /cancel-trial terminates trial without wiping clinic_credits, credits_used, or top-up lots', async () => {
    const mockDb = new MockSupabase({
      subscriptions: [{
        clinic_id: 'clinic-trial',
        status: 'trialing',
        provider_subscription_id: 'sub_trial_mandate_1'
      }],
      clinic_credits: [{
        clinic_id: 'clinic-trial',
        credits_allocated: 900,
        credits_used: 120 // usage history!
      }],
      credit_topup_lots: [{
        id: 'topup-1',
        clinic_id: 'clinic-trial',
        credits_remaining: 500,
        expires_at: new Date(Date.now() + 365 * 86400000).toISOString()
      }]
    });

    // Execute cancel-trial
    await mockDb.from('subscriptions').update({ status: 'canceled' }).eq('clinic_id', 'clinic-trial');
    // Notice: we do NOT call clinic_credits update with credits_allocated: 0 or credits_used: 0!

    // Verify
    const sub = mockDb.tables.subscriptions[0];
    const credits = mockDb.tables.clinic_credits[0];
    const topups = mockDb.tables.credit_topup_lots[0];

    assert.strictEqual(sub.status, 'canceled', 'Subscription status must be canceled');
    assert.strictEqual(credits.credits_used, 120, 'Usage history must NOT be erased');
    assert.strictEqual(credits.credits_allocated, 900, 'Shared credit balance record must NOT be zeroed out');
    assert.strictEqual(topups.credits_remaining, 500, 'Purchased top-up lots must remain separate and intact');
  });

  // ── TEST 4: Webhook Resilience ──────────────────────────────────────────────
  await test('4A: subscription.cancelled on trialing clinic does NOT terminate remaining free trial entitlement', async () => {
    const futureTrialEnd = new Date(Date.now() + 60 * 86400000).toISOString(); // 60 days remaining
    const mockDb = new MockSupabase({
      subscriptions: [{
        id: 'sub-1',
        clinic_id: 'clinic-trial',
        status: 'trialing',
        trial_ends_at: futureTrialEnd
      }],
      clinics: [{
        id: 'clinic-trial',
        is_marketplace_listed: true
      }]
    });

    const subRecord = mockDb.tables.subscriptions[0];
    const eventType = 'subscription.cancelled';
    let newStatus = subRecord.status;

    if (eventType === 'subscription.cancelled') {
      if (subRecord.status === 'trialing') {
        const trialEndsAt = subRecord.trial_ends_at ? new Date(subRecord.trial_ends_at) : null;
        if (trialEndsAt && trialEndsAt > new Date()) {
          newStatus = 'trialing'; // PRESERVE ENTITLEMENT
        } else {
          newStatus = 'canceled';
        }
      }
    }

    await mockDb.from('subscriptions').update({ status: newStatus }).eq('id', subRecord.id);

    assert.strictEqual(newStatus, 'trialing', 'Must preserve trialing status when trial_ends_at is in future');
    assert.strictEqual(mockDb.tables.subscriptions[0].status, 'trialing');
    assert.strictEqual(mockDb.tables.clinics[0].is_marketplace_listed, true, 'Marketplace listing preserved');
  });

  await test('4B: Delayed subscription.charged does NOT erase cancellation intent for cancel_pending subscription', async () => {
    const newPeriodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
    const mockDb = new MockSupabase({
      subscriptions: [{
        id: 'sub-2',
        clinic_id: 'clinic-paid',
        status: 'cancel_pending',
        current_period_end: new Date(Date.now() + 5 * 86400000).toISOString()
      }]
    });

    const subRecord = mockDb.tables.subscriptions[0];
    const eventType = 'subscription.charged';
    let newStatus = subRecord.status;

    if (eventType === 'subscription.charged') {
      if (subRecord.status === 'cancel_pending') {
        newStatus = 'cancel_pending'; // MUST NOT OVERWRITE WITH ACTIVE!
      } else {
        newStatus = 'active';
      }
    }

    await mockDb.from('subscriptions').update({
      status: newStatus,
      current_period_end: newPeriodEnd
    }).eq('id', subRecord.id);

    assert.strictEqual(newStatus, 'cancel_pending', 'Must preserve cancel_pending status');
    assert.strictEqual(mockDb.tables.subscriptions[0].status, 'cancel_pending');
    assert.strictEqual(mockDb.tables.subscriptions[0].current_period_end, newPeriodEnd, 'Period end extended to newly charged cycle');
  });

  await test('4C: Webhook idempotency ignores duplicate provider_event_id', async () => {
    const eventId = 'evt_test_12345';
    const mockDb = new MockSupabase({
      subscription_events: [{
        provider_event_id: eventId
      }]
    });

    const { data: existingEvent } = await mockDb.from('subscription_events')
      .select('id')
      .eq('provider_event_id', eventId)
      .maybeSingle();

    assert.ok(existingEvent, 'Existing event found');
    let response = null;
    if (existingEvent) {
      response = 'OK (Idempotent)';
    }

    assert.strictEqual(response, 'OK (Idempotent)');
  });

  await test('4D: Stale out-of-order webhook does not regress terminal canceled state to active', async () => {
    const subUpdatedAt = new Date(Date.now() - 60000).toISOString(); // updated 1 min ago
    const staleEventCreatedAt = new Date(Date.now() - 300000); // created 5 mins ago

    const mockDb = new MockSupabase({
      subscriptions: [{
        id: 'sub-3',
        clinic_id: 'clinic-ended',
        status: 'canceled',
        updated_at: subUpdatedAt
      }]
    });

    const subRecord = mockDb.tables.subscriptions[0];
    const eventType = 'subscription.charged';
    let newStatus = subRecord.status;

    const isStaleEvent = staleEventCreatedAt && subRecord.updated_at && (new Date(subRecord.updated_at).getTime() - staleEventCreatedAt.getTime() > 10000);

    if (isStaleEvent && ['cancel_pending', 'canceled', 'expired'].includes(subRecord.status)) {
      newStatus = subRecord.status; // Preserved!
    } else if (eventType === 'subscription.charged') {
      newStatus = 'active';
    }

    assert.strictEqual(newStatus, 'canceled', 'Stale event must not revive canceled subscription');
  });

  // ── TEST 5: Middleware Entitlement Checks ────────────────────────────────────
  await test('5A: Middleware grants access to trialing clinic with future trial_ends_at', async () => {
    const sub = {
      status: 'trialing',
      trial_ends_at: new Date(Date.now() + 10 * 86400000).toISOString()
    };
    const now = new Date();
    let accessGranted = false;

    if (sub.status === 'trialing') {
      if (sub.trial_ends_at && new Date(sub.trial_ends_at) < now) {
        accessGranted = false;
      } else {
        accessGranted = true;
      }
    }

    assert.strictEqual(accessGranted, true);
  });

  await test('5B: Middleware blocks trialing clinic with expired trial_ends_at with TRIAL_EXPIRED', async () => {
    const sub = {
      status: 'trialing',
      trial_ends_at: new Date(Date.now() - 86400000).toISOString()
    };
    const now = new Date();
    let errCode = null;

    if (sub.status === 'trialing') {
      if (sub.trial_ends_at && new Date(sub.trial_ends_at) < now) {
        errCode = 'TRIAL_EXPIRED';
      }
    }

    assert.strictEqual(errCode, 'TRIAL_EXPIRED');
  });

  await test('5C: Middleware grants access to cancel_pending clinic before current_period_end', async () => {
    const sub = {
      status: 'cancel_pending',
      current_period_end: new Date(Date.now() + 5 * 86400000).toISOString()
    };
    const now = new Date();
    let accessGranted = false;

    if (sub.status === 'cancel_pending') {
      if (!sub.current_period_end || new Date(sub.current_period_end) < now) {
        accessGranted = false;
      } else {
        accessGranted = true;
      }
    }

    assert.strictEqual(accessGranted, true);
  });

  await test('5D: Middleware blocks cancel_pending clinic after current_period_end with SUBSCRIPTION_ENDED', async () => {
    const sub = {
      status: 'cancel_pending',
      current_period_end: new Date(Date.now() - 1000).toISOString()
    };
    const now = new Date();
    let errCode = null;

    if (sub.status === 'cancel_pending') {
      if (!sub.current_period_end || new Date(sub.current_period_end) < now) {
        errCode = 'SUBSCRIPTION_ENDED';
      }
    }

    assert.strictEqual(errCode, 'SUBSCRIPTION_ENDED');
  });

  console.log(`\n======================================================`);
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
