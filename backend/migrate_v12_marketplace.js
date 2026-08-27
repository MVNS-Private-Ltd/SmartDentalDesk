/**
 * migrate_v12_marketplace.js
 * Applies schema_v12_marketplace.sql to PostgreSQL via pg client.
 */
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const uri = process.env.DATABASE_URL;
if (!uri) {
  console.error('❌ DATABASE_URL is not set in .env');
  process.exit(1);
}

const client = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });

async function run() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL for v12 migration...');

    const sqlPath = path.join(__dirname, '../supabase/schema_v12_marketplace.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query(sql);
    console.log('✅ Schema v12 marketplace migration executed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
