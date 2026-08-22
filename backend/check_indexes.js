/**
 * check_indexes.js — Show all current indexes on the patients table
 */
const { Client } = require('pg');
const uri = 'postgresql://postgres:REDACTED_PASSWORD@db.qxioydfqnuuphgisbqxx.supabase.co:5432/postgres';
const client = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  const { rows } = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'patients'
    ORDER BY indexname;
  `);
  console.log('\nCurrent indexes on patients table:\n');
  rows.forEach(r => console.log(`  [${r.indexname}]\n  ${r.indexdef}\n`));
  await client.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
