-- ─────────────────────────────────────────────────────────────────────────────
-- schema_v17_audit.sql
-- Creates audit_logs table for HIPAA/DPDP compliance
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    action TEXT NOT NULL, -- e.g., 'VIEW_PATIENT', 'CREATE_PATIENT', 'DELETE_PATIENT', 'EXPORT_PATIENT_DATA'
    entity TEXT NOT NULL, -- e.g., 'patient', 'appointment'
    entity_id UUID, -- Optional, if the action relates to a specific record
    ip_address TEXT,
    metadata JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_clinic_id ON public.audit_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON public.audit_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);

-- Audit logs should be strictly insert-only and read-only for admins.
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit logs for their clinic"
ON public.audit_logs FOR SELECT
TO authenticated
USING (clinic_id IN (SELECT get_user_clinics(auth.uid())));

-- The backend middleware will use the service_role key to insert logs, bypassing RLS.
-- This prevents compromised JWTs from spoofing audit logs.
