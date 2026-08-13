// ─────────────────────────────────────────────────────────────────────────────
//  Invoices Routes
//  GET   /api/invoices       — All invoices (filter by status, patient)
//  GET   /api/invoices/:id   — Single invoice
//  POST  /api/invoices       — Create invoice
//  PATCH /api/invoices/:id/pay — Mark as paid
//  PUT   /api/invoices/:id   — Update invoice
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const { body, validationResult } = require('express-validator');
const supabase    = require('../lib/supabase');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg }); return false; }
  return true;
}

// ── GET /api/invoices ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { status, patient_id, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let q = supabase
      .from('invoices')
      .select(`
        id, invoice_number, amount, tax_amount, total_amount, status, payment_method,
        due_date, paid_at, created_at,
        patients(id, name, phone)
      `, { count: 'exact' })
      .eq('clinic_id', req.clinicId)
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (status)     q = q.eq('status', status);
    if (patient_id) q = q.eq('patient_id', patient_id);

    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ invoices: data, total: count });
  } catch (err) { next(err); }
});

// ── GET /api/invoices/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('invoices')
      .select(`*, patients(id, name, phone, email), appointments(id, date, service)`)
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Invoice not found.' });
    res.json({ invoice: data });
  } catch (err) { next(err); }
});

// ── POST /api/invoices ────────────────────────────────────────────────────────
const createRules = [
  body('patient_id').notEmpty().withMessage('Patient ID is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one line item is required'),
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number')
];

router.post('/', createRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { patient_id, appointment_id, items, amount, tax_rate = 0, due_date, notes, payment_method } = req.body;

    const tax_amount   = parseFloat((amount * (tax_rate / 100)).toFixed(2));
    const total_amount = parseFloat((amount + tax_amount).toFixed(2));

    // Generate a simple invoice number: INV-YYYYMMDD-XXXX
    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const rand    = Math.floor(1000 + Math.random() * 9000);
    const invoice_number = `INV-${dateStr}-${rand}`;

    const { data, error } = await supabase
      .from('invoices')
      .insert({
        clinic_id      : req.clinicId,
        patient_id,
        appointment_id : appointment_id || null,
        invoice_number,
        items,
        amount,
        tax_amount,
        total_amount,
        tax_rate,
        due_date       : due_date || null,
        notes          : notes   || null,
        payment_method : payment_method || null,
        status         : 'unpaid'
      })
      .select(`*, patients(id, name)`)
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'Invoice created.', invoice: data });
  } catch (err) { next(err); }
});

// ── PATCH /api/invoices/:id/pay ───────────────────────────────────────────────
router.patch('/:id/pay', [
  body('payment_method').optional().isString()
], async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('invoices')
      .update({
        status        : 'paid',
        paid_at       : new Date().toISOString(),
        payment_method: req.body.payment_method || 'cash',
        updated_at    : new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Invoice not found.' });
    res.json({ message: 'Invoice marked as paid.', invoice: data });
  } catch (err) { next(err); }
});

// ── PUT /api/invoices/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['items','amount','tax_rate','tax_amount','total_amount','due_date','notes','status'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Invoice not found.' });
    res.json({ message: 'Invoice updated.', invoice: data });
  } catch (err) { next(err); }
});

module.exports = router;
