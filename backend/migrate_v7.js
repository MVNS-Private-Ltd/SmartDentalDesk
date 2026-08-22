const { Client } = require('pg');

const uri = 'postgresql://postgres:Nabha%40219.clinic@db.qxioydfqnuuphgisbqxx.supabase.co:5432/postgres';

const client = new Client({
  connectionString: uri,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL!');

    // Drop the old NOT NULL unique constraint
    await client.query(`
      ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_clinic_id_phone_key;
    `);
    console.log('✅ Dropped old unique constraint on (clinic_id, phone)');

    // Make phone nullable
    await client.query(`
      ALTER TABLE patients ALTER COLUMN phone DROP NOT NULL;
    `);
    console.log('✅ Dropped NOT NULL constraint on phone column');

    // Create partial unique index — only enforces uniqueness when phone is not null
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS patients_clinic_id_phone_unique
        ON patients (clinic_id, phone)
        WHERE phone IS NOT NULL;
    `);
    console.log('✅ Created partial unique index on (clinic_id, phone) WHERE phone IS NOT NULL');

    console.log('\n🎉 schema_v7 migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
  } finally {
    await client.end();
  }
}

runMigration();
