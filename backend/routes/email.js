// ─────────────────────────────────────────────────────────────────────────────
//  Email Routes — routes/email.js
//
//  POST /api/email/send-patient
//    Sends a staff-reviewed, AI-drafted email to a patient.
//    Requires: reviewed=true, authenticated clinic staff.
//    Rate-limited. Input validated and sanitized.
//    Never logs patient clinical data or full email content.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const express      = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit    = require('express-rate-limit');
const supabase     = require('../lib/supabase');
const { sendMail } = require('../lib/mailer');
const { isSafeToSend, safeLogEvent } = require('../lib/emailGate');
const requireAuth  = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── Per-clinic email rate limiter (5 emails per 10 minutes per IP) ────────────
const emailSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `email:${req.clinicId || req.ip}`,
  message: { error: 'Too many email sends. Please wait before sending again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Validation helper ─────────────────────────────────────────────────────────
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMsg = errors.array()[0].msg;
    
    // Log AI review bypass attempt
    if (errorMsg.includes('AI output must be reviewed')) {
      const { logAuditEvent, trackAndHalt } = require('../lib/auditLogger');
      logAuditEvent('ai.review_bypass_attempt', { clinicId: req.clinicId, ip: req.ip });
      if (trackAndHalt('ai_bypass', req.clinicId, 3, 60 * 60 * 1000)) {
        return res.status(403).json({ error: 'Repeated review bypass attempts detected. AI features disabled temporarily.' });
      }
    }

    res.status(400).json({ error: errorMsg });
    return false;
  }
  return true;
}

// ── POST /api/email/send-patient ──────────────────────────────────────────────
router.post('/send-patient',
  emailSendLimiter,
  [
    body('patient_name')
      .trim()
      .notEmpty().withMessage('patient_name is required')
      .isLength({ max: 200 }).withMessage('patient_name too long'),

    body('subject')
      .trim()
      .notEmpty().withMessage('subject is required')
      .isLength({ max: 200 }).withMessage('subject must be under 200 characters')
      // Block newline injection in subjects
      .not().matches(/[\r\n]/).withMessage('subject must not contain newlines'),

    body('body')
      .trim()
      .notEmpty().withMessage('body (email body text) is required')
      .isLength({ max: 50000 }).withMessage('body must be under 50,000 characters'),

    body('reviewed')
      .isBoolean()
      .custom(val => val === true)
      .withMessage('AI output must be reviewed and approved by a qualified dental professional before sending'),
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      // ── Email gate check ─────────────────────────────────────────────────
      if (!isSafeToSend()) {
        return res.status(503).json({
          error: 'Email sending is not configured for this environment. Contact your administrator.',
          code: 'EMAIL_NOT_CONFIGURED',
        });
      }

      const { patient_name, subject, body: emailBody, patient_email } = req.body;
      const clinicId = req.clinicId;

      // ── Resolve recipient email ──────────────────────────────────────────
      let recipientEmail = null;

      if (patient_email) {
        // Validate caller-supplied email format
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(patient_email)) {
          return res.status(400).json({ error: 'Provided patient_email is not a valid email address.' });
        }
        // Enforce tenant scope — caller cannot supply an arbitrary email bypass;
        // if patient_email is provided, still verify this patient belongs to this clinic
        const { data: verifyPatient, error: verifyErr } = await supabase
          .from('patients')
          .select('id, email')
          .eq('clinic_id', clinicId)
          .eq('email', patient_email)
          .eq('is_deleted', false)
          .maybeSingle();

        if (verifyErr) throw verifyErr;

        if (!verifyPatient) {
          // Not found in this clinic — deny. Do not reveal whether email exists elsewhere.
          return res.status(404).json({
            error: 'No patient with that email address found in your clinic.',
            code: 'PATIENT_NOT_FOUND',
          });
        }
        recipientEmail = verifyPatient.email;
      }

      if (!recipientEmail) {
        // Fuzzy search by name within this clinic (scoped by clinic_id)
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
            error: `No patient matching that name was found in your clinic.`,
            code: 'PATIENT_NOT_FOUND',
          });
        }

        const withEmail = patients.find(p => p.email);
        if (!withEmail) {
          return res.status(422).json({
            error: 'The matched patient has no email address on file. Please update their profile first.',
            code: 'NO_EMAIL_ON_FILE',
          });
        }
        recipientEmail = withEmail.email;
      }

      // ── Send ──────────────────────────────────────────────────────────────
      const info = await sendMail({
        to:         recipientEmail,
        subject,
        text:       emailBody,
        templateId: 'patient-communication',
        clinicId,
      });

      // Safe response — never return full recipient email in prod logs
      safeLogEvent({
        event: 'email.send-patient',
        recipientEmail,
        templateId: 'patient-communication',
        clinicId,
        status: 'sent',
        messageId: info.messageId,
      });

      res.json({
        success:    true,
        message_id: info.messageId,
      });

    } catch (err) {
      if (err.isConfigError) {
        return res.status(503).json({ error: err.message, code: err.code });
      }
      next(err);
    }
  }
);

module.exports = router;
