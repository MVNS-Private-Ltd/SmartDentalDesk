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

    // 3. Invoices & Revenue data
    const { data: allInvoices, error: err3 } = await supabase
      .from('invoices')
      .select('total_amount, status, paid_at, created_at')
      .eq('clinic_id', req.clinicId);
    if (err3) throw err3;

    const invoices = allInvoices || [];
    const todayRevenue = invoices
      .filter(inv => inv.status === 'paid' && inv.paid_at && inv.paid_at.startsWith(today))
      .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

    const totalRevenue = invoices
      .filter(inv => inv.status === 'paid')
      .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

    const pendingRevenue = invoices
      .filter(inv => inv.status === 'unpaid')
      .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

    const pendingInvoices = invoices.filter(inv => inv.status === 'unpaid').length;

    // 4. Pending appointment approvals count
    const { count: pendingApprovals, error: err4 } = await supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', req.clinicId)
      .eq('status', 'pending');
    if (err4) throw err4;

    // 5. Fetch recent appointments (last 60 days to next 30 days) for analytics charts
    const { data: recentAppointments, error: err5 } = await supabase
      .from('appointments')
      .select('id, date, status, service, created_at')
      .eq('clinic_id', req.clinicId)
      .order('date', { ascending: true });
    if (err5) throw err5;

    const appts = recentAppointments || [];

    // 5a. Build 7-day Activity Timeline (Last 6 days + Today)
    const timelineLabels = [];
    const timelineCompleted = [];
    const timelineScheduled = [];
    const timelinePending = [];

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const label = `${dayNames[d.getDay()]} (${d.getDate()}/${d.getMonth() + 1})`;
      timelineLabels.push(label);

      const dayAppts = appts.filter(a => a.date === dateStr);
      timelineCompleted.push(dayAppts.filter(a => a.status === 'completed').length);
      timelineScheduled.push(dayAppts.filter(a => a.status === 'scheduled' || a.status === 'confirmed').length);
      timelinePending.push(dayAppts.filter(a => a.status === 'pending').length);
    }

    // 5b. Status Breakdown
    const statusCounts = {
      completed: appts.filter(a => a.status === 'completed').length,
      scheduled: appts.filter(a => a.status === 'scheduled' || a.status === 'confirmed').length,
      pending: appts.filter(a => a.status === 'pending').length,
      cancelled: appts.filter(a => a.status === 'cancelled').length,
    };

    // 5c. Services Distribution
    const serviceMap = {};
    appts.forEach(a => {
      const s = a.service || 'General Dental';
      serviceMap[s] = (serviceMap[s] || 0) + 1;
    });

    const serviceLabels = Object.keys(serviceMap);
    const serviceCounts = Object.values(serviceMap);

    // 5d. Monthly Revenue (Past 6 Months)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const revenueMonthlyLabels = [];
    const revenueMonthlyPaid = [];
    const revenueMonthlyPending = [];

    for (let i = 5; i >= 0; i--) {
      const mDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yearMonth = mDate.toISOString().slice(0, 7); // 'YYYY-MM'
      revenueMonthlyLabels.push(`${monthNames[mDate.getMonth()]} ${mDate.getFullYear().toString().slice(-2)}`);

      const mPaid = invoices
        .filter(inv => inv.status === 'paid' && inv.paid_at && inv.paid_at.startsWith(yearMonth))
        .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

      const mPending = invoices
        .filter(inv => inv.status === 'unpaid' && inv.created_at && inv.created_at.startsWith(yearMonth))
        .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

      revenueMonthlyPaid.push(mPaid);
      revenueMonthlyPending.push(mPending);
    }

    res.json({
      today_appointments: todayAppointments || 0,
      total_patients: totalPatients || 0,
      today_revenue: todayRevenue,
      total_revenue: totalRevenue,
      pending_revenue: pendingRevenue,
      pending_invoices: pendingInvoices || 0,
      pending_approvals: pendingApprovals || 0,
      analytics: {
        timeline: {
          labels: timelineLabels,
          completed: timelineCompleted,
          scheduled: timelineScheduled,
          pending: timelinePending
        },
        status_breakdown: statusCounts,
        services: {
          labels: serviceLabels.length > 0 ? serviceLabels : ['Consultation', 'Checkup', 'Cleaning', 'Whitening'],
          counts: serviceCounts.length > 0 ? serviceCounts : [1, 0, 0, 0]
        },
        revenue_trends: {
          labels: revenueMonthlyLabels,
          paid: revenueMonthlyPaid,
          pending: revenueMonthlyPending
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
