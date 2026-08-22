/**
 * migrate_v9.js
 * Simplifies patient uniqueness to ONLY phone and email.
 * Drops the name+dob and name-only unique indexes added in v8.
 */
const { Client } = require('pg');
const uri = 'postgresql://postgres:REDACTED_PASSWORD@db.qxioydfqnuuphgisbqxx.supabase.co:5432/postgres';
const client = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });

async function run(label, sql) {
  try {
    await client.query(sql);
    console.log(`✅ ${label}`);
  } catch (err) {
    if (err.message.includes('does not exist')) {
      console.log(`⏭  ${label} (did not exist)`);
    } else {
      console.error(`❌ ${label}: ${err.message}`);
      throw err;
    }
  }
}

async function main() {
  await client.connect();
  console.log('Connected.\n');

  // Drop name-based unique indexes (DOB should not be a uniqueness key)
  await run('Drop patients_name_dob_unique',  `DROP INDEX IF EXISTS patients_name_dob_unique`);
  await run('Drop patients_name_only_unique', `DROP INDEX IF EXISTS patients_name_only_unique`);

  // Confirm what remains
  const { rows } = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'patients' ORDER BY indexname
  `);
  console.log('\nActive indexes on patients:');
  rows.forEach(r => console.log(`  [${r.indexname}]`));

  console.log('\n🎉 Done. Uniqueness now enforced only on phone and email.');
  await client.end();
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
