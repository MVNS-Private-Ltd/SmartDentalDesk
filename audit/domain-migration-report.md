# Domain Migration Audit Report

## Old Domain Occurrences Found
The old domain `https://smart-dental-desk.vercel.app` (and variations) was found in multiple locations:
- **Canonical tags and Open Graph meta tags** across public HTML pages.
- **JSON-LD Schema definitions** (LocalBusiness, WebPage) in HTML pages.
- **`sitemap.xml`** and **`robots.txt`**.
- **Backend environment variables** (`FRONTEND_ORIGIN`, `OAUTH_REDIRECT`, `RESET_PASSWORD_REDIRECT`) in `.env` and `.env.example`.
- **Backend auth logic** in `backend/routes/auth.js`.

## Files Changed
The following 20 files were updated to replace `https://smart-dental-desk.vercel.app` with `https://www.dentalsmart.tech`:
1. `billing.html`
2. `book.html`
3. `clinic-detail.html`
4. `clinics.html`
5. `dashboard.html`
6. `index.html`
7. `login.html`
8. `pricing.html`
9. `privacy-policy.html`
10. `receptionist-dashboard.html`
11. `refund-cancellation.html`
12. `register.html`
13. `reset-password.html`
14. `robots.txt`
15. `sitemap.xml`
16. `super-admin.html`
17. `terms-of-service.html`
18. `backend/.env`
19. `backend/.env.example`
20. `backend/routes/auth.js`
21. `vercel.json` (Added host-based redirect)

## Environment Variables to Update Manually
The owner must manually update the following environment variables in Render and Vercel:
- **`FRONTEND_ORIGIN`**: Set to `https://www.dentalsmart.tech`
- **`OAUTH_REDIRECT`**: Set to `https://www.dentalsmart.tech/login.html`
- **`RESET_PASSWORD_REDIRECT`**: Set to `https://www.dentalsmart.tech/reset-password.html`
- **`EMAIL_PRODUCTION_DOMAIN`**: Ensure this is `dentalsmart.tech` if applicable, matching Resend configurations.

## Redirect Behavior
The old domain `smart-dental-desk.vercel.app` has NOT been removed from Vercel. 
Instead, a host-based redirect was added to `vercel.json` to automatically and permanently (308) redirect all traffic coming to `smart-dental-desk.vercel.app` over to `https://www.dentalsmart.tech`.
The apex domain `dentalsmart.tech` is already configured in Vercel. This configuration avoids loop redirects.

## Sitemap URLs
All URLs in `sitemap.xml` were updated to use the canonical domain. Only public, indexable pages are included:
- `https://www.dentalsmart.tech/`
- `https://www.dentalsmart.tech/index.html`
- `https://www.dentalsmart.tech/clinics.html`
- `https://www.dentalsmart.tech/pricing.html`
- `https://www.dentalsmart.tech/privacy-policy.html`
- `https://www.dentalsmart.tech/terms-of-service.html`
- `https://www.dentalsmart.tech/refund-cancellation.html`

## Canonical Examples
Example from `index.html`:
```html
<link rel="canonical" href="https://www.dentalsmart.tech/">
<meta property="og:url" content="https://www.dentalsmart.tech/">
```

## Unresolved Hardcoded URLs
- Internal navigation links already utilize relative paths where appropriate, meaning they do not rely on hardcoded production domains.
- Localhost URLs in dev blocks (e.g. `window.location.hostname === 'localhost'`) remain deliberately for local development.

## Missing Configuration
- Be sure to update Google OAuth settings in the Google Cloud Console or Supabase to accept `https://www.dentalsmart.tech/login.html` as the redirect URI.
- Make sure to update Stripe/Razorpay webhook URLs or redirect URLs if they are currently pointed to the old domain.
