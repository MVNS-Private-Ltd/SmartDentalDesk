/**
 * migrate_v8.js — Bulletproof patient deduplication at the DB level
 *
 * Adds three complementary unique indexes so the DB itself enforces
 * no-duplicate patients, regardless of how data enters (app, API, direct SQL):
 *
 *  1. (clinic_id, phone) WHERE phone IS NOT NULL              ← ALREADY EXISTS ✅
 *  2. (clinic_id, lower(name), dob) WHERE phone IS NULL
 *     AND dob IS NOT NULL                                     ← NEW: same name + same DOB, no phone
 *  3. (clinic_id, lower(name)) WHERE phone IS NULL
 *     AND dob IS NULL AND is_deleted = false                  ← NEW: same name, nothing else
 *  4. (clinic_id, email) WHERE email IS NOT NULL
 *     AND is_deleted = false                                  ← NEW: unique email per clinic
 *
 * Also adds useful lookup/performance indexes:
 *  5. (clinic_id, is_deleted, created_at DESC)               ← fast list queries
 *  6. (clinic_id, is_starred) WHERE is_starred = true        ← fast VIP filter
 */
const { Client } = require('pg');
const uri = 'postgresql://postgres:REDACTED_PASSWORD@db.qxioydfqnuuphgisbqxx.supabase.co:5432/postgres';
const client = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });

async function run(label, sql) {
  try {
    await client.query(sql);
    console.log(`✅ ${label}`);
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log(`⏭  ${label} (already exists)`);
    } else {
      console.error(`❌ ${label}: ${err.message}`);
      throw err;
    }
  }
}

async function main() {
  await client.connect();
  console.log('Connected.\n');

  // ── Unique: same name + same DOB, no phone (active records only) ─────────
  await run(
    'Unique index: (clinic_id, lower(name), dob) WHERE phone IS NULL AND dob IS NOT NULL AND NOT is_deleted',
    `CREATE UNIQUE INDEX patients_name_dob_unique
       ON patients (clinic_id, LOWER(TRIM(name)), dob)
       WHERE phone IS NULL AND dob IS NOT NULL AND is_deleted = false`
  );

  // ── Unique: same name only, no phone, no DOB (active records only) ───────
  await run(
    'Unique index: (clinic_id, lower(name)) WHERE phone IS NULL AND dob IS NULL AND NOT is_deleted',
    `CREATE UNIQUE INDEX patients_name_only_unique
       ON patients (clinic_id, LOWER(TRIM(name)))
       WHERE phone IS NULL AND dob IS NULL AND is_deleted = false`
  );

  // ── Unique: email per clinic (active records only) ────────────────────────
  await run(
    'Unique index: (clinic_id, lower(email)) WHERE email IS NOT NULL AND NOT is_deleted',
    `CREATE UNIQUE INDEX patients_email_unique
       ON patients (clinic_id, LOWER(TRIM(email)))
       WHERE email IS NOT NULL AND is_deleted = false`
  );

  // ── Performance: fast list/pagination queries ─────────────────────────────
  await run(
    'Performance index: (clinic_id, is_deleted, created_at DESC)',
    `CREATE INDEX IF NOT EXISTS patients_list_idx
       ON patients (clinic_id, is_deleted, created_at DESC)`
  );

  // ── Performance: fast starred/VIP filter ─────────────────────────────────
  await run(
    'Performance index: (clinic_id) WHERE is_starred = true',
    `CREATE INDEX IF NOT EXISTS patients_starred_idx
       ON patients (clinic_id)
       WHERE is_starred = true AND is_deleted = false`
  );

  console.log('\n🎉 schema_v8 migration completed. Patient data integrity is now guaranteed at the DB level.');
  await client.end();
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
