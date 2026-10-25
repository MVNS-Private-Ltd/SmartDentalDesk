/**
 * unpublish_internal_test_clinics.js
 * Safely unpublishes internal test clinic accounts from public marketplace discovery
 * WITHOUT deleting accounts, authentication records, patients, staff, or test data.
 *
 * Accounts targeted:
 * - e50f30h3l (admin's Clinic)
 * - 6e695bqy4 (VAIBHAV Sharma's Dental Clinic)
 * - 41d408rli (Mohit Yes's Dental Clinic)
 * - edd501096 (Vaibhav's Dental Clinic)
 *
 * Usage:
 *   node backend/scripts/unpublish_internal_test_clinics.js --dry-run
 *   node backend/scripts/unpublish_internal_test_clinics.js --execute
 */

const path = require('path');
const fs = require('fs');

let dotenv;
try {
  dotenv = require('dotenv');
} catch (e) {
  try {
    dotenv = require(path.join(__dirname, '..', 'node_modules', 'dotenv'));
  } catch (err) {}
}

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath) && dotenv) {
  dotenv.config({ path: envPath });
} else if (dotenv) {
  dotenv.config();
}

let createClient;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (e) {
  createClient = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js')).createClient;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TARGET_SLUGS = ['e50f30h3l', '6e695bqy4', '41d408rli', 'edd501096'];

async function run() {
  const isExecute = process.argv.includes('--execute');
  const mode = isExecute ? 'EXECUTE' : 'DRY-RUN';

  console.log(`\n======================================================`);
  console.log(`  UNPUBLISH INTERNAL TEST CLINICS (${mode})`);
  console.log(`======================================================\n`);

  const { data: clinics, error } = await supabase
    .from('clinics')
    .select('id, name, booking_slug, email, is_marketplace_listed, is_active')
    .in('booking_slug', TARGET_SLUGS);

  if (error) {
    console.error('Error querying clinics:', error);
    process.exit(1);
  }

  console.log(`Found ${clinics.length} matching target accounts in Supabase:`);
  for (const c of clinics) {
    console.log(`- ID: ${c.id} | Slug: ${c.booking_slug} | Name: "${c.name}" | Current listed: ${c.is_marketplace_listed}`);
  }

  if (!isExecute) {
    console.log(`\n[DRY-RUN] No changes were made to Supabase or filesystem.`);
    console.log(`Run with --execute after owner approval to apply changes.`);
    return;
  }

  console.log(`\nApplying database update: Setting is_marketplace_listed = false...`);
  const { error: updateErr } = await supabase
    .from('clinics')
    .update({ is_marketplace_listed: false, updated_at: new Date().toISOString() })
    .in('booking_slug', TARGET_SLUGS);

  if (updateErr) {
    console.error('Error updating clinics in Supabase:', updateErr);
    process.exit(1);
  }
  console.log(`✅ Supabase update successful: All target accounts set to is_marketplace_listed = false.`);

  // Clean up static clinic folders
  const rootDir = path.join(__dirname, '..', '..');
  const clinicDir = path.join(rootDir, 'clinic');
  for (const slug of TARGET_SLUGS) {
    const slugDir = path.join(clinicDir, slug);
    if (fs.existsSync(slugDir)) {
      fs.rmSync(slugDir, { recursive: true, force: true });
      console.log(`🗑️ Removed static directory: /clinic/${slug}/`);
    }
  }

  // Regenerate discovery pages (empty state) and sitemap
  console.log(`\nRegenerating discovery pages and sitemap...`);
  const generateScript = path.join(rootDir, 'generate_public_discovery.js');
  require(generateScript);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
