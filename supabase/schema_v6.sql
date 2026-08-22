-- ─────────────────────────────────────────────────────────────────────────────
-- Smart Dental Desk — Migration Schema V6
-- Adding is_starred column to patients table
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT false;
