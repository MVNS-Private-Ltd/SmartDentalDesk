// ─────────────────────────────────────────────────────────────────────────────
//  Email Routes — AI-triggered patient email sending
//
//  POST /api/email/send-patient
//    Body: { patient_name, subject, body, patient_email? }
//    1. Looks up patient email from Supabase by name + clinic_id
//    2. Sends real email via Nodemailer (Gmail SMTP)
//    3. Returns { success, sent_to }
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const { body, validationResult } = require('express-validator');
const supabase    = require('../lib/supabase');
const { sendMail } = require('../lib/mailer');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── Validation helper ─────────────────────────────────────────────────────────
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// ── POST /api/email/send-patient ──────────────────────────────────────────────
router.post('/send-patient', [
  body('patient_name').trim().notEmpty().withMessage('patient_name is required'),
  body('subject').trim().notEmpty().withMessage('subject is required'),
  body('body').trim().notEmpty().withMessage('body (email body text) is required'),
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const { patient_name, subject, body: emailBody, patient_email } = req.body;
    const clinicId = req.clinicId;

    // 1. Resolve patient email — use provided email or look up in Supabase
    let recipientEmail = patient_email || null;

    if (!recipientEmail) {
      // Fuzzy search by name within this clinic
      const { data: patients, error: patientErr } = await supabase
        .from('patients')
        .select('id, name, email')
        .eq('clinic_id', clinicId)
        .eq('is_deleted', false)
        .ilike('name', `%${patient_name.trim()}%`)
        .limit(5);

      if (patientErr) throw patientErr;

      if (!patients || patients.length === 0) {
        return res.status(404).json({
          error: `No patient found matching "${patient_name}" in your clinic.`,
          code:  'PATIENT_NOT_FOUND',
        });
      }

      // Pick the first patient that has an email
      const withEmail = patients.find(p => p.email);
      if (!withEmail) {
        return res.status(422).json({
          error: `Patient "${patients[0].name}" has no email address on file. Please update their profile first.`,
          code:  'NO_EMAIL_ON_FILE',
          patient_name: patients[0].name,
        });
      }

      recipientEmail = withEmail.email;
    }

    // 2. Build a clean HTML version of the body
    const htmlBody = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; color: #1a1a2e;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px 12px 0 0; padding: 24px; text-align: center;">
          <h2 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600;">🦷 Smart Dental Desk</h2>
        </div>
        <div style="background: #ffffff; border: 1px solid #e8e8e8; border-top: none; border-radius: 0 0 12px 12px; padding: 32px 24px;">
          ${emailBody.split('\n').map(line => `<p style="margin: 0 0 12px; line-height: 1.6; color: #374151;">${line || '&nbsp;'}</p>`).join('')}
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 20px;">
          This message was sent from Smart Dental Desk on behalf of your dental clinic.
        </p>
      </div>
    `;

    // 3. Send the email
    const info = await sendMail({
      to:      recipientEmail,
      subject,
      text:    emailBody,
      html:    htmlBody,
    });

    console.log(`[Email] Sent to ${recipientEmail} — Message ID: ${info.messageId}`);

    res.json({
      success:     true,
      sent_to:     recipientEmail,
      message_id:  info.messageId,
      patient_name,
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
