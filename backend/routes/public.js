const express  = require('express');
const supabase = require('../lib/supabase');
const { sendMail } = require('../lib/mailer');

const router = express.Router();

// ── GET /api/public/clinic/:slug ──────────────────────────────────────────────
router.get('/clinic/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const { data, error } = await supabase
      .from('clinics')
      .select('id, name, address, phone, appointment_settings')
      .eq('booking_slug', slug)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Clinic not found or invalid booking link.' });
    }

    res.json({ clinic: data });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/public/send-otp ─────────────────────────────────────────────────
router.post('/send-otp', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) throw error;

    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/public/verify-otp ───────────────────────────────────────────────
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

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
router.get('/availability', async (req, res, next) => {
  try {
    const { clinic_id, date } = req.query;
    if (!clinic_id || !date) {
      return res.status(400).json({ error: 'clinic_id and date are required' });
    }

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
router.post('/book', async (req, res, next) => {
  try {
    const { clinic_id, patient_name, patient_phone, patient_email, date, time, service, reason } = req.body;

    console.log(`[BOOK] clinic=${clinic_id} email=${patient_email} phone=${patient_phone} date=${date} time=${time}`);

    if (!clinic_id || !patient_name || !patient_phone || !date || !time || !service) {
      return res.status(400).json({ error: 'Missing required booking fields' });
    }

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

    // ── Guard 2: Clinic daily cap ─────────────────────────────────────────────
    const { data: clinic } = await supabase
      .from('clinics')
      .select('appointment_settings, name')
      .eq('id', clinic_id)
      .single();

    const maxPerDay = clinic?.appointment_settings?.max_bookings_per_day || 20;

    const { data: dayAppts } = await supabase
      .from('appointments')
      .select('id')
      .eq('clinic_id', clinic_id)
      .eq('date', date)
      .neq('status', 'cancelled');

    console.log(`[BOOK] Guard2 — day total: ${(dayAppts||[]).length}/${maxPerDay}`);

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

    console.log(`[BOOK] All guards passed — creating appointment for patientId=${patientId}`);

    // ── Create appointment ────────────────────────────────────────────────────
    const { data: appointment, error: apptErr } = await supabase
      .from('appointments')
      .insert({ clinic_id, patient_id: patientId, date, time, service, reason, status: 'scheduled' })
      .select()
      .single();

    if (apptErr) throw apptErr;

    // ── Send confirmation email ───────────────────────────────────────────────
    if (patient_email) {
      const clinicName = clinic?.name || 'Smart Dental Desk';
      const [hourStr, minStr] = time.split(':');
      let hour = parseInt(hourStr, 10);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      hour = hour % 12 || 12;
      const formattedTime = `${hour}:${minStr} ${ampm}`;

      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
          <h2 style="color: #2563eb;">Appointment Confirmed</h2>
          <p>Hello ${patient_name},</p>
          <p>Your appointment for <strong>${service}</strong> has been successfully scheduled.</p>
          <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Date:</strong> ${date}</p>
            <p style="margin: 0;"><strong>Time:</strong> ${formattedTime}</p>
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
    }

    res.status(201).json({ message: 'Appointment booked successfully!', appointment });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
