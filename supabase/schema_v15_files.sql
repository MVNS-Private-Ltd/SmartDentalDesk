-- ─────────────────────────────────────────────────────────────────────────────
-- schema_v15_files.sql
-- Creates patient_files table and configures the private storage bucket
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.patient_files (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_type TEXT,
    file_size_bytes BIGINT,
    uploaded_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_files_clinic_id ON public.patient_files(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patient_files_patient_id ON public.patient_files(patient_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage Bucket Configuration (patient_files)
-- ─────────────────────────────────────────────────────────────────────────────
-- Insert bucket if not exists (Requires superuser/service role, usually handled by API but can be done in SQL)
INSERT INTO storage.buckets (id, name, public)
VALUES ('patient_files', 'patient_files', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Disable public access completely via Storage RLS (Belt and suspenders)
-- The backend uses the service role key to insert/read, so it bypasses these policies,
-- but this ensures no anon/authenticated client can fetch without the backend.
CREATE POLICY "Deny all public access to patient_files" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'patient_files' AND false);
