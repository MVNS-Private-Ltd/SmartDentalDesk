/**
 * migrate_v11_rls.js
 * Enables Row-Level Security (RLS) on all tables.
 * Even though the backend uses the service_role key (which bypasses RLS),
 * enabling RLS is a critical defense-in-depth measure to protect data
 * if the anon key is ever used directly against the database.
 *
 * Usage: node migrate_v11_rls.js
 */
require("dotenv").config();
const { Client } = require("pg");

const uri = process.env.DATABASE_URL;
if (!uri) {
  console.error("❌ DATABASE_URL is not set in .env");
  process.exit(1);
}

const client = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });

async function run(label, sql) {
  try {
    await client.query(sql);
    console.log("✅  " + label);
  } catch (err) {
    if (err.message.includes("already exists")) {
      console.log("⏭   " + label + " (policy already exists, skipped)");
    } else {
      console.error("❌  " + label + ": " + err.message);
      throw err;
    }
  }
}

async function dropPolicies(table) {
  const { rows } = await client.query(
    "SELECT policyname FROM pg_policies WHERE tablename = $1",
    [table]
  );
  for (const row of rows) {
    await client.query(`DROP POLICY IF EXISTS "${row.policyname}" ON "${table}"`);
  }
}

async function main() {
  await client.connect();
  console.log("Connected to Supabase Postgres.\n");

  // ── 1. Clinics ──────────────────────────────────────────────────────────────
  await run("Enable RLS on clinics", "ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;");
  await dropPolicies("clinics");
  await run(
    "clinics: owner full access",
    `CREATE POLICY "Owner can manage own clinic"
     ON clinics FOR ALL TO authenticated
     USING (owner_id = auth.uid())
     WITH CHECK (owner_id = auth.uid());`
  );
  await run(
    "clinics: staff can view their clinic",
    `CREATE POLICY "Staff can view their clinic"
     ON clinics FOR SELECT TO authenticated
     USING (
       id IN (
         SELECT clinic_id FROM staff WHERE auth_id = auth.uid() AND is_active = true
       )
     );`
  );

  // ── 2. Staff ─────────────────────────────────────────────────────────────────
  await run("Enable RLS on staff", "ALTER TABLE staff ENABLE ROW LEVEL SECURITY;");
  await dropPolicies("staff");
  await run(
    "staff: owner full access",
    `CREATE POLICY "Owner can manage staff"
     ON staff FOR ALL TO authenticated
     USING (
       clinic_id IN (SELECT id FROM clinics WHERE owner_id = auth.uid())
     )
     WITH CHECK (
       clinic_id IN (SELECT id FROM clinics WHERE owner_id = auth.uid())
     );`
  );
  await run(
    "staff: member can view own record",
    `CREATE POLICY "Staff can view own record"
     ON staff FOR SELECT TO authenticated
     USING (auth_id = auth.uid());`
  );

  // ── 3. Tables that have clinic_id ────────────────────────────────────────────
  const tables = ["patients", "appointments", "treatment_records", "invoices"];
  for (const table of tables) {
    console.log("\n─── " + table + " ───");
    await run(`Enable RLS on ${table}`, `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    await dropPolicies(table);

    await run(
      `${table}: owner full access`,
      `CREATE POLICY "Owner full access to ${table}"
       ON "${table}" FOR ALL TO authenticated
       USING (
         clinic_id IN (SELECT id FROM clinics WHERE owner_id = auth.uid())
       )
       WITH CHECK (
         clinic_id IN (SELECT id FROM clinics WHERE owner_id = auth.uid())
       );`
    );

    await run(
      `${table}: staff access`,
      `CREATE POLICY "Staff access to ${table}"
       ON "${table}" FOR ALL TO authenticated
       USING (
         clinic_id IN (
           SELECT clinic_id FROM staff WHERE auth_id = auth.uid() AND is_active = true
         )
       )
       WITH CHECK (
         clinic_id IN (
           SELECT clinic_id FROM staff WHERE auth_id = auth.uid() AND is_active = true
         )
       );`
    );
  }

  // ── 4. Revoke anon access explicitly ─────────────────────────────────────────
  console.log("\n─── Revoking anon access ───");
  for (const table of ["clinics", "staff", "patients", "appointments", "treatment_records", "invoices"]) {
    await run(`Revoke anon SELECT on ${table}`, `REVOKE SELECT ON "${table}" FROM anon;`);
  }

  console.log("\n🎉  RLS migration (v11) completed. All tables are now protected.\n");
  await client.end();
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
