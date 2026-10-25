/**
 * generate_public_discovery.js
 * Builds pre-rendered clinic discovery pages, static sitemap, and initial directory HTML
 * using only genuine, published clinics approved for public listing.
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
  console.log('[generate_public_discovery] Supabase credentials or library not available; using committed static discovery pages.');
  process.exit(0);
}

const DOMAIN = 'https://www.dentalsmart.tech';

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSuspectedSeedOrDemo(clinic) {
  const name = (clinic.name || '').toLowerCase();
  const owner = (clinic.owner_name || '').toLowerCase();
  const email = (clinic.email || '').toLowerCase();
  const slug = (clinic.booking_slug || '').toLowerCase();

  if (email.includes('demo') || email.includes('admin123') || email.includes('pokemondost') || email.includes('idk557711')) return true;
  if (name.includes('pokemon') || name.includes('admin\'s') || name.includes('idk\'s') || name.includes('bright smile')) return true;
  if (owner === 'admin' || owner === 'idk' || owner.includes('pokemon')) return true;
  return false;
}

function renderClinicProfileHtml(clinic) {
  const slug = clinic.booking_slug || clinic.id;
  const canonicalUrl = `${DOMAIN}/clinic/${encodeURIComponent(slug)}`;
  const clinicLocation = [clinic.area, clinic.city].filter(Boolean).join(', ') || clinic.city || 'India';
  const pageTitle = `${esc(clinic.name)} – Dental Clinic in ${esc(clinicLocation)} | DentalSmart`;
  const metaDesc = clinic.about && clinic.about.trim().length > 10
    ? `${esc(clinic.name)} in ${esc(clinicLocation)}: ${esc(clinic.about)}`.slice(0, 160)
    : `Book an appointment at ${esc(clinic.name)} in ${esc(clinicLocation)}. View clinic profile, dental treatments, timings, and fees on DentalSmart.`;

  const coverImg = clinic.cover_image || `${DOMAIN}/assets/clinic-fallback.png`;
  const services = Array.isArray(clinic.services_offered) ? clinic.services_offered : [];
  const amenities = Array.isArray(clinic.amenities) ? clinic.amenities : [];

  // Truthful JSON-LD Schema (no fake reviews)
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dentist",
    "name": clinic.name,
    "description": metaDesc,
    "url": canonicalUrl,
    "image": coverImg,
    "address": {
      "@type": "PostalAddress",
      "streetAddress": clinic.address || "",
      "addressLocality": clinic.city || "",
      "addressRegion": clinic.city || "",
      "postalCode": clinic.pincode || "",
      "addressCountry": "IN"
    }
  };
  if (clinic.phone) jsonLd.telephone = clinic.phone;
  if (clinic.timings) jsonLd.openingHours = clinic.timings;
  if (clinic.price_range) jsonLd.priceRange = clinic.price_range;
  if (clinic.rating && Number(clinic.rating) > 0 && clinic.review_count && Number(clinic.review_count) > 0) {
    jsonLd.aggregateRating = {
      "@type": "AggregateRating",
      "ratingValue": Number(clinic.rating).toFixed(1),
      "reviewCount": Number(clinic.review_count)
    };
  }

  const treatmentsHtml = services.length > 0
    ? services.map(s => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem 0; border-bottom:1px solid #f1f5f9;">
          <div>
            <strong>${esc(s.name)}</strong>
            ${s.description ? `<div style="font-size:0.8rem; color:#64748b;">${esc(s.description)}</div>` : ''}
          </div>
          <div style="font-weight:700; color:#0f172a;">
            ${s.price ? `₹${Number(s.price).toLocaleString('en-IN')}` : 'Consultation'}
          </div>
        </div>
      `).join('')
    : '<p style="color:#64748b; font-size:0.9rem; padding: 1rem 0;">Direct consultations and treatments available. Select consultation to book.</p>';

  const amenitiesHtml = amenities.length > 0
    ? `
      <div class="content-card">
        <h2 class="card-heading">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Hygiene, Safety &amp; Amenities
        </h2>
        <div class="amenities-wrap">
          ${amenities.map(a => `<span class="amenity-pill">${esc(a)}</span>`).join('')}
        </div>
      </div>
    `
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${metaDesc}">
  <link rel="canonical" href="${canonicalUrl}">
  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="dentalsmart">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${metaDesc}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${coverImg}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${metaDesc}">
  <meta name="twitter:image" content="${coverImg}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..700&family=General+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/style.css">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <script type="application/ld+json">
  ${JSON.stringify(jsonLd, null, 2)}
  </script>
  <style>
    :root {
      --font-body: 'General Sans', 'Inter', -apple-system, sans-serif;
      --font-display: 'Fraunces', Georgia, serif;
    }
    body { background-color: #f8fafc; color: #0f172a; min-height: 100vh; display: flex; flex-direction: column; }
    .detail-container { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem 5rem; width: 100%; }
    .breadcrumb-nav { font-size: 0.85rem; color: #64748b; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem; }
    .breadcrumb-nav a { color: #2563eb; text-decoration: none; font-weight: 500; }
    .clinic-showcase-header { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 2rem; margin-bottom: 2rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02); }
    .showcase-title { font-family: var(--font-display); font-size: clamp(1.8rem, 3.5vw, 2.4rem); font-weight: 700; color: #0f172a; margin-bottom: 0.25rem; }
    .showcase-doctor { font-size: 1.05rem; font-weight: 600; color: #2563eb; margin-bottom: 1rem; }
    .showcase-meta-row { display: flex; flex-wrap: wrap; gap: 1.5rem; font-size: 0.9rem; color: #475569; }
    .meta-item { display: flex; align-items: center; gap: 0.4rem; }
    .detail-two-col { display: grid; grid-template-columns: 7fr 5fr; gap: 2rem; }
    @media(max-width: 900px) { .detail-two-col { grid-template-columns: 1fr; } }
    .content-card { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.75rem; margin-bottom: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02); }
    .card-heading { font-size: 1.15rem; font-weight: 700; color: #0f172a; margin-bottom: 1.25rem; display: flex; align-items: center; gap: 0.5rem; }
    .amenities-wrap { display: flex; flex-wrap: wrap; gap: 0.6rem; }
    .amenity-pill { background: #f8fafc; border: 1px solid #e2e8f0; padding: 0.45rem 0.85rem; border-radius: 8px; font-size: 0.85rem; font-weight: 500; color: #334155; }
    .sticky-booking-card { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.75rem; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.04); position: sticky; top: 2rem; }
    .btn-proceed-booking { display: flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%; background: #2563eb; color: white; padding: 0.95rem; border-radius: 10px; font-weight: 600; font-size: 1rem; text-decoration: none; transition: background 0.2s; }
    .btn-proceed-booking:hover { background: #1d4ed8; }
    .instant-confirm-badge { background: #f3f4f6; color: #4b5563; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.6rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.35rem; }
  </style>
</head>
<body>

  <!-- HEADER -->
  <header style="background: white; border-bottom: 1px solid #e2e8f0; padding: 1rem var(--space-6); position: sticky; top: 0; z-index: 100;">
    <div style="max-width: var(--content-wide); margin: 0 auto; display: flex; justify-content: space-between; align-items: center;">
      <a href="/" class="brand" aria-label="dentalsmart home" style="display:flex; align-items:center; gap:0.6rem; text-decoration:none; color:inherit;">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#2563eb"/>
          <path d="M16 8c-2.8 0-5 1.9-5 4.6 0 1.7.6 2.7 1.2 3.9.7 1.4 1.4 3 1.6 6.1.1 1.4 1 2.4 2.2 2.4s2.1-1 2.2-2.4c.2-3.1.9-4.7 1.6-6.1.6-1.2 1.2-2.2 1.2-3.9C21 9.9 18.8 8 16 8Z" fill="#fff"/>
          <circle cx="16" cy="13" r="1.6" fill="#2563eb"/>
        </svg>
        <span class="brand-name" style="font-weight:700; font-size:1.25rem;">dentalsmart</span>
      </a>
      <div style="display:flex; align-items:center; gap:1.25rem;">
        <a href="/clinics" style="color:#475569; text-decoration:none; font-weight:600; font-size:0.9rem;">Find Clinics</a>
        <a href="/pricing" style="color:#475569; text-decoration:none; font-weight:600; font-size:0.9rem;">Pricing</a>
        <a href="/login.html" class="btn btn-secondary btn-sm" style="font-size:0.85rem; padding:0.4rem 0.8rem;">Clinic Login</a>
      </div>
    </div>
  </header>

  <main class="detail-container">
    <div class="breadcrumb-nav">
      <a href="/">Home</a>
      <span>&rsaquo;</span>
      <a href="/clinics">Clinics Directory</a>
      <span>&rsaquo;</span>
      <span style="color:#0f172a; font-weight:600;">${esc(clinic.name)}</span>
    </div>

    <!-- Clinic Header Card -->
    <section class="clinic-showcase-header">
      <div style="margin-bottom:0.75rem;">
        <span class="instant-confirm-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
          Profile information supplied by the clinic
        </span>
      </div>
      <h1 class="showcase-title">${esc(clinic.name)}</h1>
      ${clinic.owner_name ? `<div class="showcase-doctor">${esc(clinic.owner_name)}${clinic.experience_years ? ' &bull; ' + clinic.experience_years + '+ Years Experience' : ''}</div>` : ''}
      <div class="showcase-meta-row">
        <div class="meta-item">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${esc([clinic.address, clinic.area, clinic.city].filter(Boolean).join(', ') || clinic.city || 'India')}</span>
        </div>
        ${clinic.timings ? `
        <div class="meta-item">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>${esc(clinic.timings)}</span>
        </div>` : ''}
        ${clinic.phone ? `
        <div class="meta-item">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          <span>${esc(clinic.phone)}</span>
        </div>` : ''}
      </div>
    </section>

    <!-- Two-column Content -->
    <div class="detail-two-col">
      <div class="detail-left-content">
        <!-- About -->
        <div class="content-card">
          <h2 class="card-heading">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            About the Clinic
          </h2>
          <p style="color:#475569; line-height:1.7; font-size:0.95rem;">
            ${esc(clinic.about && clinic.about.trim() ? clinic.about.trim() : 'Dental clinic registered on DentalSmart providing general and specialized oral healthcare.')}
          </p>
        </div>

        <!-- Treatments & Services -->
        <div class="content-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem;">
            <h2 class="card-heading" style="margin:0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              Treatments &amp; Transparent Pricing
            </h2>
            <span style="font-size:0.8rem; color:#64748b;">Pricing Set by Clinic</span>
          </div>
          <div>
            ${treatmentsHtml}
          </div>
        </div>

        ${amenitiesHtml}
      </div>

      <!-- Right Booking Sidebar -->
      <aside>
        <div class="sticky-booking-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem;">
            <div>
              <span style="font-size:0.75rem; color:#64748b; font-weight:700; text-transform:uppercase;">Appointment Booking</span>
              <div style="font-size:1.3rem; font-weight:700; color:#0f172a;">Direct Booking</div>
            </div>
            <span class="instant-confirm-badge">Online Schedule</span>
          </div>

          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:0.85rem; font-size:0.82rem; color:#475569; margin-bottom:1.25rem;">
            <div style="display:flex; justify-content:space-between;">
              <span>Booking Mode:</span>
              <strong>Direct Clinic Appointment</strong>
            </div>
          </div>

          <a href="/book.html?c=${encodeURIComponent(slug)}" class="btn-proceed-booking">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Book Appointment Now
          </a>

          <div style="text-align:center; font-size:0.75rem; color:#94a3b8; margin-top:0.75rem;">
            Direct appointment confirmation via email
          </div>
        </div>
      </aside>
    </div>
  </main>

  <footer style="background: white; border-top: 1px solid #e2e8f0; padding: 2rem 1.5rem; margin-top: auto; text-align: center; font-size: 0.85rem; color: #64748b;">
    <div style="display:flex; justify-content:center; gap:1.5rem; flex-wrap:wrap; margin-bottom:0.75rem;">
      <a href="/privacy-policy" style="color:inherit; text-decoration:none;">Privacy Policy</a>
      <a href="/terms-of-service" style="color:inherit; text-decoration:none;">Terms of Service</a>
      <a href="/refund-cancellation" style="color:inherit; text-decoration:none;">Refund Policy</a>
    </div>
    <div>&copy; 2026 dentalsmart. Profile information supplied directly by the clinic.</div>
  </footer>

</body>
</html>`;
}

async function run() {
  console.log('=== DentalSmart Public Discovery Generator ===');
  
  if (!supabaseUrl || !supabaseKey) {
    console.warn('Missing SUPABASE_URL or SUPABASE_KEY. Skipping dynamic fetch; preserving existing pre-rendered assets.');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Querying clinics with is_active = true AND is_marketplace_listed = true...');
  const { data: clinics, error } = await supabase
    .from('clinics')
    .select('*')
    .eq('is_active', true)
    .eq('is_marketplace_listed', true);

  if (error) {
    console.error('Error fetching clinics from Supabase:', error);
    process.exit(1);
  }

  console.log(`Found ${clinics.length} clinics with marketplace listing enabled.`);

  const suspectedSeed = [];
  const genuineApproved = [];

  for (const c of clinics) {
    if (isSuspectedSeedOrDemo(c)) {
      suspectedSeed.push(c);
    } else {
      genuineApproved.push(c);
    }
  }

  console.log(`- Genuine approved clinics for public discovery: ${genuineApproved.length}`);
  console.log(`- Suspected seed/demo clinics flagged for review: ${suspectedSeed.length}`);

  // 1. Generate clean clinic detail pages in clinic/[slug]/index.html
  const clinicBaseDir = path.join(__dirname, 'clinic');
  if (!fs.existsSync(clinicBaseDir)) {
    fs.mkdirSync(clinicBaseDir, { recursive: true });
  }

  const generatedClinicSlugs = [];

  for (const c of genuineApproved) {
    const slug = c.booking_slug || c.id;
    const targetDir = path.join(clinicBaseDir, slug);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const html = renderClinicProfileHtml(c);
    fs.writeFileSync(path.join(targetDir, 'index.html'), html, 'utf8');
    generatedClinicSlugs.push(slug);
    console.log(`  Generated: /clinic/${slug}/index.html`);
  }

  // 2. Pre-render clinics directory grid in clinics.html
  const clinicsHtmlPath = path.join(__dirname, 'clinics.html');
  if (fs.existsSync(clinicsHtmlPath)) {
    let clinicsHtml = fs.readFileSync(clinicsHtmlPath, 'utf8');
    
    let initialGridContent = '';
    if (genuineApproved.length > 0) {
      initialGridContent = genuineApproved.map(c => {
        const slug = c.booking_slug || c.id;
        const cover = c.cover_image || '/assets/clinic-fallback.png';
        const loc = [c.area, c.city].filter(Boolean).join(', ') || 'India';
        return `
        <article class="clinic-card">
          <div class="clinic-card-image-wrap">
            <img src="${cover}" alt="${esc(c.name)}" class="clinic-card-image" loading="lazy" onerror="this.src='/assets/clinic-fallback.png'">
            ${c.is_featured ? '<div class="card-badge-top-left">Featured Clinic</div>' : ''}
          </div>
          <div class="clinic-card-body">
            <div>
              <div class="clinic-top-row">
                <div>
                  <a href="/clinic/${encodeURIComponent(slug)}" class="clinic-name">${esc(c.name)}</a>
                  ${c.owner_name ? `<div class="clinic-doctor">${esc(c.owner_name)}</div>` : ''}
                </div>
              </div>
              <div class="clinic-location">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span>${esc(loc)}</span>
              </div>
            </div>
            <div class="clinic-card-footer">
              <div class="price-starting"><span class="price-label">Consultation</span></div>
              <div class="card-actions">
                <a href="/clinic/${encodeURIComponent(slug)}" class="btn-view-profile">View Profile</a>
                <a href="/book.html?c=${encodeURIComponent(slug)}" class="btn-book-instant">Book Appointment</a>
              </div>
            </div>
          </div>
        </article>
        `;
      }).join('\n');
    } else {
      initialGridContent = `
        <div style="grid-column: 1 / -1; background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 3rem 2rem; text-align: center; max-width: 600px; margin: 2rem auto;">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: #eff6ff; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 1.25rem;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          </div>
          <h3 style="font-size: 1.35rem; font-weight: 700; color: #0f172a; margin-bottom: 0.5rem;">Independent Clinics Onboarding</h3>
          <p style="color: #64748b; line-height: 1.6; margin-bottom: 1.75rem; font-size: 0.95rem;">
            Dental practices across India are currently joining DentalSmart. Are you a clinic owner or dentist? List your practice today to accept verified online bookings.
          </p>
          <a href="/register.html" class="btn btn-primary" style="padding: 0.75rem 1.75rem; font-size: 0.95rem; display: inline-block;">List Your Practice</a>
        </div>
      `;
    }

    clinicsHtml = clinicsHtml.replace(
      /<div class="clinics-grid" id="clinicsGrid">[\s\S]*?<\/div>/,
      `<div class="clinics-grid" id="clinicsGrid">\n${initialGridContent}\n      </div>`
    );

    fs.writeFileSync(clinicsHtmlPath, clinicsHtml, 'utf8');
    console.log('  Updated clinics.html with truthful initial HTML content.');
  }

  // 3. Generate clean canonical sitemap.xml
  const today = new Date().toISOString().split('T')[0];
  const staticPages = [
    { loc: `${DOMAIN}/`, priority: '1.0', changefreq: 'daily', lastmod: today },
    { loc: `${DOMAIN}/clinics`, priority: '0.9', changefreq: 'daily', lastmod: today },
    { loc: `${DOMAIN}/pricing`, priority: '0.7', changefreq: 'weekly', lastmod: today },
    { loc: `${DOMAIN}/privacy-policy`, priority: '0.3', changefreq: 'yearly', lastmod: today },
    { loc: `${DOMAIN}/terms-of-service`, priority: '0.3', changefreq: 'yearly', lastmod: today },
    { loc: `${DOMAIN}/refund-cancellation`, priority: '0.3', changefreq: 'yearly', lastmod: today }
  ];

  const staticXml = staticPages.map(p => `  <url>
    <loc>${p.loc}</loc>
    <lastmod>${p.lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n');

  const clinicXml = genuineApproved.map(c => {
    const slug = c.booking_slug || c.id;
    const mod = (c.updated_at || c.created_at || new Date().toISOString()).split('T')[0];
    return `  <!-- ${esc(c.name)} (${esc(c.city || 'India')}) -->
  <url>
    <loc>${DOMAIN}/clinic/${encodeURIComponent(slug)}</loc>
    <lastmod>${mod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
  }).join('\n');

  const fullSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticXml}
${clinicXml ? '\n' + clinicXml : ''}
</urlset>
`;

  fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), fullSitemap, 'utf8');
  console.log(`  Generated sitemap.xml with ${staticPages.length + genuineApproved.length} canonical URLs.`);
  console.log('=== Discovery Generation Completed Successfully ===');
}

run().catch(err => {
  console.error('Fatal error in discovery generator:', err);
  process.exit(1);
});
