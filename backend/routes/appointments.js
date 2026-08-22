// ─────────────────────────────────────────────────────────────────────────────
//  Appointments Routes
//  GET    /api/appointments          — List appointments (filter by date/status)
//  GET    /api/appointments/today    — Today's appointments only
//  GET    /api/appointments/:id      — Single appointment
//  POST   /api/appointments          — Create appointment
//  PUT    /api/appointments/:id      — Update appointment (reschedule, notes)
//  PATCH  /api/appointments/:id/status — Update status only
//  POST   /api/appointments/:id/approve — Approve pending appointment
//  POST   /api/appointments/:id/reject  — Reject pending appointment
//  DELETE /api/appointments/:id      — Cancel appointment
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const { body, validationResult } = require('express-validator');
const supabase    = require('../lib/supabase');
const { sendMail } = require('../lib/mailer');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// ── Email notification helper on status change ──────────────────────────────
async function sendAppointmentStatusEmail(appointmentId, clinicId, newStatus, reason = '') {
  try {
    const { data: appt } = await supabase
      .from('appointments')
      .select('id, date, time, service, patients(name, email), clinics(name)')
      .eq('id', appointmentId)
      .eq('clinic_id', clinicId)
      .single();

    if (!appt || !appt.patients?.email) return;

    const patientName = appt.patients.name;
    const patientEmail = appt.patients.email;
    const clinicName = appt.clinics?.name || 'Smart Dental Desk';
    const date = appt.date;
    const [h, m] = String(appt.time).split(':');
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const formattedTime = `${hour % 12 || 12}:${m} ${ampm}`;

    if (newStatus === 'scheduled' || newStatus === 'confirmed') {
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
          <h2 style="color: #16a34a;">✅ Appointment Approved & Confirmed!</h2>
          <p>Hello ${patientName},</p>
          <p>Great news! Your appointment request with <strong>${clinicName}</strong> has been approved and confirmed.</p>
          <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #bbf7d0;">
            <p style="margin: 0 0 8px 0;"><strong>Service:</strong> ${appt.service}</p>
            <p style="margin: 0 0 8px 0;"><strong>Date:</strong> ${date}</p>
            <p style="margin: 0 0 8px 0;"><strong>Time:</strong> ${formattedTime}</p>
            <p style="margin: 0;"><strong>Status:</strong> <span style="color: #16a34a; font-weight: bold;">Confirmed</span></p>
          </div>
          <p>We look forward to seeing you. If you need to make any changes, please contact our clinic.</p>
          <p>Best regards,<br><strong>${clinicName}</strong></p>
        </div>
      `;
      await sendMail({
        to: patientEmail,
        subject: `Appointment Approved & Confirmed - ${clinicName}`,
        text: `Hello ${patientName},\n\nYour appointment for ${appt.service} on ${date} at ${formattedTime} has been approved and confirmed by ${clinicName}.\n\nThank you!`,
        html: htmlBody
      });
    } else if (newStatus === 'cancelled') {
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
          <h2 style="color: #dc2626;">Appointment Request Update</h2>
          <p>Hello ${patientName},</p>
          <p>We are writing to let you know that your appointment request for <strong>${appt.service}</strong> on <strong>${date} at ${formattedTime}</strong> could not be approved at this time.</p>
          ${reason ? `<p><strong>Note from clinic:</strong> ${reason}</p>` : ''}
          <p>Please feel free to visit our booking page to select an alternate date or time slot, or contact us directly.</p>
          <p>Best regards,<br><strong>${clinicName}</strong></p>
        </div>
      `;
      await sendMail({
        to: patientEmail,
        subject: `Appointment Request Update - ${clinicName}`,
        text: `Hello ${patientName},\n\nYour appointment request for ${appt.service} on ${date} at ${formattedTime} could not be approved by ${clinicName}.${reason ? `\nNote: ${reason}` : ''}\n\nPlease visit our booking page to choose another slot.`,
        html: htmlBody
      });
    }
  } catch (err) {
    console.error('[APPT_EMAIL] Failed to send status update email:', err.message || err);
  }
}

// ── GET /api/appointments ─────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { date, status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let q = supabase
      .from('appointments')
      .select(`
        id, date, time, service, reason, status, notes, created_at,
        patients(id, name, phone, email, is_starred)
      `, { count: 'exact' })
      .eq('clinic_id', req.clinicId)
      .order('date', { ascending: true })
      .order('time', { ascending: true })
      .range(offset, offset + Number(limit) - 1);

    if (date) q = q.eq('date', date);

    if (status) {
      if (status === 'pending') {
        q = q.eq('status', 'pending');
      } else if (status === 'scheduled') {
        q = q.in('status', ['scheduled', 'confirmed']);
      } else if (status === 'completed') {
        q = q.eq('status', 'completed');
      } else if (status === 'cancelled') {
        q = q.eq('status', 'cancelled');
      } else if (status === 'active') {
        // Active means not completed and not cancelled
        q = q.not('status', 'in', '("completed","cancelled")');
      } else if (status !== 'all') {
        q = q.eq('status', status);
      }
    } else {
      // By default exclude cancelled appointments
      q = q.neq('status', 'cancelled');
    }

    const { data, error, count } = await q;
    if (error) throw error;

    res.json({ appointments: data, total: count, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
});

// ── GET /api/appointments/today ───────────────────────────────────────────────
router.get('/today', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id, date, time, service, reason, status, notes,
        patients(id, name, phone, email)
      `)
      .eq('clinic_id', req.clinicId)
      .eq('date', today)
      .neq('status', 'cancelled')
      .order('time', { ascending: true });

    if (error) throw error;
    res.json({ appointments: data, date: today });
  } catch (err) { next(err); }
});

// ── GET /api/appointments/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select(`*, patients(id, name, phone, email)`)
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Appointment not found.' });
    res.json({ appointment: data });
  } catch (err) { next(err); }
});

// ── POST /api/appointments ────────────────────────────────────────────────────
const createRules = [
  body('patient_id').notEmpty().withMessage('Patient ID is required'),
  body('date').isDate().withMessage('Valid date is required (YYYY-MM-DD)'),
  body('time').matches(/^\d{2}:\d{2}$/).withMessage('Valid time is required (HH:MM)'),
  body('service').trim().notEmpty().withMessage('Service type is required')
];

router.post('/', createRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { patient_id, date, time, service, reason, notes } = req.body;

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        clinic_id : req.clinicId,
        patient_id,
        date,
        time,
        service,
        reason  : reason || null,
        notes   : notes  || null,
        status  : 'scheduled'
      })
      .select(`*, patients(id, name, phone, email)`)
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'Appointment booked.', appointment: data });
  } catch (err) { next(err); }
});

// ── POST /api/appointments/:id/approve ────────────────────────────────────────
router.post('/:id/approve', async (req, res, next) => {
  try {
    const { data: existing, error: findErr } = await supabase
      .from('appointments')
      .select('id, status')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (findErr || !existing) return res.status(404).json({ error: 'Appointment not found.' });

    const { data, error } = await supabase
      .from('appointments')
      .update({ status: 'scheduled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select(`*, patients(id, name, phone, email)`)
      .single();

    if (error) throw error;

    // Send confirmation email asynchronously
    sendAppointmentStatusEmail(req.params.id, req.clinicId, 'scheduled');

    res.json({ message: 'Appointment approved and confirmed! Confirmation email sent to patient.', appointment: data });
  } catch (err) { next(err); }
});

// ── POST /api/appointments/:id/reject ─────────────────────────────────────────
router.post('/:id/reject', async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const { data: existing, error: findErr } = await supabase
      .from('appointments')
      .select('id, status')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (findErr || !existing) return res.status(404).json({ error: 'Appointment not found.' });

    const { data, error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select(`*, patients(id, name, phone, email)`)
      .single();

    if (error) throw error;

    // Send cancellation/rejection email asynchronously
    sendAppointmentStatusEmail(req.params.id, req.clinicId, 'cancelled', reason);

    res.json({ message: 'Appointment declined and patient notified.', appointment: data });
  } catch (err) { next(err); }
});

// ── PUT /api/appointments/:id ─────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['date','time','service','reason','notes','status'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('appointments')
      .update(updates)
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select(`*, patients(id, name, phone, email)`)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Appointment not found.' });
    res.json({ message: 'Appointment updated.', appointment: data });
  } catch (err) { next(err); }
});

// ── PATCH /api/appointments/:id/status ────────────────────────────────────────
router.patch('/:id/status', [
  body('status').isIn(['pending','scheduled','confirmed','in-progress','completed','cancelled','no-show'])
    .withMessage('Invalid status value')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const { status: newStatus, reason } = req.body;

    const { data: currentAppt } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    const prevStatus = currentAppt?.status;

    const { data, error } = await supabase
      .from('appointments')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select(`*, patients(id, name, phone, email)`)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Appointment not found.' });

    // If status transitioned from pending to scheduled, or to cancelled, send email
    if ((prevStatus === 'pending' && (newStatus === 'scheduled' || newStatus === 'confirmed')) || newStatus === 'cancelled') {
      sendAppointmentStatusEmail(req.params.id, req.clinicId, newStatus, reason);
    }

    res.json({ message: `Status updated to ${newStatus}.`, appointment: data });
  } catch (err) { next(err); }
});

// ── POST /api/appointments/:id/checkout ───────────────────────────────────────
router.post('/:id/checkout', async (req, res, next) => {
  try {
    const {
      notes,
      prescription,
      amount = 0,
      payment_method = 'cash',
      payment_status = 'paid'
    } = req.body || {};

    const numericAmount = parseFloat(amount) || 0;

    // 1. Fetch appointment & patient
    const { data: appt, error: findErr } = await supabase
      .from('appointments')
      .select('*, patients(id, name, phone, email, is_starred)')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (findErr || !appt) return res.status(404).json({ error: 'Appointment not found.' });

    // 2. Mark appointment as completed & update notes
    const combinedNotes = notes ? (appt.notes ? `${appt.notes}\n[Checkout Notes]: ${notes}` : notes) : appt.notes;
    const { data: updatedAppt, error: apptErr } = await supabase
      .from('appointments')
      .update({
        status: 'completed',
        notes: combinedNotes,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select(`*, patients(id, name, phone, email, is_starred)`)
      .single();

    if (apptErr) throw apptErr;

    // 3. Insert treatment record
    let treatmentRecord = null;
    if (notes || prescription || numericAmount > 0) {
      const { data: tr, error: trErr } = await supabase
        .from('treatment_records')
        .insert({
          clinic_id: req.clinicId,
          patient_id: appt.patient_id,
          appointment_id: appt.id,
          procedure: appt.service || 'Dental Treatment',
          notes: notes || null,
          prescription: prescription || null,
          cost: numericAmount
        })
        .select()
        .single();
      if (!trErr) treatmentRecord = tr;
    }

    // 4. Generate invoice
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    const invoice_number = `INV-${dateStr}-${rand}`;

    const isPaid = payment_status === 'paid';
    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .insert({
        clinic_id: req.clinicId,
        patient_id: appt.patient_id,
        appointment_id: appt.id,
        invoice_number,
        items: [{
          description: appt.service || 'Dental Consultation & Procedure',
          quantity: 1,
          unit_price: numericAmount,
          total: numericAmount
        }],
        amount: numericAmount,
        total_amount: numericAmount,
        tax_rate: 0,
        tax_amount: 0,
        status: isPaid ? 'paid' : 'unpaid',
        payment_method: isPaid ? payment_method : null,
        paid_at: isPaid ? new Date().toISOString() : null,
        notes: notes || null
      })
      .select()
      .single();

    if (invErr) console.error('[CHECKOUT_INVOICE] Error creating invoice:', invErr.message);

    // 5. Fetch clinic details for the receipt
    const { data: clinic } = await supabase
      .from('clinics')
      .select('name, email, phone, address')
      .eq('id', req.clinicId)
      .single();

    res.json({
      message: 'Visit completed and receipt generated.',
      appointment: updatedAppt,
      treatment: treatmentRecord,
      invoice: invoice || {
        invoice_number,
        amount: numericAmount,
        total_amount: numericAmount,
        status: isPaid ? 'paid' : 'unpaid',
        payment_method: isPaid ? payment_method : null,
        created_at: new Date().toISOString()
      },
      clinic: clinic || { name: 'Smart Dental Clinic' }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
