const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const uri = process.env.DATABASE_URL;
const client = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log('Connected to DB.');
  
  const sqlPath = path.join(__dirname, '../supabase/schema_v19_crm.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  
  try {
    await client.query(sql);
    console.log('✅ schema_v19_crm migration completed successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
