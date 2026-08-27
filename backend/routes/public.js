const express  = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const supabase = require('../lib/supabase');
const { sendMail } = require('../lib/mailer');

const router = express.Router();

// ── Rate limiters for unauthenticated public endpoints ────────────────────────
// OTP: max 5 requests per 10 min per IP — prevent OTP spam abuse
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please wait 10 minutes before trying again.' }
});

// Booking: max 10 per 15 min per IP
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many booking requests from your IP. Please try again later.' }
});

// Availability: max 60 per 15 min per IP
const availabilityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// ── GET /api/public/marketplace/meta ─────────────────────────────────────────
// Returns list of distinct cities, areas, specialties, and price ranges
router.get('/marketplace/meta', async (req, res, next) => {
  try {
    const { data: clinics, error } = await supabase
      .from('clinics')
      .select('city, area, specialties, services_offered')
      .eq('is_active', true);

    if (error) throw error;

    const citiesSet = new Set();
    const areasByCity = {};
    const specialtiesSet = new Set();
    const serviceCategoriesSet = new Set();

    (clinics || []).forEach(c => {
      if (c.city) {
        citiesSet.add(c.city);
        if (!areasByCity[c.city]) areasByCity[c.city] = new Set();
        if (c.area) areasByCity[c.city].add(c.area);
      }
      if (Array.isArray(c.specialties)) {
        c.specialties.forEach(s => specialtiesSet.add(s));
      }
      if (Array.isArray(c.services_offered)) {
        c.services_offered.forEach(srv => {
          if (srv.category) serviceCategoriesSet.add(srv.category);
          if (srv.name) specialtiesSet.add(srv.name);
        });
      }
    });

    const formattedAreas = {};
    Object.keys(areasByCity).forEach(k => {
      formattedAreas[k] = Array.from(areasByCity[k]);
    });

    res.json({
      cities: Array.from(citiesSet),
      areas_by_city: formattedAreas,
      specialties: Array.from(specialtiesSet),
      categories: Array.from(serviceCategoriesSet),
      total_clinics: (clinics || []).length
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/public/clinics ───────────────────────────────────────────────────
// Marketplace listing with search, multi-faceted filtering, and sorting
router.get('/clinics', [
  query('q').optional().trim(),
  query('city').optional().trim(),
  query('area').optional().trim(),
  query('service').optional().trim(),
  query('specialty').optional().trim(),
  query('min_rating').optional().isFloat({ min: 0, max: 5 }),
  query('price_range').optional().trim(),
  query('featured').optional().isBoolean(),
  query('sort').optional().trim(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const {
      q,
      city,
      area,
      service,
      specialty,
      min_rating,
      price_range,
      featured,
      sort = 'featured',
      page = 1,
      limit = 20
    } = req.query;

    let queryBuilder = supabase
      .from('clinics')
      .select('*', { count: 'exact' })
      .eq('is_active', true);

    if (city && city !== 'all') {
      queryBuilder = queryBuilder.ilike('city', `%${city}%`);
    }

    if (area && area !== 'all') {
      queryBuilder = queryBuilder.ilike('area', `%${area}%`);
    }

    if (min_rating) {
      queryBuilder = queryBuilder.gte('rating', Number(min_rating));
    }

    if (price_range && price_range !== 'all') {
      queryBuilder = queryBuilder.eq('price_range', price_range);
    }

    if (featured === 'true' || featured === true) {
      queryBuilder = queryBuilder.eq('is_featured', true);
    }

    if (q) {
      queryBuilder = queryBuilder.or(
        `name.ilike.%${q}%,owner_name.ilike.%${q}%,city.ilike.%${q}%,area.ilike.%${q}%,about.ilike.%${q}%`
      );
    }

    // Apply sorting
    if (sort === 'rating') {
      queryBuilder = queryBuilder.order('rating', { ascending: false });
    } else if (sort === 'reviews') {
      queryBuilder = queryBuilder.order('review_count', { ascending: false });
    } else if (sort === 'experience') {
      queryBuilder = queryBuilder.order('experience_years', { ascending: false });
    } else {
      // Default: featured first, then highest rating
      queryBuilder = queryBuilder.order('is_featured', { ascending: false }).order('rating', { ascending: false });
    }

    const offset = (Number(page) - 1) * Number(limit);
    queryBuilder = queryBuilder.range(offset, offset + Number(limit) - 1);

    let { data: clinics, error, count } = await queryBuilder;
    if (error) throw error;

    clinics = clinics || [];

    // Filter in-memory for JSON array fields if service / specialty is supplied
    if (service && service !== 'all') {
      const sLower = service.toLowerCase();
      clinics = clinics.filter(c => {
        const hasService = Array.isArray(c.services_offered) && c.services_offered.some(srv =>
          (srv.name && srv.name.toLowerCase().includes(sLower)) ||
          (srv.category && srv.category.toLowerCase().includes(sLower))
        );
        const hasSpec = Array.isArray(c.specialties) && c.specialties.some(sp =>
          sp.toLowerCase().includes(sLower)
        );
        return hasService || hasSpec;
      });
    }

    if (specialty && specialty !== 'all') {
      const spLower = specialty.toLowerCase();
      clinics = clinics.filter(c =>
        Array.isArray(c.specialties) && c.specialties.some(sp => sp.toLowerCase().includes(spLower))
      );
    }

    // Format clinic cards with next available slot hint and starting price
    const enriched = clinics.map(c => {
      const services = Array.isArray(c.services_offered) ? c.services_offered : [];
      const minPrice = services.length > 0
        ? Math.min(...services.filter(s => s.price).map(s => Number(s.price)))
        : null;

      return {
        id: c.id,
        name: c.name,
        owner_name: c.owner_name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        city: c.city || 'Delhi NCR',
        area: c.area || 'Central',
        pincode: c.pincode,
        rating: Number(c.rating || 4.8),
        review_count: Number(c.review_count || 0),
        booking_slug: c.booking_slug,
        about: c.about,
        cover_image: c.cover_image || 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=800&q=80',
        images: c.images || [],
        specialties: c.specialties || [],
        services_offered: services,
        min_price: minPrice,
        timings: c.timings || 'Mon - Sat: 09:00 AM - 08:00 PM',
        experience_years: c.experience_years || 8,
        price_range: c.price_range || '₹₹',
        is_verified: c.is_verified !== false,
        is_featured: c.is_featured === true,
        amenities: c.amenities || []
      };
    });

    res.json({
      clinics: enriched,
      total: count || enriched.length,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/public/clinics/:slugOrId (and legacy /clinic/:slug) ───────────────
// Detailed clinic profile for public view and booking page
async function handleSingleClinic(req, res, next) {
  try {
    const paramVal = req.params.slug || req.params.id;
    if (!paramVal) return res.status(400).json({ error: 'Clinic slug or ID required' });

    let query = supabase.from('clinics').select('*');
    
    // Check if UUID or slug
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paramVal);
    if (isUUID) {
      query = query.eq('id', paramVal);
    } else {
      query = query.eq('booking_slug', paramVal);
    }

    const { data: clinic, error } = await query.single();

    if (error || !clinic) {
      return res.status(404).json({ error: 'Clinic not found or invalid booking link.' });
    }

    // Fetch doctors/staff associated with this clinic
    const { data: staff } = await supabase
      .from('staff')
      .select('id, name, role, specialization, joining_date')
      .eq('clinic_id', clinic.id)
      .eq('is_active', true);

    res.json({
      clinic: {
        ...clinic,
        staff: staff || []
      }
    });
  } catch (err) {
    next(err);
  }
}

router.get('/clinics/:slug', handleSingleClinic);
router.get('/clinic/:slug', handleSingleClinic);

// ── POST /api/public/send-otp ─────────────────────────────────────────────────
router.post('/send-otp', otpLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { email } = req.body;

    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) throw error;

    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/public/verify-otp ───────────────────────────────────────────────
router.post('/verify-otp', otpLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('otp').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be a 6-digit code')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { email, otp } = req.body;

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'email'
    });

    if (error) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    res.json({ message: 'Email verified successfully', session: data.session });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/public/availability ─────────────────────────────────────────────
// Returns booked time slots and remaining capacity for a clinic on a given date.
// Query params: clinic_id, date
router.get('/availability', availabilityLimiter, [
  query('clinic_id').notEmpty().isUUID().withMessage('Valid clinic_id is required'),
  query('date').notEmpty().isISO8601().withMessage('Valid date is required')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { clinic_id, date } = req.query;

    const { data: clinic } = await supabase
      .from('clinics')
      .select('appointment_settings')
      .eq('id', clinic_id)
      .single();

    const maxPerDay = clinic?.appointment_settings?.max_bookings_per_day || 20;

    const { data: appts, error } = await supabase
      .from('appointments')
      .select('time')
      .eq('clinic_id', clinic_id)
      .eq('date', date)
      .neq('status', 'cancelled');

    if (error) throw error;

    // Normalise times to HH:MM (strip seconds if present)
    const bookedTimes = (appts || []).map(a => String(a.time).slice(0, 5));
    const totalBooked = bookedTimes.length;
    const isDayFull = totalBooked >= maxPerDay;

    res.json({ booked_times: bookedTimes, total_booked: totalBooked, max_per_day: maxPerDay, is_day_full: isDayFull });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/public/book ─────────────────────────────────────────────────────
router.post('/book', bookingLimiter, [
  body('clinic_id').notEmpty().isUUID().withMessage('Valid clinic_id is required'),
  body('patient_name').trim().notEmpty().isLength({ max: 120 }).withMessage('Patient name is required'),
  body('patient_phone').trim().notEmpty().isLength({ max: 20 }).withMessage('Phone number is required'),
  body('patient_email').optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage('Invalid email'),
  body('date').notEmpty().isISO8601().withMessage('Valid date is required'),
  body('time').notEmpty().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time (HH:MM) is required'),
  body('service').trim().notEmpty().isLength({ max: 120 }).withMessage('Service is required'),
  body('reason').optional().trim().isLength({ max: 500 })
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { clinic_id, patient_name, patient_phone, patient_email, date, time, service, reason } = req.body;

    // ── Guard 1: One booking per email per day ────────────────────────────────
    // Done FIRST, before any patient creation, using case-insensitive email match
    if (patient_email) {
      const { data: emailPatients } = await supabase
        .from('patients')
        .select('id')
        .eq('clinic_id', clinic_id)
        .ilike('email', patient_email.trim());

      if (emailPatients && emailPatients.length > 0) {
        const pIds = emailPatients.map(p => p.id);
        const { data: emailDayAppts } = await supabase
          .from('appointments')
          .select('id')
          .eq('clinic_id', clinic_id)
          .eq('date', date)
          .in('patient_id', pIds)
          .neq('status', 'cancelled');

        console.log(`[BOOK] Guard1 — patients with email: ${pIds.length}, appts today: ${(emailDayAppts||[]).length}`);

        if ((emailDayAppts || []).length > 0) {
          return res.status(409).json({ error: 'You already have an appointment booked on this date. Only one appointment per day is allowed.' });
        }
      } else {
        console.log(`[BOOK] Guard1 — no existing patient found with email: ${patient_email}`);
      }
    }

    // ── Guard 2: Clinic daily cap & settings ──────────────────────────────────
    const { data: clinic } = await supabase
      .from('clinics')
      .select('appointment_settings, name, email, phone')
      .eq('id', clinic_id)
      .single();

    const maxPerDay = clinic?.appointment_settings?.max_bookings_per_day || 20;
    const autoApprove = clinic?.appointment_settings?.auto_approve === true;
    const initialStatus = autoApprove ? 'scheduled' : 'pending';

    const { data: dayAppts } = await supabase
      .from('appointments')
      .select('id')
      .eq('clinic_id', clinic_id)
      .eq('date', date)
      .neq('status', 'cancelled');

    console.log(`[BOOK] Guard2 — day total: ${(dayAppts||[]).length}/${maxPerDay}, autoApprove: ${autoApprove}`);

    if ((dayAppts || []).length >= maxPerDay) {
      return res.status(409).json({ error: `Sorry, this day is fully booked (max ${maxPerDay} appointments). Please choose another date.` });
    }

    // ── Guard 3: Time slot collision ──────────────────────────────────────────
    // Fetch all times for this date and use startsWith to handle HH:MM vs HH:MM:SS
    const { data: allTodayAppts } = await supabase
      .from('appointments')
      .select('time')
      .eq('clinic_id', clinic_id)
      .eq('date', date)
      .neq('status', 'cancelled');

    const slotTaken = (allTodayAppts || []).some(a => String(a.time).startsWith(time));
    console.log(`[BOOK] Guard3 — slot ${time} taken: ${slotTaken}, stored times: ${JSON.stringify((allTodayAppts||[]).map(a=>a.time))}`);

    if (slotTaken) {
      return res.status(409).json({ error: 'This time slot has already been booked. Please choose another time.' });
    }

    // ── Find or create patient ────────────────────────────────────────────────
    let patientId;
    const { data: existingPatient } = await supabase
      .from('patients')
      .select('id, email')
      .eq('clinic_id', clinic_id)
      .eq('phone', patient_phone)
      .maybeSingle();

    if (existingPatient) {
      patientId = existingPatient.id;
      if (patient_email && existingPatient.email?.toLowerCase() !== patient_email.toLowerCase()) {
        await supabase.from('patients').update({ email: patient_email }).eq('id', patientId);
      }
    } else {
      const { data: newPatient, error: patientErr } = await supabase
        .from('patients')
        .insert({ clinic_id, name: patient_name, phone: patient_phone, email: patient_email })
        .select('id')
        .single();
      if (patientErr) throw patientErr;
      patientId = newPatient.id;
    }

    console.log(`[BOOK] All guards passed — creating appointment (status=${initialStatus}) for patientId=${patientId}`);

    // ── Create appointment ────────────────────────────────────────────────────
    const { data: appointment, error: apptErr } = await supabase
      .from('appointments')
      .insert({ clinic_id, patient_id: patientId, date, time, service, reason, status: initialStatus })
      .select()
      .single();

    if (apptErr) throw apptErr;

    // ── Format time for emails ────────────────────────────────────────────────
    const clinicName = clinic?.name || 'Smart Dental Desk';
    const [hourStr, minStr] = time.split(':');
    let hour = parseInt(hourStr, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    const formattedTime = `${hour}:${minStr} ${ampm}`;

    // ── Send patient email ───────────────────────────────────────────────────
    if (patient_email) {
      if (autoApprove) {
        // Auto-approved email
        const htmlBody = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
            <h2 style="color: #2563eb;">Appointment Confirmed</h2>
            <p>Hello ${patient_name},</p>
            <p>Your appointment for <strong>${service}</strong> has been successfully scheduled.</p>
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
              <p style="margin: 0 0 10px 0;"><strong>Date:</strong> ${date}</p>
              <p style="margin: 0 0 10px 0;"><strong>Time:</strong> ${formattedTime}</p>
              <p style="margin: 0;"><strong>Status:</strong> <span style="color: #16a34a; font-weight: bold;">Confirmed</span></p>
            </div>
            <p>We look forward to seeing you!</p>
            <p>Best regards,<br><strong>${clinicName}</strong></p>
          </div>
        `;
        try {
          await sendMail({
            to: patient_email,
            subject: `Appointment Confirmed - ${clinicName}`,
            text: `Hello ${patient_name},\n\nYour ${service} appointment is confirmed for ${date} at ${formattedTime}.\n\nThank you,\n${clinicName}`,
            html: htmlBody
          });
        } catch (mailErr) {
          console.error('[BOOK] Failed to send confirmation email:', mailErr);
        }
      } else {
        // Manual review pending email
        const htmlBody = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
            <h2 style="color: #d97706;">Appointment Request Received</h2>
            <p>Hello ${patient_name},</p>
            <p>Thank you for booking with <strong>${clinicName}</strong>. We have received your appointment request for <strong>${service}</strong>.</p>
            <div style="background: #fffbeb; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #fef3c7;">
              <p style="margin: 0 0 10px 0;"><strong>Date:</strong> ${date}</p>
              <p style="margin: 0 0 10px 0;"><strong>Time:</strong> ${formattedTime}</p>
              <p style="margin: 0;"><strong>Status:</strong> <span style="color: #d97706; font-weight: bold;">Pending Clinic Approval</span></p>
            </div>
            <p>Our clinic team is reviewing your requested slot. You will receive a confirmation email as soon as your appointment is approved.</p>
            <p>Best regards,<br><strong>${clinicName}</strong></p>
          </div>
        `;
        try {
          await sendMail({
            to: patient_email,
            subject: `Appointment Request Received (Pending Approval) - ${clinicName}`,
            text: `Hello ${patient_name},\n\nWe have received your ${service} appointment request for ${date} at ${formattedTime}. It is currently pending approval by the clinic. You will receive an email once approved.\n\nThank you,\n${clinicName}`,
            html: htmlBody
          });
        } catch (mailErr) {
          console.error('[BOOK] Failed to send pending email:', mailErr);
        }
      }
    }

    // ── Notify clinic admin about new pending booking request ────────────────
    if (!autoApprove && clinic?.email) {
      const adminHtmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
          <h2 style="color: #2563eb;">🔔 New Appointment Request Awaiting Approval</h2>
          <p>Hello <strong>${clinicName}</strong>,</p>
          <p>A new appointment request has been submitted online and requires your approval:</p>
          <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
            <p style="margin: 0 0 8px 0;"><strong>Patient:</strong> ${patient_name}</p>
            <p style="margin: 0 0 8px 0;"><strong>Phone:</strong> ${patient_phone}</p>
            <p style="margin: 0 0 8px 0;"><strong>Email:</strong> ${patient_email || 'Not provided'}</p>
            <p style="margin: 0 0 8px 0;"><strong>Service:</strong> ${service}</p>
            <p style="margin: 0 0 8px 0;"><strong>Date:</strong> ${date}</p>
            <p style="margin: 0 0 8px 0;"><strong>Time:</strong> ${formattedTime}</p>
            ${reason ? `<p style="margin: 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
          </div>
          <p>Please log in to your <strong>Smart Dental Desk</strong> dashboard to approve or decline this appointment.</p>
        </div>
      `;
      try {
        await sendMail({
          to: clinic.email,
          subject: `🔔 New Appointment Request: ${patient_name} (${date} at ${formattedTime})`,
          text: `New appointment request from ${patient_name} for ${service} on ${date} at ${formattedTime}. Phone: ${patient_phone}. Please log in to your dashboard to review and approve.`,
          html: adminHtmlBody
        });
      } catch (adminMailErr) {
        console.error('[BOOK] Failed to send admin notification email:', adminMailErr);
      }
    }

    res.status(201).json({
      message: autoApprove
        ? 'Appointment booked and confirmed successfully!'
        : 'Appointment request submitted! Awaiting clinic approval.',
      appointment,
      auto_approved: autoApprove
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
