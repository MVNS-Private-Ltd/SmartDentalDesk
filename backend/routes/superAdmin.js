// ─────────────────────────────────────────────────────────────────────────────
//  Super Admin API Routes
//  Platform Owner Control Room for SmartDentalDesk SaaS
// ─────────────────────────────────────────────────────────────────────────────
const express   = require('express');
const { body, param, query, validationResult } = require('express-validator');
const supabase  = require('../lib/supabase');
const requireSuperAdmin = require('../middleware/superAdmin');

const router = express.Router();
router.use(requireSuperAdmin); // All routes require Super Admin privileges

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
    return false;
  }
  return true;
}

// In-memory store for platform broadcasts (persists while server runs)
let activeBroadcast = {
  id: 'broadcast-default',
  message: '',
  type: 'info', // 'info' | 'warning' | 'alert'
  is_active: false,
  created_at: new Date().toISOString()
};

// ── 1. GET /api/super-admin/overview ──────────────────────────────────────────
// Returns top-level KPIs, 30-day growth trends, revenue metrics, and live stream
router.get('/overview', async (req, res, next) => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    // Parallel fetch core aggregate data
    const [
      clinicsRes,
      patientsRes,
      appointmentsRes,
      invoicesRes,
      staffRes,
      aiChatsRes
    ] = await Promise.all([
      supabase.from('clinics').select('id, name, owner_name, email, subscription_plan, created_at'),
      supabase.from('patients').select('id, created_at, is_deleted').eq('is_deleted', false),
      supabase.from('appointments').select('id, date, status, created_at'),
      supabase.from('invoices').select('id, total_amount, status, created_at, paid_at'),
      supabase.from('staff').select('id, role, is_active'),
      supabase.from('ai_chats').select('id, mode, model_used, created_at')
    ]);

    const clinics = clinicsRes.data || [];
    const patients = patientsRes.data || [];
    const appointments = appointmentsRes.data || [];
    const invoices = invoicesRes.data || [];
    const staff = staffRes.data || [];
    const aiChats = aiChatsRes.data || [];

    // ── Metrics Calculation ──
    const totalClinics = clinics.length;
    const totalPatients = patients.length;
    const totalAppointments = appointments.length;
    const todayAppointments = appointments.filter(a => a.date === today).length;
    const thisMonthAppointments = appointments.filter(a => a.date >= thisMonthStart).length;
    
    // Revenue calculations
    const paidInvoices = invoices.filter(inv => inv.status === 'paid');
    const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
    const pendingRevenue = invoices.filter(inv => inv.status === 'unpaid').reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
    const thisMonthRevenue = paidInvoices
      .filter(inv => inv.paid_at && inv.paid_at.startsWith(today.slice(0, 7)))
      .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

    // Subscriptions distribution
    const planCounts = {
      free: clinics.filter(c => !c.subscription_plan || c.subscription_plan === 'free').length,
      starter: clinics.filter(c => c.subscription_plan === 'starter').length,
      premium: clinics.filter(c => c.subscription_plan === 'premium').length,
      enterprise: clinics.filter(c => c.subscription_plan === 'enterprise').length
    };

    // AI Telemetry summary
    const totalAiPrompts = aiChats.length;
    const aiModes = {
      thinking: aiChats.filter(c => !c.mode || c.mode === 'thinking').length,
      data: aiChats.filter(c => c.mode === 'data').length,
      automation: aiChats.filter(c => c.mode === 'automation').length
    };

    // ── 30-Day Growth Timeline (Daily Signups & Appts) ──
    const timelineLabels = [];
    const timelineSignups = [];
    const timelineAppts = [];
    const timelineAiCalls = [];

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      const label = `${d.getDate()}/${d.getMonth() + 1}`;
      timelineLabels.push(label);

      timelineSignups.push(clinics.filter(c => c.created_at && c.created_at.startsWith(dateStr)).length);
      timelineAppts.push(appointments.filter(a => a.date === dateStr || (a.created_at && a.created_at.startsWith(dateStr))).length);
      timelineAiCalls.push(aiChats.filter(c => c.created_at && c.created_at.startsWith(dateStr)).length);
    }

    // ── Recent Activity Stream (Latest 15 platform events) ──
    const recentClinics = [...clinics]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
      .map(c => ({
        type: 'clinic_signup',
        title: `New clinic registered: ${c.name}`,
        subtitle: `Owner: ${c.owner_name} (${c.email}) • Plan: ${c.subscription_plan || 'free'}`,
        timestamp: c.created_at
      }));

    res.json({
      kpis: {
        total_clinics: totalClinics,
        total_patients: totalPatients,
        total_appointments: totalAppointments,
        today_appointments: todayAppointments,
        this_month_appointments: thisMonthAppointments,
        total_revenue: totalRevenue,
        pending_revenue: pendingRevenue,
        this_month_revenue: thisMonthRevenue,
        total_staff: staff.length,
        active_staff: staff.filter(s => s.is_active).length,
        total_ai_interactions: totalAiPrompts,
        plan_distribution: planCounts,
        ai_modes_distribution: aiModes
      },
      growth_timeline: {
        labels: timelineLabels,
        signups: timelineSignups,
        appointments: timelineAppts,
        ai_calls: timelineAiCalls
      },
      recent_activity: recentClinics,
      broadcast: activeBroadcast
    });
  } catch (err) {
    next(err);
  }
});

// ── 2. GET /api/super-admin/clinics ───────────────────────────────────────────
// List all clinics with aggregate counts (patients, appointments, revenue, staff, AI calls)
router.get('/clinics', async (req, res, next) => {
  try {
    const { q, plan, page = 1, limit = 50 } = req.query;

    let queryBuilder = supabase
      .from('clinics')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (q) {
      queryBuilder = queryBuilder.or(`name.ilike.%${q}%,owner_name.ilike.%${q}%,email.ilike.%${q}%,booking_slug.ilike.%${q}%`);
    }

    if (plan && plan !== 'all') {
      queryBuilder = queryBuilder.eq('subscription_plan', plan);
    }

    const offset = (Number(page) - 1) * Number(limit);
    queryBuilder = queryBuilder.range(offset, offset + Number(limit) - 1);

    const { data: clinics, error: clinicsErr, count: totalClinics } = await queryBuilder;
    if (clinicsErr) throw clinicsErr;

    // Fetch related counts in parallel for these clinics
    const clinicIds = (clinics || []).map(c => c.id);

    if (clinicIds.length === 0) {
      return res.json({ clinics: [], total: 0, page: Number(page), limit: Number(limit) });
    }

    const [
      patientsRes,
      appointmentsRes,
      invoicesRes,
      staffRes,
      aiChatsRes
    ] = await Promise.all([
      supabase.from('patients').select('clinic_id').in('clinic_id', clinicIds).eq('is_deleted', false),
      supabase.from('appointments').select('clinic_id').in('clinic_id', clinicIds),
      supabase.from('invoices').select('clinic_id, total_amount, status').in('clinic_id', clinicIds),
      supabase.from('staff').select('clinic_id, is_active').in('clinic_id', clinicIds),
      supabase.from('ai_chats').select('clinic_id').in('clinic_id', clinicIds)
    ]);

    const patientsByClinic = {};
    (patientsRes.data || []).forEach(p => {
      patientsByClinic[p.clinic_id] = (patientsByClinic[p.clinic_id] || 0) + 1;
    });

    const appointmentsByClinic = {};
    (appointmentsRes.data || []).forEach(a => {
      appointmentsByClinic[a.clinic_id] = (appointmentsByClinic[a.clinic_id] || 0) + 1;
    });

    const revenueByClinic = {};
    const invoicesCountByClinic = {};
    (invoicesRes.data || []).forEach(inv => {
      invoicesCountByClinic[inv.clinic_id] = (invoicesCountByClinic[inv.clinic_id] || 0) + 1;
      if (inv.status === 'paid') {
        revenueByClinic[inv.clinic_id] = (revenueByClinic[inv.clinic_id] || 0) + Number(inv.total_amount || 0);
      }
    });

    const staffByClinic = {};
    (staffRes.data || []).forEach(s => {
      staffByClinic[s.clinic_id] = (staffByClinic[s.clinic_id] || 0) + 1;
    });

    const aiByClinic = {};
    (aiChatsRes.data || []).forEach(ai => {
      aiByClinic[ai.clinic_id] = (aiByClinic[ai.clinic_id] || 0) + 1;
    });

    const enrichedClinics = (clinics || []).map(c => ({
      ...c,
      patient_count: patientsByClinic[c.id] || 0,
      appointment_count: appointmentsByClinic[c.id] || 0,
      invoice_count: invoicesCountByClinic[c.id] || 0,
      revenue_total: revenueByClinic[c.id] || 0,
      staff_count: staffByClinic[c.id] || 0,
      ai_interactions_count: aiByClinic[c.id] || 0
    }));

    res.json({
      clinics: enrichedClinics,
      total: totalClinics || 0,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (err) {
    next(err);
  }
});

// ── 3. GET /api/super-admin/clinics/:id ────────────────────────────────────────
// Single clinic deep-dive details with staff list, appointments, invoices, & settings
router.get('/clinics/:id', [
  param('id').isUUID().withMessage('Valid clinic ID is required')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { id } = req.params;

    const { data: clinic, error: clinicErr } = await supabase
      .from('clinics')
      .select('*')
      .eq('id', id)
      .single();

    if (clinicErr || !clinic) {
      return res.status(404).json({ error: 'Clinic not found.' });
    }

    // Parallel fetch clinic relationships
    const [
      staffRes,
      patientsCountRes,
      appointmentsRes,
      invoicesRes,
      aiChatsRes
    ] = await Promise.all([
      supabase.from('staff').select('*').eq('clinic_id', id).order('created_at', { ascending: false }),
      supabase.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', id).eq('is_deleted', false),
      supabase.from('appointments').select('id, date, time, service, status, patients(name, phone)').eq('clinic_id', id).order('date', { ascending: false }).limit(20),
      supabase.from('invoices').select('id, invoice_number, total_amount, status, paid_at, created_at, patients(name)').eq('clinic_id', id).order('created_at', { ascending: false }).limit(20),
      supabase.from('ai_chats').select('id, mode, model_used, created_at').eq('clinic_id', id).order('created_at', { ascending: false }).limit(30)
    ]);

    res.json({
      clinic,
      stats: {
        patients_count: patientsCountRes.count || 0,
        staff_count: (staffRes.data || []).length,
        appointments_count: (appointmentsRes.data || []).length,
        invoices_count: (invoicesRes.data || []).length,
        ai_interactions_count: (aiChatsRes.data || []).length
      },
      staff: staffRes.data || [],
      recent_appointments: appointmentsRes.data || [],
      recent_invoices: invoicesRes.data || [],
      recent_ai_chats: aiChatsRes.data || []
    });
  } catch (err) {
    next(err);
  }
});

// ── 4. PATCH /api/super-admin/clinics/:id/plan ─────────────────────────────────
// Change clinic subscription tier (free, starter, premium, enterprise)
router.patch('/clinics/:id/plan', [
  param('id').isUUID().withMessage('Valid clinic ID is required'),
  body('plan').isIn(['free', 'starter', 'premium', 'enterprise']).withMessage('Valid subscription plan is required')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { id } = req.params;
    const { plan } = req.body;

    const { data: updated, error } = await supabase
      .from('clinics')
      .update({ subscription_plan: plan, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, owner_name, email, subscription_plan')
      .single();

    if (error || !updated) {
      return res.status(404).json({ error: 'Clinic not found or update failed.' });
    }

    res.json({
      message: `Subscription plan updated to '${plan.toUpperCase()}' for ${updated.name}.`,
      clinic: updated
    });
  } catch (err) {
    next(err);
  }
});

// ── 5. PATCH /api/super-admin/clinics/:id/status ───────────────────────────────
// Update clinic active/suspended state
router.patch('/clinics/:id/status', [
  param('id').isUUID().withMessage('Valid clinic ID is required'),
  body('is_active').isBoolean().withMessage('is_active must be a boolean')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { id } = req.params;
    const { is_active } = req.body;

    // Fetch existing settings
    const { data: clinic, error: fetchErr } = await supabase
      .from('clinics')
      .select('settings, name')
      .eq('id', id)
      .single();

    if (fetchErr || !clinic) {
      return res.status(404).json({ error: 'Clinic not found.' });
    }

    const currentSettings = clinic.settings || {};
    const updatedSettings = {
      ...currentSettings,
      is_suspended: !is_active,
      suspended_at: is_active ? null : new Date().toISOString()
    };

    const { data: updated, error: updateErr } = await supabase
      .from('clinics')
      .update({ settings: updatedSettings, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, settings')
      .single();

    if (updateErr) throw updateErr;

    res.json({
      message: is_active ? `Clinic '${clinic.name}' has been activated.` : `Clinic '${clinic.name}' has been suspended.`,
      clinic: updated
    });
  } catch (err) {
    next(err);
  }
});

// ── 6. POST /api/super-admin/clinics/:id/impersonate ──────────────────────────
// Returns session payload allowing the SaaS Owner to launch dashboard.html for target clinic
router.post('/clinics/:id/impersonate', [
  param('id').isUUID().withMessage('Valid clinic ID is required')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { id } = req.params;

    const { data: clinic, error } = await supabase
      .from('clinics')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !clinic) {
      return res.status(404).json({ error: 'Clinic not found.' });
    }

    res.json({
      message: `Impersonating ${clinic.name}`,
      impersonation: true,
      clinic: {
        id: clinic.id,
        name: clinic.name,
        owner_name: clinic.owner_name,
        email: clinic.email,
        subscription_plan: clinic.subscription_plan
      },
      user: {
        id: clinic.owner_id,
        email: clinic.email,
        name: clinic.owner_name
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 7. DELETE /api/super-admin/clinics/:id ─────────────────────────────────────
// Delete clinic (cascades patients, appointments, invoices, staff)
router.delete('/clinics/:id', [
  param('id').isUUID().withMessage('Valid clinic ID is required')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { id } = req.params;

    const { data: clinic } = await supabase.from('clinics').select('name').eq('id', id).single();

    const { error } = await supabase.from('clinics').delete().eq('id', id);
    if (error) throw error;

    res.json({ message: `Clinic '${clinic?.name || id}' and all associated records deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

// ── 8. GET /api/super-admin/staff ─────────────────────────────────────────────
// Global staff & receptionist directory across all clinics
router.get('/staff', async (req, res, next) => {
  try {
    const { q, role, clinic_id } = req.query;

    let queryBuilder = supabase
      .from('staff')
      .select('*, clinics(id, name, email, owner_name)')
      .order('created_at', { ascending: false });

    if (clinic_id) {
      queryBuilder = queryBuilder.eq('clinic_id', clinic_id);
    }
    if (role && role !== 'all') {
      queryBuilder = queryBuilder.eq('role', role);
    }

    const { data: staffList, error } = await queryBuilder;
    if (error) throw error;

    let filtered = staffList || [];
    if (q) {
      const lower = q.toLowerCase();
      filtered = filtered.filter(s => 
        (s.name && s.name.toLowerCase().includes(lower)) ||
        (s.email && s.email.toLowerCase().includes(lower)) ||
        (s.clinics?.name && s.clinics.name.toLowerCase().includes(lower)) ||
        (s.phone && s.phone.includes(lower))
      );
    }

    res.json({ staff: filtered, total: filtered.length });
  } catch (err) {
    next(err);
  }
});

// ── 9. PATCH /api/super-admin/staff/:id/toggle-active ─────────────────────────
// Super Admin activate / deactivate staff member
router.patch('/staff/:id/toggle-active', [
  param('id').isUUID().withMessage('Valid staff ID is required'),
  body('is_active').isBoolean().withMessage('is_active must be a boolean')
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { id } = req.params;
    const { is_active } = req.body;

    const { data: updated, error } = await supabase
      .from('staff')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, role, is_active, clinic_id')
      .single();

    if (error || !updated) {
      return res.status(404).json({ error: 'Staff member not found.' });
    }

    res.json({
      message: `Staff member ${updated.name} is now ${is_active ? 'Active' : 'Inactive'}.`,
      staff: updated
    });
  } catch (err) {
    next(err);
  }
});

// ── 10. GET /api/super-admin/ai-analytics ──────────────────────────────────────
// Deep AI Copilot telemetry across clinics
router.get('/ai-analytics', async (req, res, next) => {
  try {
    const [chatsRes, clinicsRes] = await Promise.all([
      supabase.from('ai_chats').select('id, clinic_id, mode, model_used, created_at').order('created_at', { ascending: false }),
      supabase.from('clinics').select('id, name, subscription_plan')
    ]);

    const chats = chatsRes.data || [];
    const clinics = clinicsRes.data || [];

    const clinicMap = {};
    clinics.forEach(c => { clinicMap[c.id] = c; });

    // Usage by clinic
    const usageByClinicMap = {};
    const modelMap = {};
    const modeMap = {};

    chats.forEach(chat => {
      // Clinic stats
      const cId = chat.clinic_id;
      if (cId) {
        if (!usageByClinicMap[cId]) {
          usageByClinicMap[cId] = {
            clinic_id: cId,
            clinic_name: clinicMap[cId]?.name || 'Unknown Clinic',
            plan: clinicMap[cId]?.subscription_plan || 'free',
            total_requests: 0,
            modes: { data: 0, thinking: 0, automation: 0 }
          };
        }
        usageByClinicMap[cId].total_requests += 1;
        const modeKey = chat.mode || 'thinking';
        usageByClinicMap[cId].modes[modeKey] = (usageByClinicMap[cId].modes[modeKey] || 0) + 1;
      }

      // Global models
      const m = chat.model_used || 'openrouter/free';
      modelMap[m] = (modelMap[m] || 0) + 1;

      // Global modes
      const md = chat.mode || 'thinking';
      modeMap[md] = (modeMap[md] || 0) + 1;
    });

    const leaderboard = Object.values(usageByClinicMap)
      .sort((a, b) => b.total_requests - a.total_requests)
      .slice(0, 10);

    res.json({
      total_ai_requests: chats.length,
      model_breakdown: modelMap,
      mode_breakdown: modeMap,
      leaderboard,
      recent_chats: chats.slice(0, 25).map(c => ({
        ...c,
        clinic_name: clinicMap[c.clinic_id]?.name || 'Clinic'
      }))
    });
  } catch (err) {
    next(err);
  }
});

// ── 11. GET /api/super-admin/system-health ────────────────────────────────────
// Server process metrics, uptime, memory load, DB check
router.get('/system-health', async (_req, res) => {
  const mem = process.memoryUsage();
  const uptimeSeconds = Math.floor(process.uptime());
  
  const startTime = Date.now();
  let dbStatus = 'healthy';
  let dbLatencyMs = 0;

  try {
    const { error } = await supabase.from('clinics').select('id', { count: 'exact', head: true });
    dbLatencyMs = Date.now() - startTime;
    if (error) dbStatus = 'error: ' + error.message;
  } catch (e) {
    dbStatus = 'unreachable: ' + e.message;
    dbLatencyMs = Date.now() - startTime;
  }

  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    uptime_seconds: uptimeSeconds,
    uptime_formatted: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`,
    node_version: process.version,
    platform: process.platform,
    environment: process.env.NODE_ENV || 'development',
    memory: {
      rss_mb: (mem.rss / 1024 / 1024).toFixed(2),
      heap_used_mb: (mem.heapUsed / 1024 / 1024).toFixed(2),
      heap_total_mb: (mem.heapTotal / 1024 / 1024).toFixed(2)
    },
    database: {
      provider: 'Supabase PostgreSQL',
      status: dbStatus,
      latency_ms: dbLatencyMs
    }
  });
});

// ── 12. GET /api/super-admin/broadcast ────────────────────────────────────────
router.get('/broadcast', (_req, res) => {
  res.json({ broadcast: activeBroadcast });
});

// ── 13. POST /api/super-admin/broadcast ───────────────────────────────────────
// Update platform-wide broadcast announcement
router.post('/broadcast', [
  body('message').optional().trim(),
  body('type').optional().isIn(['info', 'warning', 'alert']),
  body('is_active').isBoolean()
], async (req, res) => {
  if (!validate(req, res)) return;
  const { message = '', type = 'info', is_active = false } = req.body;

  activeBroadcast = {
    id: 'broadcast-' + Date.now(),
    message,
    type,
    is_active,
    updated_at: new Date().toISOString()
  };

  res.json({
    message: is_active ? 'Platform broadcast announcement published.' : 'Platform broadcast cleared.',
    broadcast: activeBroadcast
  });
});

module.exports = router;
module.exports.getActiveBroadcast = () => activeBroadcast;
