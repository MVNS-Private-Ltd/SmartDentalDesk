const express  = require('express');
const supabase = require('../lib/supabase');

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

// ── POST /api/public/book ─────────────────────────────────────────────────────
router.post('/book', async (req, res, next) => {
  try {
    const { clinic_id, patient_name, patient_phone, patient_email, date, time, service, reason } = req.body;

    if (!clinic_id || !patient_name || !patient_phone || !date || !time || !service) {
      return res.status(400).json({ error: 'Missing required booking fields' });
    }

    // 1. Find or create patient (phone is unique per clinic)
    let patientId;
    const { data: existingPatient } = await supabase
      .from('patients')
      .select('id')
      .eq('clinic_id', clinic_id)
      .eq('phone', patient_phone)
      .single();

    if (existingPatient) {
      patientId = existingPatient.id;
    } else {
      const { data: newPatient, error: patientErr } = await supabase
        .from('patients')
        .insert({
          clinic_id,
          name: patient_name,
          phone: patient_phone,
          email: patient_email
        })
        .select('id')
        .single();
        
      if (patientErr) throw patientErr;
      patientId = newPatient.id;
    }

    // 2. Create the appointment
    const { data: appointment, error: apptErr } = await supabase
      .from('appointments')
      .insert({
        clinic_id,
        patient_id: patientId,
        date,
        time,
        service,
        reason,
        status: 'scheduled'
      })
      .select()
      .single();

    if (apptErr) throw apptErr;

    res.status(201).json({ message: 'Appointment booked successfully!', appointment });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
