/**
 * rebuild_sitemap.js
 * Automatically fetches all active clinics from Supabase and rebuilds sitemap.xml
 */
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, 'backend', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, 'backend', '.env') });
require(path.join(__dirname, 'backend', 'node_modules', 'dotenv')).config();

const { createClient } = require(path.join(__dirname, 'backend', 'node_modules', '@supabase', 'supabase-js'));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('Fetching active clinics from Supabase...');
  const { data: clinics, error } = await supabase
    .from('clinics')
    .select('id, name, booking_slug, city, updated_at, created_at')
    .eq('is_active', true);

  if (error) {
    console.error('Error fetching clinics:', error);
    process.exit(1);
  }

  console.log(`Found ${clinics.length} active clinics.`);

  const domain = 'https://www.dentalsmart.tech';
  const today = new Date().toISOString().split('T')[0];

  const staticPages = [
    { loc: `${domain}/`, priority: '1.0', changefreq: 'daily', lastmod: today },
    { loc: `${domain}/clinics.html`, priority: '0.9', changefreq: 'daily', lastmod: today },
    { loc: `${domain}/pricing.html`, priority: '0.7', changefreq: 'weekly', lastmod: today },
    { loc: `${domain}/privacy-policy.html`, priority: '0.3', changefreq: 'yearly', lastmod: today },
    { loc: `${domain}/terms-of-service.html`, priority: '0.3', changefreq: 'yearly', lastmod: today },
    { loc: `${domain}/refund-cancellation.html`, priority: '0.3', changefreq: 'yearly', lastmod: today }
  ];

  const staticXml = staticPages.map(p => `  <url>
    <loc>${p.loc}</loc>
    <lastmod>${p.lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n');

  const clinicXml = clinics.map(c => {
    const slug = c.booking_slug || c.id;
    const mod = (c.updated_at || c.created_at || new Date().toISOString()).split('T')[0];
    return `  <!-- ${c.name} (${c.city || 'India'}) -->
  <url>
    <loc>${domain}/clinic-detail.html?c=${encodeURIComponent(slug)}</loc>
    <lastmod>${mod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
  }).join('\n');

  const fullXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticXml}
${clinicXml}
</urlset>
`;

  const targetPath = path.join(__dirname, 'sitemap.xml');
  fs.writeFileSync(targetPath, fullXml, 'utf8');
  console.log(`Successfully generated sitemap.xml with ${staticPages.length + clinics.length} URLs!`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
