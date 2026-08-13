SmartDentalDesk — Website Package
==================================

This is a static HTML/CSS/JS website (no build tools, no npm install needed).

HOW TO USE
----------
1. Unzip this folder.
2. Double-click index.html to open it in any browser — OR
3. For the best experience (so all internal links work smoothly), serve it locally:
     - VS Code: right-click index.html -> "Open with Live Server"
     - Or run: npx serve .   (from inside the smartdentaldesk folder)

PAGES
-----
- index.html     Home / landing page
- book.html      Patient-facing booking page
- schedule.html  Dentist's Today's Appointments view
- patients.html  Patient list with search + notes
- clinic.html    Clinic profile editor + live preview
- pricing.html   Pricing plans + FAQ
- login.html     Demo dentist login (redirects to schedule.html)

NOTES
-----
- All demo data (bookings, patients) lives in memory (assets/app.js) and resets
  on page refresh — this is intentional for a sales demo. To make it persistent,
  connect assets/app.js to Supabase (recommended, matches your usual stack).
- Colors, fonts and spacing are defined as CSS variables at the top of
  assets/style.css — easy to re-theme.
- Built for Zenth / SmartDentalDesk.
