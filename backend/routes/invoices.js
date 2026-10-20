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
const { auditLogger } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);
router.use(auditLogger('invoice'));

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg }); return false; }
  return true;
}

// ── GET /api/invoices ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    if (!req.clinicId) {
      return res.json({ invoices: [], total: 0 });
    }
    const { status, patient_id, search, from, to, page = 1, limit = 20, export_all } = req.query;
    const isExport = export_all === 'true' || export_all === true;
    const pageSize = isExport ? 2000 : Math.min(100, Math.max(1, Number(limit) || 20));
    const offset = isExport ? 0 : (Math.max(1, Number(page) || 1) - 1) * pageSize;

    let q = supabase
      .from('invoices')
      .select(`
        id, invoice_number, amount, tax_amount, total_amount, status, payment_method,
        due_date, paid_at, created_at,
        patients(id, name, phone, email),
        appointments(id, date, time, service)
      `, { count: 'exact' })
      .eq('clinic_id', req.clinicId)
      .order('created_at', { ascending: false });

    if (status && status !== 'all') {
      if (status === 'unpaid') {
        q = q.in('status', ['unpaid', 'pending']);
      } else {
        q = q.eq('status', status);
      }
    }
    if (patient_id) {
      q = q.eq('patient_id', patient_id);
    }
    if (from) {
      q = q.gte('created_at', `${from}T00:00:00.000+05:30`);
    }
    if (to) {
      q = q.lte('created_at', `${to}T23:59:59.999+05:30`);
    }

    // Apply pagination range
    q = q.range(offset, offset + pageSize - 1);

    const { data, error, count } = await q;
    if (error) throw error;

    let invoices = data || [];

    // In-memory search filter for patient name, phone, or invoice number if search param is provided
    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      invoices = invoices.filter(inv => {
        const invNo = (inv.invoice_number || '').toLowerCase();
        const pName = (inv.patients?.name || '').toLowerCase();
        const pPhone = (inv.patients?.phone || '').toLowerCase();
        const pEmail = (inv.patients?.email || '').toLowerCase();
        return invNo.includes(s) || pName.includes(s) || pPhone.includes(s) || pEmail.includes(s);
      });
    }

    res.json({
      invoices,
      total: search ? invoices.length : (count || invoices.length),
      page: isExport ? 1 : Number(page) || 1,
      limit: pageSize
    });
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
  body('payment_method').trim().notEmpty().withMessage('Payment method is required')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    // 1. Fetch existing invoice scoped to this clinic
    const { data: existing, error: findErr } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .single();

    if (findErr || !existing) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    // 2. Prevent duplicate payments or overwriting non-payable statuses
    if (existing.status === 'paid') {
      return res.status(400).json({ error: 'Invoice is already marked as paid.' });
    }
    if (existing.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot record payment on a cancelled invoice.' });
    }
    if (existing.status === 'refunded') {
      return res.status(400).json({ error: 'Cannot record payment on a refunded invoice.' });
    }

    // 3. Validate payment method
    const allowedMethods = ['cash', 'upi', 'card', 'bank_transfer', 'other'];
    const pMethod = req.body.payment_method.toLowerCase();
    const cleanMethod = allowedMethods.includes(pMethod) ? pMethod : 'other';

    // 4. Validate payment date
    let paymentDate = new Date();
    if (req.body.paid_at) {
      const parsed = new Date(req.body.paid_at);
      if (!isNaN(parsed.getTime())) {
        paymentDate = parsed;
      }
    }

    // 5. Update invoice securely (never trusting client amount)
    const { data, error } = await supabase
      .from('invoices')
      .update({
        status        : 'paid',
        paid_at       : paymentDate.toISOString(),
        payment_method: cleanMethod,
        updated_at    : new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select(`*, patients(id, name, phone, email)`)
      .single();

    if (error || !data) throw (error || new Error('Failed to update invoice payment.'));
    res.json({ message: 'Full payment recorded successfully.', invoice: data });
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
