require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL.');

    const schemaPath = path.join(__dirname, '../supabase/schema_v20_mfa_recovery.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Running Migration (v20 - MFA Recovery Codes)...');
    await client.query(sql);

    console.log('✅ Migration v20 complete.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

runMigration();
