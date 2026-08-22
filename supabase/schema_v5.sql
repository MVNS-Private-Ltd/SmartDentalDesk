-- ─────────────────────────────────────────────────────────────────────────────
--  Smart Dental Desk — Schema v5 Migration
--  Run this in the Supabase SQL Editor AFTER schema_v4.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Update appointment status check constraint to support 'pending' and 'confirmed'
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE appointments ADD CONSTRAINT appointments_status_check 
  CHECK (status IN ('pending', 'scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show'));
