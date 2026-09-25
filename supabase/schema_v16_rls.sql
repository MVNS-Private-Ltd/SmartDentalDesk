-- ─────────────────────────────────────────────────────────────────────────────
-- schema_v16_rls.sql
-- Enables Row Level Security on core tenant tables and creates policies
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enable RLS
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_files ENABLE ROW LEVEL SECURITY;

-- 2. Create policies for users authenticated via backend (which will pass JWT with clinic_id claim or auth.uid())
-- Since our backend uses custom JWTs for the user session, we can extract claims using `auth.jwt()`.
-- In Supabase, if we pass a custom JWT (with the standard anon key) that has our claims,
-- `auth.jwt()->>'clinic_id'` can be used to match the row's `clinic_id`.
-- Wait, we need to ensure that the backend signs JWTs with Supabase's JWT secret, or we use Supabase Auth natively.
-- Since they use Supabase Auth for login (`signInWithPassword`), the JWT is a standard Supabase JWT.
-- However, we store `clinic_id` in our own tables (`clinics`, `staff`), not necessarily in the Supabase JWT.
-- Wait, the user specifically mentioned:
-- "RLS policies use auth.uid() and/or a claim that maps to clinic_id."
-- Let's create a policy that checks if the auth.uid() is the owner of the clinic, OR if auth.uid() is active staff for that clinic.

CREATE OR REPLACE FUNCTION get_user_clinics(uid UUID) RETURNS SETOF UUID AS $$
BEGIN
    RETURN QUERY 
    -- Clinics they own
    SELECT id FROM public.clinics WHERE owner_id = uid
    UNION
    -- Clinics they are staff for
    SELECT clinic_id FROM public.staff WHERE auth_id = uid AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Patients
CREATE POLICY "Tenant isolation for patients"
ON public.patients FOR ALL
TO authenticated
USING (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));

-- Appointments
CREATE POLICY "Tenant isolation for appointments"
ON public.appointments FOR ALL
TO authenticated
USING (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));

-- Treatments
CREATE POLICY "Tenant isolation for treatments"
ON public.treatment_records FOR ALL
TO authenticated
USING (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));

-- Invoices
CREATE POLICY "Tenant isolation for invoices"
ON public.invoices FOR ALL
TO authenticated
USING (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));

-- Patient Files
CREATE POLICY "Tenant isolation for patient_files"
ON public.patient_files FOR ALL
TO authenticated
USING (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));
