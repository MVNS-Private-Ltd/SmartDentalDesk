-- 1. Add token columns to credit_transactions
ALTER TABLE credit_transactions
ADD COLUMN IF NOT EXISTS input_tokens INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS output_tokens INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_tokens INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS model TEXT;

-- 2. Create atomic function for post-call token deduction
CREATE OR REPLACE FUNCTION deduct_ai_usage(
    p_clinic_id UUID,
    p_cost INT,
    p_ai_mode TEXT,
    p_input_tokens INT,
    p_output_tokens INT,
    p_total_tokens INT,
    p_model TEXT,
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
    -- Lock the clinic_credits row
    SELECT (credits_allocated - credits_used) INTO v_monthly_remaining
    FROM clinic_credits
    WHERE clinic_id = p_clinic_id
    FOR UPDATE;

    IF NOT FOUND THEN
        success := FALSE; remaining_balance := 0; RETURN;
    END IF;

    -- Deduct from monthly allocation first
    IF v_monthly_remaining >= v_cost_left THEN
        UPDATE clinic_credits SET credits_used = credits_used + v_cost_left WHERE clinic_id = p_clinic_id;
        v_cost_left := 0;
    ELSIF v_monthly_remaining > 0 THEN
        UPDATE clinic_credits SET credits_used = credits_used + v_monthly_remaining WHERE clinic_id = p_clinic_id;
        v_cost_left := v_cost_left - v_monthly_remaining;
    END IF;

    -- Deduct remaining cost from top-ups (FIFO)
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
    
    -- If there's still cost left (meaning they went negative), we force it onto the monthly pool to track the overage
    IF v_cost_left > 0 THEN
        UPDATE clinic_credits SET credits_used = credits_used + v_cost_left WHERE clinic_id = p_clinic_id;
    END IF;

    -- Calculate available top-up credits (post deduction)
    SELECT COALESCE(SUM(credits_remaining), 0) INTO v_topup_remaining
    FROM credit_topup_lots
    WHERE clinic_id = p_clinic_id AND expires_at > now() AND credits_remaining > 0;
    
    -- Re-fetch monthly remaining
    SELECT (credits_allocated - credits_used) INTO v_monthly_remaining
    FROM clinic_credits
    WHERE clinic_id = p_clinic_id;

    -- Log usage transaction with token details
    INSERT INTO credit_transactions (clinic_id, type, amount, ai_mode, input_tokens, output_tokens, total_tokens, model) 
    VALUES (p_clinic_id, 'usage', -p_cost, p_ai_mode, p_input_tokens, p_output_tokens, p_total_tokens, p_model)
    RETURNING id INTO out_txn_id;

    success := TRUE;
    remaining_balance := (GREATEST(0, v_monthly_remaining) + v_topup_remaining);
END;
$$;
