-- Add to clinics table
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS booking_slug TEXT UNIQUE;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS appointment_settings JSONB DEFAULT '{"slot_duration_minutes": 30, "auto_approve": false}'::jsonb;

-- New AI Chat History Table
CREATE TABLE IF NOT EXISTS ai_chats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('user', 'assistant')),
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
