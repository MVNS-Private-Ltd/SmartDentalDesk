# DentalSmart Product Capability & Feature Evidence Matrix

This document provides a factual, grounded verification matrix of DentalSmart platform capabilities as of **2 November 2026**. Each claim is evaluated against verified source code, API routes, database schemas, and background job configurations.

---

## 1. Evidence Matrix

| Area / Feature | Supporting Route / Component / Config | Implementation Status | Plan Availability & Restrictions | Safe Marketing Wording | Disallowed / Unsupported Claims |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Appointment Scheduling & Calendar** | `backend/routes/appointments.js`<br>`dashboard.html`<br>`receptionist-dashboard.html` | **Verified** | All plans (Starter, Growth, Premium) & active 3-month free trial | Central appointment calendar, queue monitoring, daily schedule management, and status tracking (`pending`, `scheduled`, `confirmed`, `in-progress`, `completed`, `cancelled`, `no-show`). | Multi-chair/multi-doctor simultaneous grid, calendar sync with Google/Outlook, automated conflict resolution across multiple resources, waitlists, recurring series, auto-rescheduling. |
| **Public Online Booking** | `backend/routes/public.js`<br>`book.html?c=<slug>`<br>`clinics.html` | **Verified** | Dedicated booking link included on all tiers; directory listing gated on Growth & Premium | Dedicated clinic booking link (`/book.html?c=<slug>`) available 24/7 for patient self-service; checks existing patients by phone/email to prevent duplicates. | "Reserve with Google" direct native API integration, guaranteed search engine ranking on Google Maps, verified clinic badge guarantees. "24/7" refers strictly to booking page availability. |
| **Public Marketplace Directory** | `backend/routes/public.js`<br>`clinics.html`<br>`generate_public_discovery.js`<br>`backend/lib/plans.js` (`marketplace: true`) | **Verified** | Growth, Premium tiers, or active 3-month free trial (`marketplace: false` on Starter) | Discoverable listing in central public directory (`/clinics`) for verified, active clinics. | Starter plan inclusion; universal directory placement without listing criteria; instant search engine indexing guarantees. |
| **Patient Records & History** | `backend/routes/patients.js`<br>`backend/routes/treatments.js`<br>`dashboard.html` | **Verified** | All plans & active 3-month free trial | Digital patient profile recording contact details, demographics, medical history notes, allergies, visit history, and linked appointments. | Universal EHR legal compliance certifications; automated electronic import from proprietary dental software; automated optical scan digitizing. |
| **Treatment Records & Logs** | `backend/routes/treatments.js`<br>`dashboard.html` | **Verified** | All plans & active 3-month free trial | Itemized treatment logs with procedure text, tooth number, visit cost, clinical notes, doctor reference, and prescription fields. | Interactive graphical dental charting (odontogram), graphical periodontal charting (probing depths, bleeding points), radiology/DICOM viewer integrations. |
| **Patient File Attachments** | `backend/routes/patients.js` (`/:id/files`)<br>`supabase/schema_v15_files.sql` | **Verified** | All plans & active 3-month free trial | Secure file attachment upload (photos, documents) linked to individual patient profiles. | Automated radiology hardware integration, DICOM 3D volumetric rendering, automated AI diagnostic interpretation. |
| **Billing & Invoices** | `backend/routes/invoices.js`<br>`billing.html` | **Verified** | All plans & active 3-month free trial | Itemized invoice creation with treatments/services, quantity, unit price, configurable discount, and configurable tax percentage; calculates balance due. | Integrated payment processing for patient checkout, automatic clearinghouse claims, insurance claim adjudication, automated bank reconciliation. |
| **Payment Status Tracking** | `backend/routes/invoices.js`<br>`dashboard.html` | **Verified** | All plans & active 3-month free trial | Manual recording of payments across cash, card, UPI, bank transfer; tracks `paid`, `unpaid`, and `partially_paid` statuses. | Automated payment gateway deduction from patient bank accounts for dental treatments; real-time card chargeback dispute resolution. |
| **Configurable Taxes (GST / VAT)** | `backend/routes/invoices.js`<br>`billing.html` | **Verified (Limited)** | All plans & active 3-month free trial | Configurable tax rates (e.g., GST or local sales taxes) applied as percentage line items on invoices. | Tax advisory services, universal statutory tax compliance guarantees, automated e-invoicing portal sync (e-way/IRN). |
| **Automated Email Reminders** | `backend/cron/reminders.js`<br>`backend/routes/cron.js` (`/send-reminders`) | **Verified** | Growth, Premium tiers, or active 3-month free trial | Automated email appointment reminders sent ~24 hours prior to scheduled visits to patients with an email address on file. | WhatsApp API automated messaging, SMS gateway delivery, two-way patient response confirmations ("reply 1 to confirm"), guaranteed no-show elimination. |
| **Staff Accounts & Roles** | `backend/routes/staff.js`<br>`receptionist-dashboard.html`<br>`backend/middleware/auth.js` | **Verified** | Starter: 2 staff; Growth: 5 staff; Premium: Unlimited (per public pricing). *Owner context: 7/15/50.* | Multi-user clinic staff accounts with role-based access for clinic administrators, dentists, and receptionists. | Granular per-field custom permission builder, physical multi-branch clinic routing, HIPAA/SOC-2 enterprise audit compliance claims. |
| **Practice Reports & Analytics** | `backend/routes/dashboard.js` (`/reports`) | **Verified** | Requires active subscription or active trial | Real operational reports: collected revenue, invoiced revenue, outstanding balances, visit completion, cancellation/no-show rates, new vs returning patient counts, payment method breakdowns across standard date ranges. | Fabricated performance benchmarks, industry comparison percentiles, revenue prediction AI, guaranteed financial growth outcomes. |
| **Inventory & Stock Management** | *None found in codebase* | **Unverified / Absent** | **HELD — Not Available** | **Do not publish or claim.** | Any claims of low-stock alerts, consumable tracking, batch numbers, supplier reordering, or expiry date tracking. |
| **Cloud Browser Delivery** | Web deployment via Vercel / Render / Supabase | **Verified** | All plans | Access through modern desktop, laptop, or tablet web browsers without installing or maintaining a local application server. | Native iOS/Android compiled apps, offline offline-first synchronization, local on-premise server deployment. |
| **3-Month Free Trial** | `backend/routes/billing.js` (`/start-trial`) | **Verified** | New clinic signups | 3 calendar months of card-free access with no payment details required upfront and no automatic billing upon expiration. | "Free forever" or permanent zero-cost plan; unlimited credit allocations beyond assigned trial tiers. |

---

## 2. Unresolved Commercial & Legal Discrepancies

1. **AI Credits & Staff Seat Limits:**
   - Public pricing table displays: Starter = 300 credits / 2 staff; Growth = 1,000 credits / 5 staff; Premium = 2,000 credits / unlimited staff.
   - Recent owner context mentions: Starter = 200 credits / 7 staff; Growth = 450 credits / 15 staff; Premium = 900 credits / 50 staff.
   - *Resolution rule:* Keep working pricing table and backend code intact; acknowledge seat limits accurately per plan tier without inventing third values.
2. **Trial Plan Inclusions:**
   - Implementation (`billing.js` line 898) sets trial plan to `premium` (`PLAN_CREDITS['premium']`).
   - Owner context notes trial is Growth-equivalent.
   - *Resolution rule:* Describe trial as providing full platform capabilities for evaluation without claiming perpetual tier equivalence.
3. **Legal Document Placeholders:**
   - `privacy-policy.html`, `terms-of-service.html`, and `refund-cancellation.html` contain template tokens: `{{LEGAL_BUSINESS_NAME}}`, `{{CONTACT_LOCATION}}`, `{{PRIVACY_EMAIL}}`, `{{GRIEVANCE_EMAIL}}`, `{{SUPPORT_EMAIL}}`, `{{EFFECTIVE_DATE}}`, `{{DATA_SUBPROCESSORS}}`, `{{PAYMENT_PROVIDER_DETAILS}}`, `{{GOVERNING_LAW}}`.
   - *Resolution rule:* Do not invent company names or registered addresses. Flag as owner-input required.

