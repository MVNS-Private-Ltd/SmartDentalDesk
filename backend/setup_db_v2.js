const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Hardcode the URI directly with the URL-encoded password
const uri = 'postgresql://postgres:REDACTED_PASSWORD@db.qxioydfqnuuphgisbqxx.supabase.co:5432/postgres';

const client = new Client({
  connectionString: uri,
  ssl: { rejectUnauthorized: false }
});

async function runSchema() {
  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL!');

    const schemaPath = path.join(__dirname, '../supabase/schema_v2.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing schema_v2.sql...');
    await client.query(schemaSql);
    console.log('Schema executed successfully! V2 tables and columns created.');
  } catch (err) {
    console.error('Error executing schema:', err.message);
  } finally {
    await client.end();
  }
}

runSchema();
