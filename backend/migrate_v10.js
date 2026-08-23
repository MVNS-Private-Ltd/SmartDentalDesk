/**
 * migrate_v10.js
 * Migration to add auth_id to the staff table for receptionist login support.
 */
const { Client } = require('pg');
require('dotenv').config();
const uri = process.env.DATABASE_URL;
const client = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });

async function run(label, sql) {
  try {
    await client.query(sql);
    console.log(`✅ ${label}`);
  } catch (err) {
    if (err.message.includes('already exists') || err.message.includes('multiple primary keys')) {
      console.log(`⏭  ${label} (already exists or ignored)`);
    } else {
      console.error(`❌ ${label}: ${err.message}`);
      throw err;
    }
  }
}

async function main() {
  await client.connect();
  console.log('Connected.\n');

  // Add auth_id column
  await run('Add auth_id column to staff', `ALTER TABLE staff ADD COLUMN IF NOT EXISTS auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;`);
  
  // Add unique index so a user account can only be tied to one staff record
  await run('Add unique index on staff(auth_id)', `CREATE UNIQUE INDEX IF NOT EXISTS staff_auth_id_unique ON staff(auth_id) WHERE auth_id IS NOT NULL;`);

  console.log('\n🎉 schema_v10 migration completed.');
  await client.end();
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
