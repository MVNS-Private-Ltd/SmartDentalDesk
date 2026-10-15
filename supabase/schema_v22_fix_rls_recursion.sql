-- ─────────────────────────────────────────────────────────────────────────────
-- schema_v22_fix_rls_recursion.sql
-- Fixes: "infinite recursion detected in policy for relation 'staff'"
--
-- ROOT CAUSE:
--   The v11 migration created policies that directly cross-reference
--   the 'staff' and 'clinics' tables inside each other's RLS policies:
--
--   patients policy  → queries staff  (via "Staff access to patients")
--   staff policy     → queries clinics (via "Owner can manage staff")
--   clinics policy   → queries staff  (via "Staff can view their clinic")
--                                          ↑ INFINITE RECURSION
--
-- FIX:
--   1. Drop all v11 policies that create the circular reference on
--      clinics, staff, patients, appointments, treatment_records, invoices.
--   2. Keep only the v16 policies which use get_user_clinics() — a
--      SECURITY DEFINER function that runs as 'postgres' (bypasses RLS
--      internally) and safely resolves clinic membership without recursion.
--   3. Add safe, non-recursive policies for the 'clinics' and 'staff'
--      tables themselves using the same SECURITY DEFINER approach.
-- ─────────────────────────────────────────────────────────────────────────────

-- STEP 1: Drop all v11 circular policies

-- clinics table
DROP POLICY IF EXISTS "Owner can manage own clinic"      ON public.clinics;
DROP POLICY IF EXISTS "Staff can view their clinic"      ON public.clinics;

-- staff table
DROP POLICY IF EXISTS "Owner can manage staff"           ON public.staff;
DROP POLICY IF EXISTS "Staff can view own record"        ON public.staff;

-- patients table
DROP POLICY IF EXISTS "Owner full access to patients"    ON public.patients;
DROP POLICY IF EXISTS "Staff access to patients"         ON public.patients;

-- appointments table
DROP POLICY IF EXISTS "Owner full access to appointments" ON public.appointments;
DROP POLICY IF EXISTS "Staff access to appointments"      ON public.appointments;

-- treatment_records table
DROP POLICY IF EXISTS "Owner full access to treatment_records" ON public.treatment_records;
DROP POLICY IF EXISTS "Staff access to treatment_records"      ON public.treatment_records;

-- invoices table
DROP POLICY IF EXISTS "Owner full access to invoices"    ON public.invoices;
DROP POLICY IF EXISTS "Staff access to invoices"         ON public.invoices;

-- STEP 2: Recreate get_user_clinics as SECURITY DEFINER (idempotent)

CREATE OR REPLACE FUNCTION get_user_clinics(uid UUID)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT id FROM public.clinics WHERE owner_id = uid
    UNION
    SELECT clinic_id FROM public.staff WHERE auth_id = uid AND is_active = true;
END;
$$;

-- STEP 3: Add safe policy for clinics table (no circular reference)
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic access via membership" ON public.clinics;
CREATE POLICY "Clinic access via membership"
ON public.clinics FOR ALL
TO authenticated
USING (id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (owner_id = auth.uid());

-- STEP 4: Add safe policy for staff table (no circular reference)
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff access via clinic membership" ON public.staff;
CREATE POLICY "Staff access via clinic membership"
ON public.staff FOR ALL
TO authenticated
USING (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));

-- STEP 5: Recreate all data table policies using get_user_clinics()

DROP POLICY IF EXISTS "Tenant isolation for patients" ON public.patients;
CREATE POLICY "Tenant isolation for patients"
ON public.patients FOR ALL TO authenticated
USING   (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));

DROP POLICY IF EXISTS "Tenant isolation for appointments" ON public.appointments;
CREATE POLICY "Tenant isolation for appointments"
ON public.appointments FOR ALL TO authenticated
USING   (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));

DROP POLICY IF EXISTS "Tenant isolation for treatments" ON public.treatment_records;
CREATE POLICY "Tenant isolation for treatments"
ON public.treatment_records FOR ALL TO authenticated
USING   (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));

DROP POLICY IF EXISTS "Tenant isolation for invoices" ON public.invoices;
CREATE POLICY "Tenant isolation for invoices"
ON public.invoices FOR ALL TO authenticated
USING   (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));

DROP POLICY IF EXISTS "Tenant isolation for patient_files" ON public.patient_files;
CREATE POLICY "Tenant isolation for patient_files"
ON public.patient_files FOR ALL TO authenticated
USING   (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));

DROP POLICY IF EXISTS "Clinic staff can manage their own scheduled messages" ON public.scheduled_messages;
CREATE POLICY "Clinic staff can manage their own scheduled messages"
ON public.scheduled_messages FOR ALL TO authenticated
USING   (clinic_id IN (SELECT get_user_clinics(auth.uid())))
WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));
