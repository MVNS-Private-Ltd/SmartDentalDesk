/**
 * rebuild_sitemap.js
 * Automatically fetches active, approved marketplace clinics from Supabase and rebuilds sitemap.xml
 * with clean canonical URLs.
 */
const fs = require('fs');
const path = require('path');

let dotenv;
try {
  dotenv = require('dotenv');
} catch (e) {
  try {
    dotenv = require(path.join(__dirname, 'backend', 'node_modules', 'dotenv'));
  } catch (err) {}
}

if (dotenv) {
  const backendEnvPath = path.join(__dirname, 'backend', '.env');
  if (fs.existsSync(backendEnvPath)) {
    dotenv.config({ path: backendEnvPath });
  } else {
    dotenv.config();
  }
}

let createClient;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (e) {
  try {
    createClient = require(path.join(__dirname, 'backend', 'node_modules', '@supabase', 'supabase-js')).createClient;
  } catch (err) {}
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!createClient || !supabaseUrl || !supabaseKey) {
  console.log('[rebuild_sitemap] Supabase credentials or library not available; using committed sitemap.xml.');
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function isSuspectedSeedOrDemo(clinic) {
  const name = (clinic.name || '').toLowerCase();
  const owner = (clinic.owner_name || '').toLowerCase();
  const email = (clinic.email || '').toLowerCase();

  if (email.includes('demo') || email.includes('admin123') || email.includes('pokemondost') || email.includes('idk557711')) return true;
  if (name.includes('pokemon') || name.includes('admin\'s') || name.includes('idk\'s') || name.includes('bright smile')) return true;
  if (owner === 'admin' || owner === 'idk' || owner.includes('pokemon')) return true;
  return false;
}

async function main() {
  console.log('Fetching approved marketplace clinics from Supabase...');
  const { data: clinics, error } = await supabase
    .from('clinics')
    .select('id, name, booking_slug, city, email, updated_at, created_at, is_marketplace_listed')
    .eq('is_active', true)
    .eq('is_marketplace_listed', true);

  if (error) {
    console.error('Error fetching clinics:', error);
    process.exit(1);
  }

  const approvedClinics = (clinics || []).filter(c => !isSuspectedSeedOrDemo(c));
  console.log(`Found ${clinics.length} listed clinics; ${approvedClinics.length} approved after excluding seed/demo.`);

  const domain = 'https://www.dentalsmart.tech';
  const today = new Date().toISOString().split('T')[0];

  const staticPages = [
    { loc: `${domain}/`, priority: '1.0', changefreq: 'daily', lastmod: today },
    { loc: `${domain}/clinics`, priority: '0.9', changefreq: 'daily', lastmod: today },
    { loc: `${domain}/pricing`, priority: '0.7', changefreq: 'weekly', lastmod: today },
    { loc: `${domain}/privacy-policy`, priority: '0.3', changefreq: 'yearly', lastmod: today },
    { loc: `${domain}/terms-of-service`, priority: '0.3', changefreq: 'yearly', lastmod: today },
    { loc: `${domain}/refund-cancellation`, priority: '0.3', changefreq: 'yearly', lastmod: today }
  ];

  const staticXml = staticPages.map(p => `  <url>
    <loc>${p.loc}</loc>
    <lastmod>${p.lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n');

  const clinicXml = approvedClinics.map(c => {
    const slug = c.booking_slug || c.id;
    const mod = (c.updated_at || c.created_at || new Date().toISOString()).split('T')[0];
    return `  <!-- ${c.name} (${c.city || 'India'}) -->
  <url>
    <loc>${domain}/clinic/${encodeURIComponent(slug)}</loc>
    <lastmod>${mod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
  }).join('\n');

  const fullXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticXml}
${clinicXml ? '\n' + clinicXml : ''}
</urlset>
`;

  const targetPath = path.join(__dirname, 'sitemap.xml');
  fs.writeFileSync(targetPath, fullXml, 'utf8');
  console.log(`Successfully generated sitemap.xml with ${staticPages.length + approvedClinics.length} URLs!`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
