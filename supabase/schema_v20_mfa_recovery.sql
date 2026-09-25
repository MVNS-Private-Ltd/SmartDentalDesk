-- ─────────────────────────────────────────────────────────────────────────────
-- schema_v20_mfa_recovery.sql
-- Creates mfa_recovery_codes table for secure single-use backup codes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mfa_recovery_codes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    used_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user_id ON public.mfa_recovery_codes(auth_user_id);

-- Deny-by-default RLS: Authenticated users have NO access.
-- All queries will be executed by the backend using the service_role key.
ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;

-- No policies are created for 'authenticated' role, so it defaults to DENY for all operations.
