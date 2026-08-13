-- ─────────────────────────────────────────────────────────────────────────────
--  Smart Dental Desk — Schema v4 Migration
--  Run this in the Supabase SQL Editor AFTER schema_v3.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Add session_id for grouping messages into conversations
ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS session_id UUID DEFAULT gen_random_uuid();

-- Add session_name so each conversation can have a descriptive title
ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS session_name TEXT;

-- Index for fast session-based lookups
CREATE INDEX IF NOT EXISTS ai_chats_session_id_idx ON ai_chats (session_id);
