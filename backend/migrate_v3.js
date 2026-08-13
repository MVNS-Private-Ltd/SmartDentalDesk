const { Client } = require('pg');
const path = require('path');

const uri = 'postgresql://postgres:Nabha%40219.clinic@db.qxioydfqnuuphgisbqxx.supabase.co:5432/postgres';

const client = new Client({
  connectionString: uri,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL!');

    // Add mode and model_used columns to ai_chats
    await client.query(`
      ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'thinking'
        CHECK (mode IN ('data', 'thinking', 'automation'));
    `);
    console.log('✅ Added mode column to ai_chats');

    await client.query(`
      ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS model_used TEXT;
    `);
    console.log('✅ Added model_used column to ai_chats');

    await client.query(`
      CREATE INDEX IF NOT EXISTS ai_chats_clinic_id_idx ON ai_chats (clinic_id, created_at DESC);
    `);
    console.log('✅ Created performance index on ai_chats');

    console.log('\n🎉 schema_v3 migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
  } finally {
    await client.end();
  }
}

runMigration();
