/**
 * migrate_v22_fix_rls_recursion.js
 * Fixes: "infinite recursion detected in policy for relation 'staff'"
 * Run: node migrate_v22_fix_rls_recursion.js
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const uri = process.env.DATABASE_URL;
if (!uri) {
  console.error('❌ DATABASE_URL is not set in .env');
  process.exit(1);
}

const client = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log('✅ Connected to Supabase Postgres.\n');

  const sqlPath = path.join(__dirname, '../supabase/schema_v22_fix_rls_recursion.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  try {
    await client.query(sql);
    console.log('✅ schema_v22 migration completed — RLS recursion fixed.\n');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
