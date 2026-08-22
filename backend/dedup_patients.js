/**
 * dedup_patients.js
 * Finds and soft-deletes duplicate patient records, keeping the oldest record per
 * (clinic_id, name, dob) and (clinic_id, phone) group.
 * Run once: node dedup_patients.js
 */
const { Client } = require('pg');

const uri = 'postgresql://postgres:Nabha%40219.clinic@db.qxioydfqnuuphgisbqxx.supabase.co:5432/postgres';

const client = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log('Connected.\n');

  let totalRemoved = 0;

  // ── 1. Deduplicate by phone (keep oldest) ─────────────────────────────────
  const { rows: phoneDupes } = await client.query(`
    SELECT clinic_id, phone, COUNT(*) as cnt,
           array_agg(id ORDER BY created_at ASC) as ids
    FROM patients
    WHERE phone IS NOT NULL
      AND is_deleted = false
    GROUP BY clinic_id, phone
    HAVING COUNT(*) > 1
  `);

  console.log(`Found ${phoneDupes.length} phone duplicate group(s).`);
  for (const group of phoneDupes) {
    const keepId = group.ids[0];
    const deleteIds = group.ids.slice(1);
    await client.query(
      `UPDATE patients SET is_deleted = true, updated_at = NOW() WHERE id = ANY($1::uuid[])`,
      [deleteIds]
    );
    console.log(`  Phone ${group.phone}: kept ${keepId}, removed ${deleteIds.length} duplicate(s).`);
    totalRemoved += deleteIds.length;
  }

  // ── 2. Deduplicate phone-less patients by (clinic_id, lower(name), dob) ──
  const { rows: nameDupes } = await client.query(`
    SELECT clinic_id, LOWER(TRIM(name)) as lname, dob, COUNT(*) as cnt,
           array_agg(id ORDER BY created_at ASC) as ids
    FROM patients
    WHERE phone IS NULL
      AND is_deleted = false
    GROUP BY clinic_id, LOWER(TRIM(name)), dob
    HAVING COUNT(*) > 1
  `);

  console.log(`Found ${nameDupes.length} name+dob duplicate group(s) (phone-less).`);
  for (const group of nameDupes) {
    const keepId = group.ids[0];
    const deleteIds = group.ids.slice(1);
    await client.query(
      `UPDATE patients SET is_deleted = true, updated_at = NOW() WHERE id = ANY($1::uuid[])`,
      [deleteIds]
    );
    console.log(`  Name "${group.lname}" / dob ${group.dob}: kept ${keepId}, removed ${deleteIds.length} duplicate(s).`);
    totalRemoved += deleteIds.length;
  }

  // ── 3. Deduplicate phone-less patients by (clinic_id, lower(name)) alone ─
  const { rows: nameOnlyDupes } = await client.query(`
    SELECT clinic_id, LOWER(TRIM(name)) as lname, COUNT(*) as cnt,
           array_agg(id ORDER BY created_at ASC) as ids
    FROM patients
    WHERE phone IS NULL
      AND dob IS NULL
      AND is_deleted = false
    GROUP BY clinic_id, LOWER(TRIM(name))
    HAVING COUNT(*) > 1
  `);

  console.log(`Found ${nameOnlyDupes.length} name-only duplicate group(s) (no phone, no dob).`);
  for (const group of nameOnlyDupes) {
    const keepId = group.ids[0];
    const deleteIds = group.ids.slice(1);
    await client.query(
      `UPDATE patients SET is_deleted = true, updated_at = NOW() WHERE id = ANY($1::uuid[])`,
      [deleteIds]
    );
    console.log(`  Name "${group.lname}": kept ${keepId}, removed ${deleteIds.length} duplicate(s).`);
    totalRemoved += deleteIds.length;
  }

  console.log(`\n✅ Done. Total duplicates removed: ${totalRemoved}`);
  await client.end();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
