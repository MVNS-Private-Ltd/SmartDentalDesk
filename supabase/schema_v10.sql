-- schema_v10.sql
-- Add auth_id to staff table for receptionist login support

ALTER TABLE staff ADD COLUMN IF NOT EXISTS auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS staff_auth_id_unique ON staff(auth_id) WHERE auth_id IS NOT NULL;
