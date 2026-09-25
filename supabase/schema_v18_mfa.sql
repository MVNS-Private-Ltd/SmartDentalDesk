-- ─────────────────────────────────────────────────────────────────────────────
-- schema_v18_mfa.sql
-- Creates user_security table for custom TOTP-based MFA
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_security (
    auth_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    mfa_secret TEXT, -- Encrypted at rest or just standard speakeasy base32 secret
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS: Only the user can view/update their own security settings, or a SuperAdmin
ALTER TABLE public.user_security ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own MFA"
ON public.user_security FOR ALL
TO authenticated
USING (auth_user_id = auth.uid())
WITH CHECK (auth_user_id = auth.uid());

-- Insert a blank record for all existing users (optional, or we upsert on first use)
-- Upsert is safer in backend logic.
