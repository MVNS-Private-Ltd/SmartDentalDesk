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

    if (isExport) {
      // ── Safe batched pagination to export the COMPLETE filtered dataset ──────
      const batchSize = 1000;
      let allExportInvoices = [];
      let currentOffset = 0;
      let hasMore = true;
      const MAX_SAFETY_EXPORT_LIMIT = 50000; // Hard ceiling to guard against node out-of-memory

      while (hasMore && allExportInvoices.length < MAX_SAFETY_EXPORT_LIMIT) {
        let bq = supabase
          .from('invoices')
          .select(`
            id, invoice_number, amount, tax_amount, total_amount, status, payment_method,
            due_date, paid_at, created_at,
            patients(id, name, phone, email),
            appointments(id, date, time, service)
          `)
          .eq('clinic_id', req.clinicId)
          .order('created_at', { ascending: false })
          .range(currentOffset, currentOffset + batchSize - 1);

        if (status && status !== 'all') {
          if (status === 'unpaid') {
            bq = bq.in('status', ['unpaid', 'pending']);
          } else {
            bq = bq.eq('status', status);
          }
        }
        if (patient_id) {
          bq = bq.eq('patient_id', patient_id);
        }
        if (from) {
          bq = bq.gte('created_at', `${from}T00:00:00.000+05:30`);
        }
        if (to) {
          bq = bq.lte('created_at', `${to}T23:59:59.999+05:30`);
        }

        const { data: batchData, error: batchErr } = await bq;
        if (batchErr) throw batchErr;

        if (!batchData || batchData.length === 0) {
          hasMore = false;
        } else {
          allExportInvoices.push(...batchData);
          currentOffset += batchData.length;
          if (batchData.length < batchSize) {
            hasMore = false;
          }
        }
      }

      // In-memory search filter if search parameter was provided
      if (search && search.trim()) {
        const s = search.trim().toLowerCase();
        allExportInvoices = allExportInvoices.filter(inv => {
          const invNo = (inv.invoice_number || '').toLowerCase();
          const pName = (inv.patients?.name || '').toLowerCase();
          const pPhone = (inv.patients?.phone || '').toLowerCase();
          const pEmail = (inv.patients?.email || '').toLowerCase();
          return invNo.includes(s) || pName.includes(s) || pPhone.includes(s) || pEmail.includes(s);
        });
      }

      return res.json({
        invoices: allExportInvoices,
        total: allExportInvoices.length,
        exported_count: allExportInvoices.length,
        is_truncated: allExportInvoices.length >= MAX_SAFETY_EXPORT_LIMIT,
        max_limit: MAX_SAFETY_EXPORT_LIMIT,
        page: 1,
        limit: allExportInvoices.length
      });
    }

    // ── Standard paginated view ──────────────────────────────────────────────
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 20));
    const offset = (Math.max(1, Number(page) || 1) - 1) * pageSize;

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
      page: Number(page) || 1,
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

    // 1. Role Authorization Policy
    // Only administrative/billing clinic staff can record financial transactions
    const allowedRoles = ['admin', 'super_admin', 'manager', 'receptionist', 'dentist'];
    const userRole = (req.userRole || req.staff?.role || 'admin').toLowerCase();
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'Unauthorized: Your role does not have permission to record invoice payments.' });
    }

    // 2. Payment Method Policy Validation
    const allowedMethods = ['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other'];
    const pMethod = (req.body.payment_method || '').toLowerCase().trim();
    if (!allowedMethods.includes(pMethod)) {
      return res.status(400).json({ error: `Invalid payment method. Allowed methods: ${allowedMethods.join(', ')}.` });
    }

    // 3. Payment Date Policy Validation
    // Cannot record future payment dates beyond end-of-day today in clinic timezone (Asia/Kolkata)
    const now = new Date();
    const todayISTStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const endOfTodayIST = new Date(`${todayISTStr}T23:59:59.999+05:30`);

    let paymentDate = now;
    if (req.body.paid_at) {
      const parsed = new Date(req.body.paid_at);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid payment date format.' });
      }
      if (parsed > endOfTodayIST) {
        return res.status(400).json({ error: 'Payment date cannot be in the future.' });
      }
      paymentDate = parsed;
    }

    // 4. Atomic Conditional Update
    // Concurrency safe: under Postgres MVCC, only a row matching status IN ('unpaid', 'pending')
    // and clinic_id = req.clinicId can be updated. Concurrent duplicate requests will affect 0 rows.
    const { data: updatedRows, error: updateErr } = await supabase
      .from('invoices')
      .update({
        status        : 'paid',
        paid_at       : paymentDate.toISOString(),
        payment_method: pMethod,
        notes         : req.body.notes ? String(req.body.notes).slice(0, 500) : null,
        updated_at    : new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .in('status', ['unpaid', 'pending'])
      .select(`*, patients(id, name, phone, email)`);

    if (updateErr) throw updateErr;

    // 5. If conditional update matched 0 rows, determine exact cause
    if (!updatedRows || updatedRows.length === 0) {
      const { data: existing } = await supabase
        .from('invoices')
        .select('id, status, clinic_id')
        .eq('id', req.params.id)
        .maybeSingle();

      if (!existing || existing.clinic_id !== req.clinicId) {
        return res.status(404).json({ error: 'Invoice not found.' });
      }
      if (existing.status === 'paid') {
        return res.status(409).json({ error: 'Invoice is already marked as paid. Duplicate payment rejected.' });
      }
      if (existing.status === 'cancelled') {
        return res.status(400).json({ error: 'Cannot record payment on a cancelled invoice.' });
      }
      if (existing.status === 'refunded') {
        return res.status(400).json({ error: 'Cannot record payment on a refunded invoice.' });
      }

      return res.status(400).json({ error: 'Invoice cannot be transitioned to paid.' });
    }

    res.json({ message: 'Full payment recorded successfully.', invoice: updatedRows[0] });
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
