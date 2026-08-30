-- ─────────────────────────────────────────────────────────────────────────────
--  Smart Dental Desk — Schema v14: Atomic Credits & Reservations
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Updates to clinic_credits
ALTER TABLE clinic_credits ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ;

-- 2. New Reservations Table
CREATE TABLE IF NOT EXISTS credit_reservations (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id        UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  txn_id           UUID REFERENCES credit_transactions(id) ON DELETE CASCADE NOT NULL,
  credits_reserved INTEGER NOT NULL,
  ai_chat_id       UUID REFERENCES ai_chats(id) ON DELETE SET NULL,
  status           TEXT DEFAULT 'active' CHECK (status IN ('active', 'released', 'consumed')),
  created_at       TIMESTAMPTZ DEFAULT now(),
  expires_at       TIMESTAMPTZ DEFAULT now() + interval '5 minutes'
);

-- 3. Atomic Deduction Function
CREATE OR REPLACE FUNCTION deduct_ai_credits(
    p_clinic_id UUID,
    p_cost INT,
    p_ai_mode TEXT,
    OUT success BOOLEAN,
    OUT remaining_balance INT,
    OUT out_txn_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_monthly_remaining INT;
    v_topup_remaining INT;
    v_cost_left INT := p_cost;
    v_lot RECORD;
BEGIN
    -- 1. Lock the clinic_credits row
    SELECT (credits_allocated - credits_used) INTO v_monthly_remaining
    FROM clinic_credits
    WHERE clinic_id = p_clinic_id
    FOR UPDATE;

    IF NOT FOUND THEN
        success := FALSE; remaining_balance := 0; RETURN;
    END IF;

    -- 2. Calculate available top-up credits
    SELECT COALESCE(SUM(credits_remaining), 0) INTO v_topup_remaining
    FROM credit_topup_lots
    WHERE clinic_id = p_clinic_id AND expires_at > now() AND credits_remaining > 0;

    -- 3. Check total balance
    IF (GREATEST(0, v_monthly_remaining) + v_topup_remaining) < p_cost THEN
        success := FALSE; 
        remaining_balance := GREATEST(0, v_monthly_remaining) + v_topup_remaining;
        RETURN;
    END IF;

    -- 4. Deduct from monthly allocation first
    IF v_monthly_remaining >= v_cost_left THEN
        UPDATE clinic_credits SET credits_used = credits_used + v_cost_left WHERE clinic_id = p_clinic_id;
        v_cost_left := 0;
    ELSIF v_monthly_remaining > 0 THEN
        UPDATE clinic_credits SET credits_used = credits_used + v_monthly_remaining WHERE clinic_id = p_clinic_id;
        v_cost_left := v_cost_left - v_monthly_remaining;
    END IF;

    -- 5. Deduct remaining cost from top-ups (FIFO)
    IF v_cost_left > 0 THEN
        FOR v_lot IN 
            SELECT id, credits_remaining FROM credit_topup_lots
            WHERE clinic_id = p_clinic_id AND expires_at > now() AND credits_remaining > 0
            ORDER BY expires_at ASC FOR UPDATE
        LOOP
            IF v_lot.credits_remaining >= v_cost_left THEN
                UPDATE credit_topup_lots SET credits_remaining = credits_remaining - v_cost_left WHERE id = v_lot.id;
                v_cost_left := 0; EXIT;
            ELSE
                UPDATE credit_topup_lots SET credits_remaining = 0 WHERE id = v_lot.id;
                v_cost_left := v_cost_left - v_lot.credits_remaining;
            END IF;
        END LOOP;
    END IF;

    -- 6. Log usage transaction
    INSERT INTO credit_transactions (clinic_id, type, amount, ai_mode) 
    VALUES (p_clinic_id, 'usage', -p_cost, p_ai_mode)
    RETURNING id INTO out_txn_id;

    -- 7. Create Reservation
    INSERT INTO credit_reservations (clinic_id, txn_id, credits_reserved)
    VALUES (p_clinic_id, out_txn_id, p_cost);

    success := TRUE;
    remaining_balance := (GREATEST(0, v_monthly_remaining) + v_topup_remaining) - p_cost;
END;
$$;

-- 4. Refund Function (with Overflow to Topup Lots)
CREATE OR REPLACE FUNCTION refund_ai_credits(
    p_clinic_id UUID,
    p_cost INT,
    p_ai_mode TEXT,
    p_original_txn_id UUID
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_current_used INT;
    v_refund_to_monthly INT;
    v_refund_to_topup INT;
BEGIN
    -- 1. Lock and check clinic_credits
    SELECT credits_used INTO v_current_used
    FROM clinic_credits
    WHERE clinic_id = p_clinic_id FOR UPDATE;

    -- 2. Calculate distribution
    IF v_current_used >= p_cost THEN
        v_refund_to_monthly := p_cost;
        v_refund_to_topup := 0;
    ELSE
        v_refund_to_monthly := GREATEST(0, v_current_used);
        v_refund_to_topup := p_cost - v_refund_to_monthly;
    END IF;

    -- 3. Refund to monthly allocation
    IF v_refund_to_monthly > 0 THEN
        UPDATE clinic_credits SET credits_used = credits_used - v_refund_to_monthly WHERE clinic_id = p_clinic_id;
    END IF;

    -- 4. Create new top-up lot for overflow (12-month expiry)
    IF v_refund_to_topup > 0 THEN
        INSERT INTO credit_topup_lots (clinic_id, credits_original, credits_remaining, expires_at)
        VALUES (p_clinic_id, v_refund_to_topup, v_refund_to_topup, now() + interval '12 months');
    END IF;

    -- 5. Log refund transaction
    INSERT INTO credit_transactions (clinic_id, type, amount, ai_mode) 
    VALUES (p_clinic_id, 'refund', p_cost, p_ai_mode);
END;
$$;

-- 5. Release & Consume Reservation Functions
CREATE OR REPLACE FUNCTION release_reservation(
    p_txn_id UUID
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_res RECORD;
    v_txn RECORD;
BEGIN
    SELECT * INTO v_res FROM credit_reservations WHERE txn_id = p_txn_id FOR UPDATE;
    
    IF NOT FOUND OR v_res.status != 'active' THEN RETURN; END IF;

    SELECT * INTO v_txn FROM credit_transactions WHERE id = p_txn_id;

    UPDATE credit_reservations SET status = 'released' WHERE id = v_res.id;
    PERFORM refund_ai_credits(v_res.clinic_id, v_res.credits_reserved, v_txn.ai_mode, p_txn_id);
END;
$$;

CREATE OR REPLACE FUNCTION consume_reservation(
    p_txn_id UUID,
    p_ai_chat_id UUID
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    UPDATE credit_reservations 
    SET status = 'consumed', ai_chat_id = p_ai_chat_id 
    WHERE txn_id = p_txn_id AND status = 'active';
END;
$$;
