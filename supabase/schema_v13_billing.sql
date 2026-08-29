-- ─────────────────────────────────────────────────────────────────────────────
--  Smart Dental Desk — Schema v13: Billing & Subscriptions
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Subscriptions
CREATE TABLE subscriptions (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id                UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL UNIQUE,
  plan                     TEXT NOT NULL 
                             CHECK (plan IN ('starter','growth','premium','enterprise')),
  status                   TEXT NOT NULL 
                             CHECK (status IN ('trialing','active','past_due','canceled','expired')),
  billing_cycle            TEXT NOT NULL DEFAULT 'monthly',
  trial_start_at           TIMESTAMPTZ,
  trial_ends_at            TIMESTAMPTZ,
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  provider_customer_id     TEXT,          
  provider_subscription_id TEXT UNIQUE,   
  provider_plan_id         TEXT,          
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

-- 2. Clinic Monthly Credits
CREATE TABLE clinic_credits (
  clinic_id             UUID REFERENCES clinics(id) ON DELETE CASCADE PRIMARY KEY,
  credits_allocated     INTEGER NOT NULL DEFAULT 0,  
  credits_used          INTEGER NOT NULL DEFAULT 0,  
  period_start          TIMESTAMPTZ,    
  period_end            TIMESTAMPTZ,    
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- 3. Top-up Lots (For FIFO consumption with 12-month expiry)
CREATE TABLE credit_topup_lots (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id             UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  credits_original      INTEGER NOT NULL,
  credits_remaining     INTEGER NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- 4. Credit Transactions (Immutable Ledger)
CREATE TABLE credit_transactions (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id      UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  type           TEXT NOT NULL
                   CHECK (type IN ('allocation', 'usage', 'topup', 'refund', 'expiry', 'adjustment')),
  amount         INTEGER NOT NULL,  
  ai_mode        TEXT,              
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- 5. Top-up Orders
CREATE TABLE topup_orders (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id              UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  pack_id                TEXT NOT NULL,   
  credits_purchased      INTEGER NOT NULL,
  amount_paise           INTEGER NOT NULL, 
  provider_order_id      TEXT UNIQUE,     
  provider_payment_id    TEXT,            
  status                 TEXT DEFAULT 'created',
  created_at             TIMESTAMPTZ DEFAULT now()
);

-- 6. Subscription Events (Audit log & Idempotency)
CREATE TABLE subscription_events (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id       UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  event_type      TEXT NOT NULL,    
  provider_event_id TEXT UNIQUE,    -- Crucial for Webhook idempotency
  payload         JSONB,            
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 7. Additions to existing tables
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS is_marketplace_listed BOOLEAN DEFAULT false;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS credits_cost INTEGER DEFAULT 0;
ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS credit_txn_id UUID REFERENCES credit_transactions(id) ON DELETE SET NULL;
