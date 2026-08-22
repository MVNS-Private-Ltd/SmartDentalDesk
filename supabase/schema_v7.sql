-- schema_v7.sql
-- Make phone optional in patients table (to support CSV imports without phone numbers)
-- Also replace the clinic_id+phone unique constraint with a partial unique index
-- that only applies when phone is NOT NULL.

-- 1. Drop the old unique constraint
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_clinic_id_phone_key;

-- 2. Drop NOT NULL on phone
ALTER TABLE patients ALTER COLUMN phone DROP NOT NULL;

-- 3. Create a partial unique index: unique(clinic_id, phone) only when phone IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS patients_clinic_id_phone_unique
  ON patients (clinic_id, phone)
  WHERE phone IS NOT NULL;
