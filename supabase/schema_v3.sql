-- ─────────────────────────────────────────────────────────────────────────────
--  Smart Dental Desk — Schema v3 Migration
--  Run this in the Supabase SQL Editor AFTER schema_v2.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Add mode and model_used tracking to ai_chats
ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'thinking' 
  CHECK (mode IN ('data', 'thinking', 'automation'));

ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS model_used TEXT;

-- Index for faster chat history lookups
CREATE INDEX IF NOT EXISTS ai_chats_clinic_id_idx ON ai_chats (clinic_id, created_at DESC);
