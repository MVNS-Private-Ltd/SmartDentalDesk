// ─────────────────────────────────────────────────────────────────────────────
//  Dashboard & Clinic Analytics Routes
//  GET /api/dashboard/stats   — Overview stats for the Home dashboard
//  GET /api/dashboard/reports — Accurate periodic analytics & clinic reports
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const supabase    = require('../lib/supabase');
const requireAuth = require('../middleware/auth');
const requireActiveSubscription = require('../middleware/subscription');

const router = express.Router();
router.use(requireAuth);
router.use(requireActiveSubscription);

// ── Date Range Resolver for Clinic Reports ───────────────────────────────────
// Documented default timezone: Asia/Kolkata (IST, UTC+05:30)
function resolveClinicDateRange(range = 'this_month', customFrom, customTo, tz = 'Asia/Kolkata') {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz }); // 'YYYY-MM-DD'
  const [curYear, curMonth, curDay] = todayStr.split('-').map(Number);

  let fromStr = '';
  let toStr = '';
  let rangeLabel = '';
  let isToDate = false;

  if (range === 'this_month') {
    fromStr = `${curYear}-${String(curMonth).padStart(2, '0')}-01`;
    toStr = todayStr;
    rangeLabel = 'This Month';
    isToDate = true;
  } else if (range === 'last_month') {
    const prevMonthDate = new Date(curYear, curMonth - 2, 1);
    const pYear = prevMonthDate.getFullYear();
    const pMonth = prevMonthDate.getMonth() + 1;
    fromStr = `${pYear}-${String(pMonth).padStart(2, '0')}-01`;
    const lastDayPrev = new Date(pYear, pMonth, 0).getDate();
    toStr = `${pYear}-${String(pMonth).padStart(2, '0')}-${String(lastDayPrev).padStart(2, '0')}`;
    rangeLabel = 'Last Month';
    isToDate = false;
  } else if (range === 'last_6_months') {
    const start6MDate = new Date(curYear, curMonth - 6, 1);
    const sYear = start6MDate.getFullYear();
    const sMonth = start6MDate.getMonth() + 1;
    fromStr = `${sYear}-${String(sMonth).padStart(2, '0')}-01`;
    toStr = todayStr;
    rangeLabel = 'Last 6 Months';
    isToDate = true;
  } else if (range === 'year_to_date') {
    fromStr = `${curYear}-01-01`;
    toStr = todayStr;
    rangeLabel = `Year to Date (${curYear})`;
    isToDate = true;
  } else if (range === 'custom') {
    fromStr = customFrom || `${curYear}-${String(curMonth).padStart(2, '0')}-01`;
    toStr = customTo || todayStr;
    rangeLabel = 'Custom Range';
    if (toStr >= todayStr) isToDate = true;
  } else {
    fromStr = `${curYear}-${String(curMonth).padStart(2, '0')}-01`;
    toStr = todayStr;
    rangeLabel = 'This Month';
    isToDate = true;
  }

  // Ensure fromStr <= toStr
  if (fromStr > toStr) {
    const tmp = fromStr; fromStr = toStr; toStr = tmp;
  }

  // Inclusive boundaries for Timestamptz (ISO with +05:30)
  const startISO = `${fromStr}T00:00:00.000+05:30`;
  const endISO   = `${toStr}T23:59:59.999+05:30`;

  return { fromStr, toStr, startISO, endISO, rangeLabel, isToDate, todayStr, tz };
}

// ── GET /api/dashboard/reports ────────────────────────────────────────────────
router.get('/reports', async (req, res, next) => {
  try {
    if (!req.clinicId) {
      return res.json({ error: 'No clinic found for user.' });
    }

    const { range = 'this_month', from, to } = req.query;
    const resolved = resolveClinicDateRange(range, from, to);
    const { fromStr, toStr, startISO, endISO, rangeLabel, isToDate, todayStr } = resolved;

    // Parallel fetch of clinic data (tenant-scoped)
    const [invRes, apptRes, treatRes] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, invoice_number, amount, tax_amount, total_amount, status, payment_method, due_date, paid_at, created_at, appointment_id')
        .eq('clinic_id', req.clinicId),
      supabase
        .from('appointments')
        .select('id, patient_id, date, time, service, status, created_at')
        .eq('clinic_id', req.clinicId)
        .order('date', { ascending: true }),
      supabase
        .from('treatment_records')
        .select('id, procedure, cost, appointment_id, created_at')
        .eq('clinic_id', req.clinicId)
    ]);

    if (invRes.error)   throw invRes.error;
    if (apptRes.error)  throw apptRes.error;
    if (treatRes.error) throw treatRes.error;

    const allInvoices   = invRes.data || [];
    const allAppts      = apptRes.data || [];
    const allTreatments = treatRes.data || [];

    const rangeStartDate = new Date(startISO);
    const rangeEndDate   = new Date(endISO);

    // ── 1. Revenue & Collections ──────────────────────────────────────────────
    // A. Collected Revenue: invoices with status = 'paid' paid within selected period
    const paidInvoicesInPeriod = allInvoices.filter(inv => {
      if (inv.status !== 'paid' || !inv.paid_at) return false;
      const pDate = new Date(inv.paid_at);
      return pDate >= rangeStartDate && pDate <= rangeEndDate;
    });

    const collectedRevenue = paidInvoicesInPeriod.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

    // B. Invoiced Revenue: invoices created within the period (excluding cancelled)
    const createdInvoicesInPeriod = allInvoices.filter(inv => {
      if (inv.status === 'cancelled') return false;
      const cDate = new Date(inv.created_at);
      return cDate >= rangeStartDate && cDate <= rangeEndDate;
    });

    const invoicedRevenue = createdInvoicesInPeriod.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

    // C. Current Outstanding Balance: All unpaid invoices for the clinic as a snapshot
    const unpaidInvoicesAllTime = allInvoices.filter(inv => inv.status === 'unpaid');
    const currentOutstandingBalance = unpaidInvoicesAllTime.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
    const currentOutstandingCount = unpaidInvoicesAllTime.length;

    // ── 2. Appointments in Selected Period ───────────────────────────────────
    const apptsInPeriod = allAppts.filter(a => a.date >= fromStr && a.date <= toStr);
    const completedApptsInPeriod = apptsInPeriod.filter(a => a.status === 'completed');
    const cancelledApptsInPeriod = apptsInPeriod.filter(a => a.status === 'cancelled');
    const noShowApptsInPeriod    = apptsInPeriod.filter(a => a.status === 'no-show' || a.status === 'no_show');

    const completedVisits = completedApptsInPeriod.length;
    const cancellationsCount = cancelledApptsInPeriod.length;
    const noShowsCount = noShowApptsInPeriod.length;

    // Denominator for rates: Resolved appointments up to today (excluding future or pending)
    const resolvedCount = completedVisits + cancellationsCount + noShowsCount;
    const cancellationRate = resolvedCount > 0 ? Number(((cancellationsCount / resolvedCount) * 100).toFixed(1)) : 0;
    const noShowRate = resolvedCount > 0 ? Number(((noShowsCount / resolvedCount) * 100).toFixed(1)) : 0;

    // ── 3. New vs Returning Patients (Completed Appointments Only) ────────────
    // Unique patients who had a completed visit during this period
    const patientIdsInPeriod = [...new Set(completedApptsInPeriod.map(a => a.patient_id).filter(Boolean))];
    let newPatientsCount = 0;
    let returningPatientsCount = 0;

    patientIdsInPeriod.forEach(pid => {
      // Check if patient had ANY completed visit prior to fromStr
      const hadPriorCompleted = allAppts.some(a => a.patient_id === pid && a.status === 'completed' && a.date < fromStr);
      if (hadPriorCompleted) {
        returningPatientsCount++;
      } else {
        newPatientsCount++;
      }
    });

    // ── 4. Payment Method Distribution (Actual Received Payments) ────────────
    const methodMap = { cash: 0, upi: 0, card: 0, bank_transfer: 0, other: 0 };
    paidInvoicesInPeriod.forEach(inv => {
      const m = (inv.payment_method || 'other').toLowerCase();
      const amt = Number(inv.total_amount || 0);
      if (methodMap[m] !== undefined) {
        methodMap[m] += amt;
      } else {
        methodMap.other += amt;
      }
    });

    // ── 5. Completed Visits by Service & Item-Level Procedure Billing ─────────
    // A. Completed visits count by appointment service
    const serviceVisitMap = {};
    completedApptsInPeriod.forEach(a => {
      const s = (a.service || 'General Dental').trim();
      serviceVisitMap[s] = (serviceVisitMap[s] || 0) + 1;
    });

    const completedVisitsByService = Object.entries(serviceVisitMap)
      .map(([service, visit_count]) => ({ service, visit_count }))
      .sort((a, b) => b.visit_count - a.visit_count)
      .slice(0, 10);

    // B. Item-level procedure billing aggregated directly from invoices created in period
    // Safely handles JSON array or string items, without duplicating whole invoices or inventing taxes
    const itemProcedureAgg = {};
    let totalLineItemAmount = 0;
    let totalInvoiceTaxInPeriod = 0;

    createdInvoicesInPeriod.forEach(inv => {
      totalInvoiceTaxInPeriod += Number(inv.tax_amount || 0);

      let items = inv.items;
      if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch (_) { items = []; }
      }
      if (!Array.isArray(items)) items = [];

      items.forEach(it => {
        const procName = (it.description || it.procedure || 'Clinical Care').trim();
        const lineTotal = Number(it.total !== undefined ? it.total : (Number(it.unit_price || 0) * Number(it.quantity || 1))) || 0;
        const lineQty = Number(it.quantity || 1);

        if (!itemProcedureAgg[procName]) {
          itemProcedureAgg[procName] = {
            procedure: procName,
            billed_amount: 0,
            quantity: 0
          };
        }
        itemProcedureAgg[procName].billed_amount += lineTotal;
        itemProcedureAgg[procName].quantity += lineQty;
        totalLineItemAmount += lineTotal;
      });
    });

    const topBilledProcedures = Object.values(itemProcedureAgg)
      .sort((a, b) => b.billed_amount - a.billed_amount)
      .slice(0, 10);

    // Composite top treatments combining visit counts and item-level pre-tax billing
    const topTreatments = completedVisitsByService.map(sv => {
      // Find matching procedure in item billing if any
      const matchingProc = topBilledProcedures.find(p => p.procedure.toLowerCase().includes(sv.service.toLowerCase()) || sv.service.toLowerCase().includes(p.procedure.toLowerCase()));
      return {
        service: sv.service,
        completed_count: sv.visit_count,
        billed_amount: matchingProc ? matchingProc.billed_amount : 0
      };
    });

    // ── 6. Determine Buckets (Daily vs Monthly) for Charts ────────────────────
    const dStart = new Date(fromStr + 'T00:00:00Z');
    const dEnd   = new Date(toStr + 'T00:00:00Z');
    const totalDays = Math.round((dEnd - dStart) / (1000 * 60 * 60 * 24)) + 1;
    const isDaily = totalDays <= 31;

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const buckets = [];

    if (isDaily) {
      const curr = new Date(dStart);
      while (curr <= dEnd) {
        const key = curr.toISOString().slice(0, 10);
        const dayNum = curr.getUTCDate();
        const monNum = curr.getUTCMonth();
        buckets.push({
          key,
          label: `${dayNum} ${monthNames[monNum]}`,
          collected: 0,
          invoiced: 0,
          cancellations: 0,
          no_shows: 0
        });
        curr.setUTCDate(curr.getUTCDate() + 1);
      }
    } else {
      // Monthly buckets
      const [startYear, startMon] = fromStr.split('-').map(Number);
      const [endYear, endMon]     = toStr.split('-').map(Number);

      let y = startYear;
      let m = startMon;
      while (y < endYear || (y === endYear && m <= endMon)) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        buckets.push({
          key,
          label: `${monthNames[m - 1]} ${String(y).slice(-2)}`,
          collected: 0,
          invoiced: 0,
          cancellations: 0,
          no_shows: 0
        });
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }

    // Populate collections into buckets
    paidInvoicesInPeriod.forEach(inv => {
      const bKey = isDaily ? inv.paid_at.slice(0, 10) : inv.paid_at.slice(0, 7);
      const b = buckets.find(b => b.key === bKey);
      if (b) b.collected += Number(inv.total_amount || 0);
    });

    // Populate invoiced into buckets
    createdInvoicesInPeriod.forEach(inv => {
      const bKey = isDaily ? inv.created_at.slice(0, 10) : inv.created_at.slice(0, 7);
      const b = buckets.find(b => b.key === bKey);
      if (b) b.invoiced += Number(inv.total_amount || 0);
    });

    // Populate cancellations & no-shows by appointment date
    cancelledApptsInPeriod.forEach(a => {
      const bKey = isDaily ? a.date : a.date.slice(0, 7);
      const b = buckets.find(b => b.key === bKey);
      if (b) b.cancellations += 1;
    });

    noShowApptsInPeriod.forEach(a => {
      const bKey = isDaily ? a.date : a.date.slice(0, 7);
      const b = buckets.find(b => b.key === bKey);
      if (b) b.no_shows += 1;
    });

    res.json({
      period: {
        range,
        from: fromStr,
        to: toStr,
        label: rangeLabel,
        is_to_date: isToDate,
        total_days: totalDays,
        today: todayStr
      },
      summary: {
        collected_revenue: collectedRevenue,
        invoiced_revenue: invoicedRevenue,
        current_outstanding_balance: currentOutstandingBalance,
        current_outstanding_count: currentOutstandingCount,
        completed_appointments: completedVisits,
        new_patients: newPatientsCount,
        returning_patients: returningPatientsCount,
        resolved_appointments: resolvedCount,
        cancellations_count: cancellationsCount,
        cancellation_rate: cancellationRate,
        no_shows_count: noShowsCount,
        no_show_rate: noShowRate
      },
      charts: {
        collections_timeline: {
          labels: buckets.map(b => b.label),
          collected: buckets.map(b => b.collected),
          invoiced: buckets.map(b => b.invoiced)
        },
        missed_timeline: {
          labels: buckets.map(b => b.label),
          cancellations: buckets.map(b => b.cancellations),
          no_shows: buckets.map(b => b.no_shows)
        },
        new_vs_returning: {
          new_patients: newPatientsCount,
          returning_patients: returningPatientsCount
        },
        payment_methods: methodMap,
        completed_visits_by_service: completedVisitsByService,
        top_billed_procedures: topBilledProcedures,
        top_treatments: topTreatments
      },
      disclosures: {
        timezone: 'Asia/Kolkata (IST, UTC+05:30). Configurable per-clinic timezone is not currently supported in database schema.',
        outstanding_balance: 'Current unpaid balance across active invoices as of request time. Historical point-in-time balance reconstruction is not supported without dedicated ledger tables.',
        refunds: 'Refunds are tracked as an invoice status. Marking an invoice as refunded excludes it from collections in its original period (gross restatement) rather than creating a dated negative cash-flow entry in the refund period. Invoiced totals preserve the original billed amount.',
        treatment_billing: 'Visit counts reflect completed appointments by booked service. Billed amounts reflect pre-tax line item amounts from clinic invoices. Taxes are billed at the invoice level and excluded from item-level procedure allocations.'
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/dashboard/stats (Home Dashboard Overview) ─────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    if (!req.clinicId) {
      return res.json({
        todayAppointments: 0,
        totalPatients: 0,
        todayRevenue: 0,
        totalRevenue: 0,
        pendingRevenue: 0,
        pendingInvoices: 0,
        pendingApprovals: 0,
        occupancyRate: 0,
        monthlyRevenue: []
      });
    }
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

    // 5. Fetch appointments for analytics charts
    const { data: recentAppointments, error: err5 } = await supabase
      .from('appointments')
      .select('id, date, status, service, created_at, patient_id')
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

    // 5e. Patient Return Rate (patients with more than 1 appointment = returning)
    const patientApptCount = {};
    appts.forEach(a => {
      if (a.patient_id) patientApptCount[a.patient_id] = (patientApptCount[a.patient_id] || 0) + 1;
    });
    const returningPatients = Object.values(patientApptCount).filter(c => c > 1).length;
    const newPatients = Object.values(patientApptCount).filter(c => c === 1).length;

    // 5f. Monthly No-Shows & Cancellations (Past 6 Months) — Fixed 'no-show' and 'no_show'
    const noShowsMonthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const mDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yearMonth = mDate.toISOString().slice(0, 7);
      const count = appts.filter(a =>
        (a.status === 'cancelled' || a.status === 'no-show' || a.status === 'no_show') &&
        (a.date || a.created_at || '').startsWith(yearMonth)
      ).length;
      noShowsMonthlyData.push(count);
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
        },
        return_rate: {
          returning: returningPatients,
          new_patients: newPatients
        },
        no_shows_trend: {
          labels: revenueMonthlyLabels,
          data: noShowsMonthlyData
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
