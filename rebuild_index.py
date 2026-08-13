html = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Smart Dental Clinic &middot; Online Booking for Independent Dentists</title>
<meta name="description" content="Smart Dental Clinic gives dentists a shareable booking link, auto patient records, and a daily schedule view. No complex setup. No paper slips.">
<meta property="og:title" content="Smart Dental Clinic &middot; Online Booking for Independent Dentists">
<meta property="og:description" content="Shareable booking link, auto patient records, and a daily schedule built for dentists in India.">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..700&family=General+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="./assets/style.css">
<link rel="icon" href="./assets/favicon.svg" type="image/svg+xml">
<style>
/* Hero two-col */
.hero-two-col{display:grid;grid-template-columns:1fr 1fr;gap:clamp(2rem,6vw,5rem);align-items:center}
@media(max-width:860px){.hero-two-col{grid-template-columns:1fr}.hero-right{order:-1}}

/* Mockup card */
.mockup-card{background:var(--color-surface);border:1px solid var(--color-divider);border-radius:var(--radius-xl);box-shadow:var(--shadow-lg);overflow:hidden}
.mockup-topbar{background:var(--color-surface-offset);border-bottom:1px solid var(--color-divider);padding:var(--space-3) var(--space-5);display:flex;align-items:center;gap:var(--space-2)}
.mockup-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.mockup-body{padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-3)}
.appt-row{display:flex;align-items:center;justify-content:space-between;padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);border:1px solid var(--color-divider);background:var(--color-surface-2)}
.appt-left{display:flex;align-items:center;gap:var(--space-3)}
.appt-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.appt-info strong{display:block;font-size:var(--text-sm);font-weight:700}
.appt-info span{font-size:var(--text-xs);color:var(--color-text-muted)}
.mockup-footer{text-align:center;font-size:var(--text-xs);color:var(--color-text-faint);padding:var(--space-3) var(--space-5);border-top:1px solid var(--color-divider);font-weight:600;letter-spacing:.04em;text-transform:uppercase}

/* Trust strip */
.trust-row{display:flex;align-items:center;justify-content:center;gap:var(--space-6);flex-wrap:wrap;padding-block:var(--space-6);border-top:1px solid var(--color-divider);border-bottom:1px solid var(--color-divider)}
.trust-label{font-size:var(--text-xs);font-weight:600;color:var(--color-text-faint);text-transform:uppercase;letter-spacing:.06em}
.trust-cities{display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:center}
.trust-city{font-size:var(--text-sm);font-weight:600;color:var(--color-text-muted)}
.trust-sep{color:var(--color-border)}

/* Features */
.feature-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-5)}
@media(max-width:860px){.feature-grid{grid-template-columns:1fr 1fr}}
@media(max-width:540px){.feature-grid{grid-template-columns:1fr}}
.feat-card{background:var(--color-surface);border:1px solid var(--color-divider);border-radius:var(--radius-lg);padding:var(--space-6);display:flex;flex-direction:column;gap:var(--space-3);transition:box-shadow .2s ease,border-color .2s ease}
.feat-card:hover{box-shadow:var(--shadow-md);border-color:color-mix(in oklab,var(--color-primary) 25%,var(--color-divider))}
.feat-icon{width:40px;height:40px;border-radius:var(--radius-md);background:var(--color-primary-highlight);display:flex;align-items:center;justify-content:center;color:var(--color-primary);flex-shrink:0}
.feat-card h3{font-size:var(--text-base);font-family:var(--font-body);font-weight:700}
.feat-card p{font-size:var(--text-sm);color:var(--color-text-muted);line-height:1.6}

/* How it works */
.steps-row{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-6)}
@media(max-width:720px){.steps-row{grid-template-columns:1fr}}
.step-card{background:#1e293b;border:1px solid #334155;border-radius:var(--radius-lg);padding:var(--space-6);display:flex;flex-direction:column;gap:var(--space-4)}
.step-number{font-family:var(--font-display);font-size:2.5rem;font-weight:700;color:#3b82f6;line-height:1}
.step-card h3{font-size:var(--text-base);font-family:var(--font-body);font-weight:700;color:#f8fafc}
.step-card p{font-size:var(--text-sm);color:#94a3b8;line-height:1.6}

/* Benefits */
.benefit-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-4)}
@media(max-width:640px){.benefit-grid{grid-template-columns:1fr}}
.benefit-two-col{display:grid;grid-template-columns:1fr 1fr;gap:clamp(2rem,5vw,4rem);align-items:center}
@media(max-width:860px){.benefit-two-col{grid-template-columns:1fr}}
.benefit-item{display:flex;align-items:flex-start;gap:var(--space-4);padding:var(--space-5);border-radius:var(--radius-lg);background:var(--color-surface);border:1px solid var(--color-divider)}
.benefit-icon{width:36px;height:36px;border-radius:var(--radius-sm);background:var(--color-primary-highlight);display:flex;align-items:center;justify-content:center;color:var(--color-primary);flex-shrink:0}
.benefit-item h4{font-size:var(--text-sm);font-family:var(--font-body);font-weight:700;margin-bottom:.2em}
.benefit-item p{font-size:var(--text-sm);color:var(--color-text-muted);line-height:1.55}

/* CTA banner */
.cta-banner{background:#0f172a;border-radius:var(--radius-xl);padding:clamp(2.5rem,5vw,4rem) clamp(2rem,5vw,4rem);text-align:center;display:flex;flex-direction:column;align-items:center;gap:var(--space-6)}
.cta-banner h2{color:#f8fafc;font-size:var(--text-xl)}
.cta-banner p{color:#94a3b8;font-size:var(--text-base);max-width:48ch}

/* Section header */
.section-header{text-align:center;max-width:600px;margin-inline:auto;margin-bottom:clamp(2rem,4vw,3rem)}
.section-header h2{font-size:var(--text-xl);margin-top:var(--space-2)}
.section-header p{font-size:var(--text-base);color:var(--color-text-muted);margin-top:var(--space-3)}
</style>
</head>
<body>
<a href="#main" class="sr-only">Skip to content</a>

<!-- HEADER -->
<header class="site-header">
  <div class="container nav">
    <a href="./index.html" class="brand" aria-label="Smart Dental Clinic home">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#2563eb"/>
        <path d="M16 8c-2.8 0-5 1.9-5 4.6 0 1.7.6 2.7 1.2 3.9.7 1.4 1.4 3 1.6 6.1.1 1.4 1 2.4 2.2 2.4s2.1-1 2.2-2.4c.2-3.1.9-4.7 1.6-6.1.6-1.2 1.2-2.2 1.2-3.9C21 9.9 18.8 8 16 8Z" fill="#fff"/>
        <circle cx="16" cy="13" r="1.6" fill="#2563eb"/>
      </svg>
      <span class="brand-name">Smart Dental Clinic</span>
    </a>
    <nav class="nav-links" id="navLinks" aria-label="Primary">
      <a href="./index.html" aria-current="page">Home</a>
      <a href="./how-we-work.html">How we work</a>
      <div class="mobile-actions gap-3 mt-6">
        <a href="./login.html" class="btn btn-secondary btn-sm">Login</a>
        <a href="./register.html" class="btn btn-primary btn-sm">Register</a>
      </div>
    </nav>
    <div class="nav-actions">
      <a href="./login.html" class="btn btn-secondary btn-sm">Login</a>
      <a href="./register.html" class="btn btn-primary btn-sm">Register</a>
    </div>
    <button class="nav-toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round"/></svg>
    </button>
  </div>
</header>

<main id="main">

<!-- HERO -->
<section class="section container reveal">
  <div class="hero-two-col">
    <div class="hero-left">
      <span class="eyebrow">Online booking for dentists</span>
      <h1 style="font-size:clamp(2.6rem,2rem+2.5vw,4rem);line-height:1.1;letter-spacing:-.02em;margin-top:var(--space-3);margin-bottom:var(--space-5)">
        The simple way to<br><span style="color:var(--color-primary)">end paper slips.</span>
      </h1>
      <p style="font-size:var(--text-base);color:var(--color-text-muted);line-height:1.7;max-width:44ch;margin-bottom:var(--space-6)">
        Give patients a booking link. Records create themselves. Your daily schedule is always ready. No complex software, no training needed.
      </p>
      <ul style="list-style:none;display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-8)">
        <li style="display:flex;align-items:center;gap:var(--space-3);font-weight:600;font-size:var(--text-base)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
          Shareable booking link &mdash; ready in minutes
        </li>
        <li style="display:flex;align-items:center;gap:var(--space-3);font-weight:600;font-size:var(--text-base)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
          Patient records created automatically
        </li>
        <li style="display:flex;align-items:center;gap:var(--space-3);font-weight:600;font-size:var(--text-base)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
          Daily schedule view &mdash; no double entry
        </li>
      </ul>
      <div style="display:flex;gap:var(--space-3);flex-wrap:wrap">
        <a href="./register.html" class="btn btn-primary" style="padding:.85em 1.6em;font-size:var(--text-base);border-radius:var(--radius-full)">Get Started Free</a>
        <a href="./how-we-work.html" class="btn btn-secondary" style="padding:.85em 1.6em;font-size:var(--text-base);border-radius:var(--radius-full)">See how it works</a>
      </div>
    </div>
    <div class="hero-right">
      <div class="mockup-card">
        <div class="mockup-topbar">
          <div class="mockup-dot" style="background:#f87171"></div>
          <div class="mockup-dot" style="background:#fbbf24"></div>
          <div class="mockup-dot" style="background:#4ade80"></div>
          <span style="font-size:var(--text-xs);color:var(--color-text-faint);margin-left:var(--space-3);font-weight:600">Today&rsquo;s Schedule</span>
        </div>
        <div class="mockup-body">
          <div class="appt-row">
            <div class="appt-left">
              <div class="appt-dot" style="background:var(--color-primary)"></div>
              <div class="appt-info"><strong>09:00 AM &mdash; Root Canal</strong><span>Rahul Sharma</span></div>
            </div>
            <span class="badge">Confirmed</span>
          </div>
          <div class="appt-row">
            <div class="appt-left">
              <div class="appt-dot" style="background:var(--color-success)"></div>
              <div class="appt-info"><strong>10:30 AM &mdash; Consultation</strong><span>Anjali Verma</span></div>
            </div>
            <span class="badge" style="background:#dcfce7;color:#166534">Arrived</span>
          </div>
          <div class="appt-row">
            <div class="appt-left">
              <div class="appt-dot" style="background:var(--color-text-faint)"></div>
              <div class="appt-info"><strong>11:15 AM &mdash; Extraction</strong><span>Vikas Kumar</span></div>
            </div>
            <span class="badge badge-muted">Pending</span>
          </div>
          <div class="appt-row">
            <div class="appt-left">
              <div class="appt-dot" style="background:var(--color-primary)"></div>
              <div class="appt-info"><strong>02:00 PM &mdash; Cleaning</strong><span>Priya Singh</span></div>
            </div>
            <span class="badge">Confirmed</span>
          </div>
        </div>
        <div class="mockup-footer">Live dashboard &middot; updates automatically</div>
      </div>
    </div>
  </div>
</section>

<!-- TRUST STRIP -->
<section class="container reveal">
  <div class="trust-row">
    <span class="trust-label">Trusted by clinics in</span>
    <div class="trust-cities">
      <span class="trust-city">Chandigarh</span>
      <span class="trust-sep">&middot;</span>
      <span class="trust-city">Ludhiana</span>
      <span class="trust-sep">&middot;</span>
      <span class="trust-city">Panchkula</span>
      <span class="trust-sep">&middot;</span>
      <span class="trust-city">Mohali</span>
      <span class="trust-sep">&middot;</span>
      <span class="trust-city">Zirakpur</span>
    </div>
  </div>
</section>

<!-- FEATURES -->
<section class="section container reveal">
  <div class="section-header">
    <span class="eyebrow">What&rsquo;s included</span>
    <h2>Everything a dental clinic actually needs &mdash; nothing it doesn&rsquo;t.</h2>
    <p>Built for independent dentists who want to stop managing paper and start seeing more patients.</p>
  </div>
  <div class="feature-grid">
    <div class="feat-card">
      <div class="feat-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      </div>
      <h3>Shareable Booking Link</h3>
      <p>One link for your Google listing, WhatsApp, or anywhere online. Patients book themselves &mdash; no phone tag.</p>
    </div>
    <div class="feat-card">
      <div class="feat-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <h3>Auto Patient Records</h3>
      <p>Every booking creates a patient record instantly. Name, contact, visit history &mdash; no manual entry needed.</p>
    </div>
    <div class="feat-card">
      <div class="feat-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </div>
      <h3>Daily Schedule View</h3>
      <p>Open today&rsquo;s view each morning. See who&rsquo;s coming in, mark arrivals, track the full day at a glance.</p>
    </div>
    <div class="feat-card">
      <div class="feat-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      </div>
      <h3>Clinic Profile Page</h3>
      <p>Your name, address, timings and services shown cleanly on your booking page for every patient who visits.</p>
    </div>
    <div class="feat-card">
      <div class="feat-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <h3>Private &amp; Secure Data</h3>
      <p>Patient data stays yours. No third-party sharing, no ads. Your clinic&rsquo;s records are private by design.</p>
    </div>
    <div class="feat-card">
      <div class="feat-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </div>
      <h3>Zero Learning Curve</h3>
      <p>Set up in under 10 minutes. No training, no manuals, no IT. If you can use WhatsApp, you can use this.</p>
    </div>
  </div>
</section>

<!-- HOW IT WORKS -->
<section class="section-dark reveal">
  <div class="container section">
    <div class="section-header" style="color:#f8fafc">
      <span class="eyebrow" style="color:#7fd8c6">From signup to first booking</span>
      <h2 style="color:#f8fafc">Three steps to go live this week.</h2>
      <p style="color:#94a3b8">No installation. No onboarding calls. Just your clinic, online.</p>
    </div>
    <div class="steps-row">
      <div class="step-card">
        <div class="step-number">01</div>
        <h3>Set up your clinic</h3>
        <p>Add your clinic name, address, working hours and treatments. Takes about five minutes to complete.</p>
      </div>
      <div class="step-card">
        <div class="step-number">02</div>
        <h3>Share your booking link</h3>
        <p>Pin it to your WhatsApp Business profile and add it to your Google Maps listing. Patients find it and book directly.</p>
      </div>
      <div class="step-card">
        <div class="step-number">03</div>
        <h3>Manage patients &amp; schedule</h3>
        <p>Open your dashboard each morning. See today&rsquo;s schedule, patient records, and mark visits complete as they arrive.</p>
      </div>
    </div>
  </div>
</section>

<!-- BENEFITS / OUTCOMES -->
<section class="section container reveal">
  <div class="benefit-two-col">
    <div>
      <span class="eyebrow">Real outcomes</span>
      <h2 style="font-size:var(--text-xl);margin-top:var(--space-2);margin-bottom:var(--space-4)">What changes once you&rsquo;re live.</h2>
      <p style="color:var(--color-text-muted);font-size:var(--text-base);line-height:1.7;max-width:38ch">
        Dentists who move from paper and phone calls to Smart Dental Clinic save real time every single day.
      </p>
    </div>
    <div class="benefit-grid">
      <div class="benefit-item">
        <div class="benefit-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        </div>
        <div>
          <h4>Reduce no-shows</h4>
          <p>Patients who self-book are more committed. Fewer forgotten appointments, less wasted chair time.</p>
        </div>
      </div>
      <div class="benefit-item">
        <div class="benefit-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div>
          <h4>Save front desk time</h4>
          <p>Stop answering &ldquo;do you have a slot?&rdquo; calls. Bookings come in while you treat patients.</p>
        </div>
      </div>
      <div class="benefit-item">
        <div class="benefit-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/></svg>
        </div>
        <div>
          <h4>Improve patient flow</h4>
          <p>A clear daily schedule means no over-booking, no gaps, no last-minute surprises at reception.</p>
        </div>
      </div>
      <div class="benefit-item">
        <div class="benefit-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </div>
        <div>
          <h4>Simplify daily operations</h4>
          <p>No paper registers to update at night. Records are already there. Close the day and go home.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- TESTIMONIALS -->
<section class="section container reveal">
  <div class="section-header">
    <span class="eyebrow">What dentists say</span>
    <h2>Built with real feedback, not guesses.</h2>
  </div>
  <div class="testimonial-strip">
    <div class="testimonial">
      <span class="quote-mark">&ldquo;</span>
      <p>Patients now book directly from my Google listing instead of calling to ask if I have a slot. Saves me at least an hour a day.</p>
      <div class="testimonial-author">
        <div class="avatar">DR</div>
        <div><strong>Dr. Rohit Malhotra</strong><span>Dentist, Panchkula</span></div>
      </div>
    </div>
    <div class="testimonial">
      <span class="quote-mark">&ldquo;</span>
      <p>I didn&rsquo;t want to learn full clinic software just to stop losing paper slips. This did exactly the one job I needed.</p>
      <div class="testimonial-author">
        <div class="avatar">AK</div>
        <div><strong>Dr. Anjali Kaur</strong><span>General dentist, Mohali</span></div>
      </div>
    </div>
    <div class="testimonial">
      <span class="quote-mark">&ldquo;</span>
      <p>My front desk is just me. The daily schedule view means I never forget who&rsquo;s coming in after lunch anymore.</p>
      <div class="testimonial-author">
        <div class="avatar">SM</div>
        <div><strong>Dr. Sanjeev Mehta</strong><span>Dental clinic owner, Zirakpur</span></div>
      </div>
    </div>
  </div>
</section>

<!-- CTA BANNER -->
<section class="section container reveal">
  <div class="cta-banner">
    <h2>Ready to fill your schedule without the phone calls?</h2>
    <p>Set up your clinic profile, share your booking link, and see patients start booking within minutes.</p>
    <a href="./register.html" class="btn btn-primary" style="padding:.9em 2em;font-size:var(--text-base);border-radius:var(--radius-full)">Get Started Free</a>
  </div>
</section>

</main>

<!-- FOOTER -->
<footer class="site-footer">
  <div class="container footer-grid">
    <div>
      <div class="flex gap-3" style="align-items:center">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#1e3a8a"/>
          <path d="M16 8c-2.8 0-5 1.9-5 4.6 0 1.7.6 2.7 1.2 3.9.7 1.4 1.4 3 1.6 6.1.1 1.4 1 2.4 2.2 2.4s2.1-1 2.2-2.4c.2-3.1.9-4.7 1.6-6.1.6-1.2 1.2-2.2 1.2-3.9C21 9.9 18.8 8 16 8Z" fill="#60a5fa"/>
        </svg>
        <strong style="font-family:var(--font-display);color:#eef4f1">Smart Dental Clinic</strong>
      </div>
      <p class="mt-6" style="font-size:var(--text-xs);color:#9fb0aa;max-width:28ch;line-height:1.6">
        Simple online booking and patient management for independent dentists across India.
      </p>
    </div>
    <div>
      <h4>Product</h4>
      <ul>
        <li><a href="./index.html">Home</a></li>
        <li><a href="./how-we-work.html">How we work</a></li>
        <li><a href="./login.html">Login</a></li>
        <li><a href="./register.html">Register</a></li>
      </ul>
    </div>
    <div>
      <h4>Company</h4>
      <ul>
        <li>Made in India</li>
        <li>For dental clinics</li>
        <li>Privacy-first</li>
      </ul>
    </div>
    <div>
      <h4>Contact</h4>
      <ul>
        <li>hello@smartdentaldesk.in</li>
        <li>WhatsApp: +91 98XXX XXXXX</li>
      </ul>
    </div>
  </div>
  <div class="container footer-bottom">
    <span>&copy; 2026 Smart Dental Clinic. All rights reserved.</span>
    <span>Built for independent dentists &amp; small clinics.</span>
  </div>
</footer>

<script src="./assets/app.js"></script>
</body>
</html>"""

with open("index.html", "w", encoding="utf-8") as f:
    f.write(html)

print("index.html written successfully.")
