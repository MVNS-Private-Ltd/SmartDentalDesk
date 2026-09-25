/**
 * reminders.js - Appointment reminder cron job
 * Fetches appointments scheduled 24 hours from now and sends email reminders.
 * Logs each attempt to campaign_logs.
 * 
 * Usage: called by the existing cron route or a node-cron scheduler.
 */
const supabase = require('../lib/supabase'); // Service role to read across clinics
const { sendMail } = require('../lib/mailer');

async function sendAppointmentReminders() {
  console.log('[Reminders Cron] Running appointment reminder job...');

  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000); // 23h from now
  const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000); // 25h from now

  // Fetch appointments in the 24h window that haven't been reminded yet
  const { data: appointments, error } = await supabase
    .from('appointments')
    .select(`
      id,
      appointment_date,
      appointment_time,
      clinic_id,
      notes,
      patients (id, name, email, phone),
      clinics  (name, email, phone)
    `)
    .gte('appointment_date', windowStart.toISOString().split('T')[0])
    .lte('appointment_date', windowEnd.toISOString().split('T')[0])
    .eq('status', 'scheduled')
    .not('id', 'in', `(SELECT appointment_id FROM campaign_logs WHERE campaign_id IS NULL AND status = 'sent' AND sent_at > now() - interval '25 hours')`);

  if (error) {
    console.error('[Reminders Cron] Error fetching appointments:', error.message);
    return;
  }

  if (!appointments || appointments.length === 0) {
    console.log('[Reminders Cron] No appointments to remind.');
    return;
  }

  console.log(`[Reminders Cron] Sending ${appointments.length} reminders...`);

  for (const appt of appointments) {
    const patient = appt.patients;
    const clinic  = appt.clinics;
    if (!patient?.email) {
      console.log(`[Reminders Cron] Skipping appointment ${appt.id} - no patient email.`);
      continue;
    }

    let logStatus = 'failed';
    try {
      await sendMail({
        to: patient.email,
        subject: `Appointment Reminder — ${clinic?.name || 'Your Clinic'}`,
        html: `
          <p>Dear ${patient.name},</p>
          <p>This is a reminder that you have an appointment at <strong>${clinic?.name}</strong> 
          on <strong>${appt.appointment_date}</strong> at <strong>${appt.appointment_time}</strong>.</p>
          <p>If you need to reschedule, please contact us at ${clinic?.phone || clinic?.email || 'the clinic'}.</p>
          <p>Thank you,<br/>${clinic?.name || 'Smart Dental Desk'}</p>
        `
      });
      logStatus = 'sent';
      console.log(`[Reminders Cron] ✅ Sent reminder to ${patient.email} for appointment ${appt.id}`);
    } catch (mailErr) {
      console.error(`[Reminders Cron] ❌ Failed to send to ${patient.email}:`, mailErr.message);
    }

    // Log to campaign_logs (appointment_id stored in message_id)
    await supabase.from('campaign_logs').insert({
      clinic_id: appt.clinic_id,
      campaign_id: null, // System automated, not tied to a specific campaign
      patient_id: patient.id,
      lead_id: null,
      channel: 'email',
      status: logStatus,
      message_id: appt.id // Reference to the appointment
    });
  }

  console.log('[Reminders Cron] Job complete.');
}

module.exports = { sendAppointmentReminders };
