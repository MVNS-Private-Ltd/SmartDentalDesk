-- ─────────────────────────────────────────────────────────────────────────────
-- schema_v23_discovery_jobs.sql
-- DentalSmart: Durable Public Discovery Job Queue & Direct-DB Change Trigger
--
-- PURPOSE:
--   1. Provides durable, auditable job storage for public discovery rebuild triggers.
--      Survives application server restarts and network partitions.
--   2. Catches DIRECT database edits (executed via Supabase SQL Editor or Table Editor)
--      that bypass Express route handlers, solving the direct-edit limitation.
--
-- INSTRUCTIONS FOR OPERATOR:
--   - This migration is prepared but NOT automatically applied.
--   - Run this in the Supabase SQL Editor if durable DB queuing and direct-edit
--     auto-detection are desired.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create discovery_build_jobs table
CREATE TABLE IF NOT EXISTS public.discovery_build_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL,
    trigger_reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    last_error TEXT,
    dispatched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for queue polling and status inspection
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_status_created 
    ON public.discovery_build_jobs(status, created_at);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.discovery_build_jobs ENABLE ROW LEVEL SECURITY;

-- Only service_role (backend/admin) can read or modify the discovery queue
DROP POLICY IF EXISTS "Service role full access to discovery_build_jobs" ON public.discovery_build_jobs;
CREATE POLICY "Service role full access to discovery_build_jobs"
    ON public.discovery_build_jobs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 3. Optional Direct Database Edit Detection Trigger
-- Automatically enqueues a rebuild job when is_marketplace_listed, is_active,
-- or clinic details are altered directly via Supabase SQL or Table Editor.
CREATE OR REPLACE FUNCTION public.fn_capture_clinic_discovery_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if marketplace publication, activation, or core profile fields changed
    IF (OLD.is_marketplace_listed IS DISTINCT FROM NEW.is_marketplace_listed) OR
       (OLD.is_active IS DISTINCT FROM NEW.is_active) OR
       (NEW.is_marketplace_listed = true AND (
           OLD.name IS DISTINCT FROM NEW.name OR
           OLD.booking_slug IS DISTINCT FROM NEW.booking_slug OR
           OLD.about IS DISTINCT FROM NEW.about OR
           OLD.city IS DISTINCT FROM NEW.city OR
           OLD.area IS DISTINCT FROM NEW.area OR
           OLD.services_offered IS DISTINCT FROM NEW.services_offered
       ))
    THEN
        INSERT INTO public.discovery_build_jobs (
            clinic_id,
            trigger_reason,
            status,
            created_at,
            updated_at
        ) VALUES (
            NEW.id,
            CASE 
                WHEN OLD.is_marketplace_listed IS DISTINCT FROM NEW.is_marketplace_listed THEN
                    'DB trigger: clinic "' || NEW.name || '" marketplace_listed changed to ' || NEW.is_marketplace_listed::text
                WHEN OLD.is_active IS DISTINCT FROM NEW.is_active THEN
                    'DB trigger: clinic "' || NEW.name || '" is_active changed to ' || NEW.is_active::text
                ELSE
                    'DB trigger: clinic "' || NEW.name || '" details updated'
            END,
            'pending',
            now(),
            now()
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_clinic_discovery_change ON public.clinics;
CREATE TRIGGER trg_clinic_discovery_change
    AFTER UPDATE OR INSERT ON public.clinics
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_capture_clinic_discovery_change();
