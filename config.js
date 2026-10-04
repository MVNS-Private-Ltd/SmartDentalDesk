// ─────────────────────────────────────────────────────────────────────────────
//  Smart Dental Desk — Legal Configuration
//  Legal values are loaded from the backend /api/config endpoint,
//  which reads them from server-side environment variables (Render/Vercel).
//  This file must NEVER contain real legal data, secrets, or emails directly.
// ─────────────────────────────────────────────────────────────────────────────

window.SDD_CONFIG = {};

(async function loadConfig() {
  // Determine the backend base URL
  const apiBase = window.SDD_API_BASE ||
    (window.location.hostname === 'localhost'
      ? 'http://localhost:3001'
      : 'https://smartdentaldesk.onrender.com');

  try {
    const res = await fetch(`${apiBase}/api/config`);
    if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
    const data = await res.json();
    window.SDD_CONFIG = data;
  } catch (err) {
    console.warn('[config] Could not load legal config from backend:', err.message);
    // Leave SDD_CONFIG as empty object — warning banner will render below
  }

  // Run banner + placeholder replacement after config loaded
  _applyConfig();
})();

function _applyConfig() {
  const requiredKeys = [
    'LEGAL_BUSINESS_NAME',
    'REGISTERED_ADDRESS',
    'SUPPORT_EMAIL',
    'PRIVACY_EMAIL',
    'GRIEVANCE_EMAIL',
    'EFFECTIVE_DATE',
    'GOVERNING_LAW'
  ];

  const missing = requiredKeys.filter(k => !window.SDD_CONFIG[k]);

  if (missing.length > 0) {
    const warning = document.createElement('div');
    warning.id = 'legalConfigWarning';
    warning.setAttribute('role', 'alert');
    warning.style.cssText = [
      'background:#fef2f2',
      'color:#991b1b',
      'padding:0.75rem 1rem',
      'text-align:center',
      'font-weight:bold',
      'font-size:0.85rem',
      'border-bottom:2px solid #dc2626',
      'position:sticky',
      'top:0',
      'z-index:9999'
    ].join(';');
    warning.textContent =
      'LEGAL REVIEW WARNING: Required production values are not configured. ' +
      'Missing: ' + missing.join(', ');
    if (document.body) {
      document.body.prepend(warning);
    } else {
      document.addEventListener('DOMContentLoaded', () => document.body.prepend(warning));
    }
  }

  // Replace [{{KEY}}] placeholders in all text nodes
  function replacePlaceholders() {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let n;
    while ((n = walk.nextNode())) {
      let text = n.nodeValue;
      for (const key in window.SDD_CONFIG) {
        const placeholder = `[{{${key}}}]`;
        if (text.includes(placeholder)) {
          const re = new RegExp(
            placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            'g'
          );
          text = text.replace(re, window.SDD_CONFIG[key] || `[MISSING: ${key}]`);
        }
      }
      n.nodeValue = text;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', replacePlaceholders);
  } else {
    replacePlaceholders();
  }
}
