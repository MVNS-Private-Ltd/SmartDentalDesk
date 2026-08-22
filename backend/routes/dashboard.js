// ─────────────────────────────────────────────────────────────────────────────
//  Dashboard Routes
//  GET /api/dashboard/stats — Get aggregated stats for the dashboard
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const supabase    = require('../lib/supabase');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── GET /api/dashboard/stats ──────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    
    // 1. Today's appointments count
    const { count: todayAppointments, error: err1 } = await supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', req.clinicId)
      .eq('date', today)
      .neq('status', 'cancelled');
    if (err1) throw err1;

    // 2. Total active patients count
    const { count: totalPatients, error: err2 } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', req.clinicId)
      .eq('is_deleted', false);
    if (err2) throw err2;

    // 3. Today's revenue (from paid invoices today)
    const { data: invoices, error: err3 } = await supabase
      .from('invoices')
      .select('total_amount')
      .eq('clinic_id', req.clinicId)
      .eq('status', 'paid')
      .gte('paid_at', `${today}T00:00:00.000Z`);
    if (err3) throw err3;
    
    const todayRevenue = invoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);

    // 4. Pending invoices count
    const { count: pendingInvoices, error: err4 } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', req.clinicId)
      .eq('status', 'unpaid');
    if (err4) throw err4;

    // 5. Pending appointment approvals count
    const { count: pendingApprovals, error: err5 } = await supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', req.clinicId)
      .eq('status', 'pending');
    if (err5) throw err5;

    res.json({
      today_appointments: todayAppointments || 0,
      total_patients: totalPatients || 0,
      today_revenue: todayRevenue,
      pending_invoices: pendingInvoices || 0,
      pending_approvals: pendingApprovals || 0
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
