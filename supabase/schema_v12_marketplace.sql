-- ─────────────────────────────────────────────────────────────────────────────
--  Smart Dental Desk — Schema v12 Marketplace & Clinic Directory Migration
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add marketplace columns to clinics table
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS city TEXT DEFAULT 'Delhi';
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS area TEXT DEFAULT 'Connaught Place';
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS pincode TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS rating NUMERIC(2, 1) DEFAULT 4.8;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS about TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS specialties JSONB DEFAULT '["General Dentistry", "Root Canal", "Cosmetic Dentistry"]'::jsonb;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS services_offered JSONB DEFAULT '[]'::jsonb;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS cover_image TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS timings TEXT DEFAULT 'Mon - Sat: 09:00 AM - 08:00 PM';
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS experience_years INTEGER DEFAULT 8;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS price_range TEXT DEFAULT '₹₹';
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT true;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS amenities JSONB DEFAULT '["Digital X-Ray", "Sterilization Certified", "Wheelchair Accessible", "Wi-Fi"]'::jsonb;

-- 2. Performance indexes for marketplace searching & filtering
CREATE INDEX IF NOT EXISTS clinics_city_idx ON clinics (city);
CREATE INDEX IF NOT EXISTS clinics_area_idx ON clinics (area);
CREATE INDEX IF NOT EXISTS clinics_rating_idx ON clinics (rating DESC);
CREATE INDEX IF NOT EXISTS clinics_is_active_idx ON clinics (is_active);
CREATE INDEX IF NOT EXISTS clinics_is_featured_idx ON clinics (is_featured);
