-- schema_v8.sql
-- Bulletproof patient deduplication — DB-level uniqueness guarantees
-- Run after schema_v7.sql

-- 1. Unique: same name + same DOB, no phone (active records)
CREATE UNIQUE INDEX IF NOT EXISTS patients_name_dob_unique
  ON patients (clinic_id, LOWER(TRIM(name)), dob)
  WHERE phone IS NULL AND dob IS NOT NULL AND is_deleted = false;

-- 2. Unique: same name only, no phone, no DOB (active records)
CREATE UNIQUE INDEX IF NOT EXISTS patients_name_only_unique
  ON patients (clinic_id, LOWER(TRIM(name)))
  WHERE phone IS NULL AND dob IS NULL AND is_deleted = false;

-- 3. Unique: email per clinic (active records)
CREATE UNIQUE INDEX IF NOT EXISTS patients_email_unique
  ON patients (clinic_id, LOWER(TRIM(email)))
  WHERE email IS NOT NULL AND is_deleted = false;

-- 4. Performance: fast list/pagination
CREATE INDEX IF NOT EXISTS patients_list_idx
  ON patients (clinic_id, is_deleted, created_at DESC);

-- 5. Performance: fast VIP/starred filter
CREATE INDEX IF NOT EXISTS patients_starred_idx
  ON patients (clinic_id)
  WHERE is_starred = true AND is_deleted = false;
