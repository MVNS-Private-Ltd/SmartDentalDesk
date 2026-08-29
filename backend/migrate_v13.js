const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Hardcode the URI directly with the URL-encoded password
require('dotenv').config();
const uri = process.env.DATABASE_URL;

const client = new Client({
  connectionString: uri,
  ssl: { rejectUnauthorized: false }
});

async function runSchema() {
  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL!');

    const schemaPath = path.join(__dirname, '../supabase/schema_v13_billing.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing schema_v13_billing.sql...');
    await client.query(schemaSql);
    console.log('Schema executed successfully! All tables created.');
  } catch (err) {
    console.error('Error executing schema:', err.message);
  } finally {
    await client.end();
  }
}

runSchema();
