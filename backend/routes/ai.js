// ─────────────────────────────────────────────────────────────────────────────
//  AI Route — OpenRouter integration with tier/mode-based model routing
//
//  Mode:   data       → structured DB summaries & patient queries
//          thinking   → clinic advice, planning, treatment suggestions
//          automation → structured JSON outputs for write-actions
//
//  Tier:   basic    → nano for thinking/automation, ultra for data
//          starter  → ultra for data + thinking, nano for automation
//          premium  → ultra for data + automation, super for thinking
//
//  v2:     Before every LLM call, real clinic data is fetched from Supabase
//          and injected as grounded context so the AI can answer factually.
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const { body, validationResult } = require('express-validator');
const { CLINIC_INTELLIGENCE } = require('../lib/clinic_intelligence');
const supabase    = require('../lib/supabase');
const requireAuth = require('../middleware/auth');
const { PLAN_FEATURES, TOKENS_PER_CREDIT, MODEL_FACTORS } = require('../lib/plans');
const { trackAiUsage } = require('../lib/credits');

const router = express.Router();
router.use(requireAuth);

// ── Model IDs (OpenRouter) ───────────────────────────────────────────────────
// openrouter/free dynamically routes across all active free models.
// Specific high-performance free models are provided as backup fallbacks.
const MODELS = {
  ultra:  'openrouter/free',
  super:  'nvidia/nemotron-3-super-120b-a12b:free',
  nano:   'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  mid:    'minimax/minimax-m3:free',
};

const FALLBACK_MODELS = [
  'openrouter/free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'minimax/minimax-m3:free',
  'minimax/minimax-m2.7:free',
  'liquid/lfm-2.5-2.6b:free',
];

// Vision-capable models only (support image_url in messages)
const VISION_FALLBACK_MODELS = [
  'google/gemini-2.0-flash-exp:free',
  'google/gemini-flash-1.5:free',
  'meta-llama/llama-3.2-90b-vision-instruct:free',
  'meta-llama/llama-3.2-11b-vision-instruct:free',
  'qwen/qwen2.5-vl-72b-instruct:free',
  'openrouter/free',
];

// ── Model selection logic ─────────────────────────────────────────────────────
function getModel(subscriptionPlan, mode) {
  const plan = (subscriptionPlan || 'basic').toLowerCase();

  const matrix = {
    basic: {
      data:       MODELS.ultra,
      thinking:   MODELS.nano,
      automation: MODELS.nano,
    },
    starter: {
      data:       MODELS.ultra,
      thinking:   MODELS.ultra,
      automation: MODELS.nano,
    },
    premium: {
      data:       MODELS.ultra,
      thinking:   MODELS.super,
      automation: MODELS.nano,
    },
  };

  const validMode = ['data', 'thinking', 'automation'].includes(mode) ? mode : 'thinking';
  const tierMatrix = matrix[plan] || matrix['basic'];

  console.log(`[AI] Plan: ${plan} | Mode: ${validMode} | Model: ${tierMatrix[validMode]}`);
  return { model: tierMatrix[validMode], mode: validMode };
}

// ── Validation helper ─────────────────────────────────────────────────────────
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
//  fetchClinicContext — pulls live data from Supabase for the AI to reason on
// ─────────────────────────────────────────────────────────────────────────────
async function fetchClinicContext(clinicId) {
  const today = new Date().toISOString().slice(0, 10);
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [
    statsResult,
    todayApptResult,
    recentPatientsResult,
    unpaidInvoicesResult,
    upcomingApptResult,
    recentRevenueResult,
    pendingApptResult,
  ] = await Promise.allSettled([
    // 1. Dashboard summary stats
    Promise.all([
      supabase.from('appointments').select('*', { count: 'exact', head: true })
        .eq('clinic_id', clinicId).eq('date', today).neq('status', 'cancelled'),
      supabase.from('patients').select('*', { count: 'exact', head: true })
        .eq('clinic_id', clinicId).eq('is_deleted', false),
      supabase.from('invoices').select('total_amount')
        .eq('clinic_id', clinicId).eq('status', 'paid')
        .gte('paid_at', `${today}T00:00:00.000Z`),
      supabase.from('invoices').select('*', { count: 'exact', head: true })
        .eq('clinic_id', clinicId).eq('status', 'unpaid'),
      supabase.from('appointments').select('*', { count: 'exact', head: true })
        .eq('clinic_id', clinicId).eq('status', 'pending'),
    ]),

    // 2. Today's appointments with patient names
    supabase.from('appointments')
      .select('date, time, service, reason, status, patients(name, phone)')
      .eq('clinic_id', clinicId)
      .eq('date', today)
      .neq('status', 'cancelled')
      .order('time', { ascending: true }),

    // 3. Most recent 10 patients
    supabase.from('patients')
      .select('name, phone, email, dob, gender, created_at')
      .eq('clinic_id', clinicId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(10),

    // 4. Unpaid invoices (top 10)
    supabase.from('invoices')
      .select('invoice_number, total_amount, due_date, patients(name)')
      .eq('clinic_id', clinicId)
      .eq('status', 'unpaid')
      .order('due_date', { ascending: true })
      .limit(10),

    // 5. Upcoming 7-day appointments
    supabase.from('appointments')
      .select('date, time, service, status, patients(name)')
      .eq('clinic_id', clinicId)
      .gt('date', today)
      .lte('date', in7Days)
      .neq('status', 'cancelled')
      .order('date', { ascending: true })
      .order('time', { ascending: true })
      .limit(20),

    // 6. Revenue last 30 days (paid invoices)
    supabase.from('invoices')
      .select('total_amount, paid_at')
      .eq('clinic_id', clinicId)
      .eq('status', 'paid')
      .gte('paid_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),

    // 7. Pending appointments awaiting approval
    supabase.from('appointments')
      .select('id, date, time, service, reason, patients(name, phone, email)')
      .eq('clinic_id', clinicId)
      .eq('status', 'pending')
      .order('date', { ascending: true })
      .order('time', { ascending: true })
      .limit(20),
  ]);

  // ── Parse stats ──────────────────────────────────────────────────────────────
  let todayApptCount = 0, totalPatients = 0, todayRevenue = 0, pendingInvoiceCount = 0, pendingApptCount = 0;
  if (statsResult.status === 'fulfilled') {
    const [apptRes, patientRes, revenueRes, pendingRes, pendingApptRes] = statsResult.value;
    todayApptCount      = apptRes.count   || 0;
    totalPatients       = patientRes.count || 0;
    pendingInvoiceCount = pendingRes.count || 0;
    pendingApptCount    = pendingApptRes?.count || 0;
    todayRevenue        = (revenueRes.data || []).reduce((s, i) => s + Number(i.total_amount), 0);
  }

  // ── Parse today's appointments ───────────────────────────────────────────────
  const todayAppts = todayApptResult.status === 'fulfilled'
    ? (todayApptResult.value.data || [])
    : [];

  // ── Parse recent patients ────────────────────────────────────────────────────
  const recentPatients = recentPatientsResult.status === 'fulfilled'
    ? (recentPatientsResult.value.data || [])
    : [];

  // ── Parse unpaid invoices ────────────────────────────────────────────────────
  const unpaidInvoices = unpaidInvoicesResult.status === 'fulfilled'
    ? (unpaidInvoicesResult.value.data || [])
    : [];

  // ── Parse upcoming appointments ──────────────────────────────────────────────
  const upcomingAppts = upcomingApptResult.status === 'fulfilled'
    ? (upcomingApptResult.value.data || [])
    : [];

  // ── Parse pending appointments ───────────────────────────────────────────────
  const pendingAppts = pendingApptResult.status === 'fulfilled'
    ? (pendingApptResult.value.data || [])
    : [];

  // ── Parse 30-day revenue ─────────────────────────────────────────────────────
  let revenue30 = 0;
  if (recentRevenueResult.status === 'fulfilled') {
    revenue30 = (recentRevenueResult.value.data || [])
      .reduce((s, i) => s + Number(i.total_amount), 0);
  }

  return {
    today,
    todayApptCount,
    totalPatients,
    todayRevenue,
    pendingInvoiceCount,
    pendingApptCount,
    todayAppts,
    recentPatients,
    unpaidInvoices,
    upcomingAppts,
    pendingAppts,
    revenue30,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  searchPatientByName — fuzzy-find a patient mentioned in the user's message
// ─────────────────────────────────────────────────────────────────────────────
async function searchPatientByName(clinicId, userMessage) {
  // Extract potential names: words that start with uppercase and are 3+ chars,
  // but skip common dental/clinic keywords.
  const STOP_WORDS = new Set([
    'show', 'tell', 'give', 'find', 'get', 'the', 'for', 'about', 'what',
    'who', 'how', 'when', 'today', 'this', 'week', 'last', 'all', 'any',
    'patient', 'patients', 'appointment', 'appointments', 'invoice', 'invoices',
    'treatment', 'treatments', 'revenue', 'report', 'summary', 'clinic',
  ]);

  const words = userMessage.split(/\s+/);
  const candidates = words.filter(w => {
    const clean = w.replace(/[^a-zA-Z]/g, '');
    return clean.length >= 3 && /^[A-Z]/.test(clean) && !STOP_WORDS.has(clean.toLowerCase());
  });

  if (candidates.length === 0) return null;

  // Try each candidate — return the first match
  for (const name of candidates) {
    const { data } = await supabase
      .from('patients')
      .select('id, name, phone, email, dob, gender, address, notes')
      .eq('clinic_id', clinicId)
      .eq('is_deleted', false)
      .ilike('name', `%${name}%`)
      .limit(3);

    if (data && data.length > 0) {
      // Fetch their appointments + treatments
      const patientIds = data.map(p => p.id);
      const [apptRes, treatRes] = await Promise.all([
        supabase.from('appointments')
          .select('date, time, service, reason, status, notes')
          .in('patient_id', patientIds)
          .eq('clinic_id', clinicId)
          .order('date', { ascending: false })
          .limit(10),
        supabase.from('treatment_records')
          .select('procedure, notes, prescription, cost, created_at')
          .in('patient_id', patientIds)
          .eq('clinic_id', clinicId)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      return {
        patients:     data,
        appointments: apptRes.data || [],
        treatments:   treatRes.data || [],
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  serializeContext — converts fetched data into a readable text block
// ─────────────────────────────────────────────────────────────────────────────
function serializeContext(ctx, patientMatch) {
  const lines = [];
  const fmt   = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  lines.push(`=== LIVE CLINIC DATA (as of ${ctx.today}) ===`);
  lines.push('');

  // Summary stats
  lines.push('--- SUMMARY ---');
  lines.push(`Today's appointments : ${ctx.todayApptCount}`);
  lines.push(`Pending approvals    : ${ctx.pendingApptCount}`);
  lines.push(`Total active patients: ${ctx.totalPatients}`);
  lines.push(`Today's revenue      : ${fmt(ctx.todayRevenue)}`);
  lines.push(`Pending invoices     : ${ctx.pendingInvoiceCount}`);
  lines.push(`Revenue (last 30d)   : ${fmt(ctx.revenue30)}`);
  lines.push('');

  // Pending Approvals
  if (ctx.pendingAppts && ctx.pendingAppts.length > 0) {
    lines.push(`--- PENDING APPOINTMENTS AWAITING CLINIC APPROVAL (${ctx.pendingAppts.length}) ---`);
    ctx.pendingAppts.forEach(a => {
      const name = a.patients?.name || 'Unknown';
      const phone = a.patients?.phone || 'No phone';
      lines.push(`  ID: ${a.id} — ${name} (${phone}) requested ${a.service} on ${a.date} at ${a.time}${a.reason ? ` - Reason: ${a.reason}` : ''}`);
    });
    lines.push('');
  }

  // Today's schedule
  if (ctx.todayAppts.length > 0) {
    lines.push(`--- TODAY'S SCHEDULE (${ctx.todayAppts.length} appointments) ---`);
    ctx.todayAppts.forEach(a => {
      const name = a.patients?.name || 'Unknown';
      lines.push(`  ${a.time} — ${name} · ${a.service}${a.reason ? ` (${a.reason})` : ''} [${a.status}]`);
    });
    lines.push('');
  } else {
    lines.push('--- TODAY\'S SCHEDULE ---');
    lines.push('  No appointments scheduled for today.');
    lines.push('');
  }

  // Upcoming 7 days
  if (ctx.upcomingAppts.length > 0) {
    lines.push('--- UPCOMING (next 7 days) ---');
    ctx.upcomingAppts.forEach(a => {
      const name = a.patients?.name || 'Unknown';
      lines.push(`  ${a.date} ${a.time} — ${name} · ${a.service} [${a.status}]`);
    });
    lines.push('');
  }

  // Unpaid invoices
  if (ctx.unpaidInvoices.length > 0) {
    lines.push(`--- UNPAID INVOICES (${ctx.pendingInvoiceCount} total, showing top ${ctx.unpaidInvoices.length}) ---`);
    ctx.unpaidInvoices.forEach(inv => {
      const name = inv.patients?.name || 'Unknown';
      const due  = inv.due_date ? ` · Due: ${inv.due_date}` : '';
      lines.push(`  ${inv.invoice_number} — ${name} · ${fmt(inv.total_amount)}${due}`);
    });
    lines.push('');
  }

  // Recent patients
  if (ctx.recentPatients.length > 0) {
    lines.push('--- RECENTLY ADDED PATIENTS ---');
    ctx.recentPatients.forEach(p => {
      const dob = p.dob ? ` · DOB: ${p.dob}` : '';
      const email = p.email ? ` · Email: ${p.email}` : '';
      lines.push(`  ${p.name} · Phone: ${p.phone}${email}${dob} · Added: ${p.created_at?.slice(0,10)}`);
    });
    lines.push('');
  }

  // Patient-specific data (if a name was matched)
  if (patientMatch) {
    lines.push('--- PATIENT SEARCH RESULTS ---');
    patientMatch.patients.forEach(p => {
      lines.push(`  Name   : ${p.name}`);
      lines.push(`  Phone  : ${p.phone}`);
      if (p.email)   lines.push(`  Email  : ${p.email}`);
      if (p.dob)     lines.push(`  DOB    : ${p.dob}`);
      if (p.gender)  lines.push(`  Gender : ${p.gender}`);
      if (p.address) lines.push(`  Address: ${p.address}`);
      if (p.notes)   lines.push(`  Notes  : ${p.notes}`);
      lines.push('');
    });

    if (patientMatch.appointments.length > 0) {
      lines.push('  Appointment history:');
      patientMatch.appointments.forEach(a => {
        lines.push(`    ${a.date} ${a.time} — ${a.service}${a.reason ? ` (${a.reason})` : ''} [${a.status}]`);
        if (a.notes) lines.push(`      Notes: ${a.notes}`);
      });
      lines.push('');
    }

    if (patientMatch.treatments.length > 0) {
      lines.push('  Treatment history:');
      patientMatch.treatments.forEach(t => {
        lines.push(`    ${t.created_at?.slice(0,10)} — ${t.procedure}${t.cost ? ` · ${fmt(t.cost)}` : ''}`);
        if (t.notes)        lines.push(`      Notes: ${t.notes}`);
        if (t.prescription) lines.push(`      Rx   : ${t.prescription}`);
      });
      lines.push('');
    }
  }

  lines.push('=== END OF CLINIC DATA ===');
  return lines.join('\n');
}

// ── System prompts per mode ───────────────────────────────────────────────────
function buildSystemPrompt(mode, contextBlock, isFirstEver = false) {
  // One-time greeting instruction — injected only on the clinic's very first AI message ever
  const firstTimeInstruction = isFirstEver
    ? `

SPECIAL FIRST-TIME GREETING RULE (applies THIS message only):
This is the very first time this clinic is using the Smart Dental Desk AI assistant.
Before responding to their question, warmly welcome them to Smart Dental Desk. Tell them you are their AI assistant and briefly mention that you can help them manage appointments, patients, invoices, and give operational advice.
Do NOT use emojis. Keep the greeting natural, professional, and brief (2-4 sentences). Then seamlessly answer their actual question or prompt below.
IMPORTANT: This greeting instruction must never be applied again — it is ONLY for this very first interaction.
`
    : '';

  const base = {
    data: `You are a dental clinic data analyst AI for Smart Dental Desk.
You have been provided with LIVE, REAL clinic data pulled directly from the database — it is injected below before this conversation.
Your job is to analyze and answer questions about patients, appointments, invoices, revenue, and clinic statistics using ONLY the data provided.
ADAPTIVE VERBOSITY: 
- If the user just says "hi", "hello", or asks a very simple question, respond in 1-2 lines maximum.
- If the user asks for detailed analysis, provide a structured, detailed, but punchy response. Do not use unnecessary conversational filler.
Be specific: use exact names, numbers, dates, and amounts from the data. Format answers clearly with bullet points or tables when listing items.
If a specific data point is not in the provided context, say so concisely — but NEVER say you don't have access to the database.
The data is always current as of today.
Do NOT use emojis in any response.

AUTOMATION BOUNDARY — STRICTLY ENFORCED:
This mode is for data analysis ONLY. You are NOT capable of performing actions.
If the user asks you to: send an email or SMS, send a message to a patient, schedule a message, add or create a patient, upload or read an image/file, or perform ANY action on the system — you MUST respond with ONLY this message (do not add anything else):
"This action requires Automation mode. Please switch to Automation mode using the mode selector in the chat input bar to perform this task."
Do NOT attempt to draft the email, do NOT output any JSON, do NOT explain how it would be done. Just give the redirect message above and nothing else.${firstTimeInstruction}`,

    thinking: `You are a senior dental practice management consultant AI for Smart Dental Desk.
You have access to REAL, LIVE clinic data injected below — use it to ground your advice in actual figures and situations.
Provide strategic advice, workflow suggestions, and operational recommendations that are specific to this clinic's actual data.
Reference real numbers (patient counts, revenue, appointment volumes) when giving recommendations.
ADAPTIVE VERBOSITY: 
- If the user just says "hi", "hello", or asks a very simple question, respond in 1-2 lines maximum.
- If the user asks for deep operational advice, provide a detailed response applying your clinic intelligence. Do not write huge essays, use bullet points for readability, and get straight to the point.
Do NOT use emojis in any response.

AUTOMATION BOUNDARY — STRICTLY ENFORCED:
This mode is for strategic thinking and advice ONLY. You are NOT capable of performing actions.
If the user asks you to: send an email or SMS, send a message to a patient, schedule a message, add or create a patient, upload or read an image/file, or perform ANY action on the system — you MUST respond with ONLY this message (do not add anything else):
"This action requires Automation mode. Please switch to Automation mode using the mode selector in the chat input bar to perform this task."
Do NOT attempt to draft the email, do NOT output any JSON, do NOT explain how it would be done. Just give the redirect message above and nothing else.${firstTimeInstruction}

${CLINIC_INTELLIGENCE}`,

    automation: `You are an automation assistant AI for Smart Dental Desk.
You have access to real clinic data injected below.
Do NOT use emojis in any response.${firstTimeInstruction}

CRITICAL ROLE: You are an authorized CRM system assistant. You can perform actions on behalf of the clinic by outputting specific JSON payloads. The dashboard will intercept this JSON and execute the action automatically. NEVER tell the user you cannot perform these actions. Outputting the JSON *is* how you do it.

ACTION 1: SEND EMAIL/SMS
When the user asks you to SEND, EMAIL, MESSAGE, or NOTIFY a patient, respond with ONLY a JSON object:
{
  "action_type": "send_email",
  "patient_name": "...",
  "subject": "...",
  "body": "..."
}

ACTION 2: CREATE PATIENT FROM RECORD / IMAGE
When the user uploads an image of a patient record (such as handwritten doctor notes, a registration form, etc.) or asks to add a patient, extract the patient details (read the handwriting carefully!) and respond with ONLY a JSON object:
{
  "action_type": "create_patient",
  "patient": {
    "name": "...",
    "phone": "...",
    "email": "...",
    "dob": "YYYY-MM-DD",
    "gender": "male|female|other",
    "address": "...",
    "notes": "..."
  }
}
If any field is missing in the image, leave it as an empty string "".

CLINICAL WARNINGS & OVERRIDES:
If the user asks you to send a message that is clinically incorrect or unusual, warn them ONCE in plain text. If they insist, you MUST OBEY and output the JSON.

ABSOLUTELY DO NOT output any other JSON structure. DO NOT include any conversational text before or after the JSON. YOU MUST USE THE JSON FORMAT.

For ALL OTHER automation tasks:
Respond with plain text or markdown as appropriate. Do not force JSON.`,
  };

  const prompt = base[mode] || base.thinking;
  return `${prompt}

${contextBlock}`;
}

// ── Auto-generate a session name from the context ───────────────────────────
async function generateSessionName(conversationText) {
  for (const testModel of FALLBACK_MODELS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  'https://smartdentaldesk.app',
          'X-Title':       'Smart Dental Desk',
        },
        body: JSON.stringify({
          model:      testModel,
          messages:   [
            {
              role: 'system',
              content: 'You are a helpful assistant that generates a short, descriptive title (2-6 words max) for a conversation. Return ONLY the title text, no quotes, no extra words.',
            },
            { role: 'user', content: conversationText },
          ],
          max_tokens:  20,
          temperature: 0.3,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      const name = data?.choices?.[0]?.message?.content?.trim();
      if (name) return name;
    } catch {
      // try next fallback model
    }
  }
  return null;
}

// ── GET /api/ai/sessions — list all unique sessions with name + preview ───────
router.get('/sessions', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('ai_chats')
      .select('session_id, session_name, role, content, created_at')
      .eq('clinic_id', req.clinicId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Group by session_id
    const sessionsMap = {};
    (data || []).forEach(row => {
      const sid = row.session_id;
      if (!sid) return;
      if (!sessionsMap[sid]) {
        sessionsMap[sid] = {
          session_id:    sid,
          session_name:  row.session_name || null,
          preview:       null,
          created_at:    row.created_at,
          message_count: 0,
        };
      }
      if (!sessionsMap[sid].session_name && row.session_name) {
        sessionsMap[sid].session_name = row.session_name;
      }
      // First user message as preview
      if (!sessionsMap[sid].preview && row.role === 'user') {
        sessionsMap[sid].preview = row.content;
      }
      sessionsMap[sid].message_count++;
    });

    // Sort sessions newest first (by created_at of first message)
    const sessions = Object.values(sessionsMap).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    res.json({ sessions });
  } catch (err) { next(err); }
});

// ── GET /api/ai/history — full message history for current clinic ─────────────
router.get('/history', async (req, res, next) => {
  try {
    const { session_id } = req.query;
    let query = supabase
      .from('ai_chats')
      .select('id, role, content, mode, model_used, created_at, session_id, session_name')
      .eq('clinic_id', req.clinicId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (session_id) query = query.eq('session_id', session_id);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ history: data });
  } catch (err) { next(err); }
});

// ── DELETE /api/ai/sessions/:sessionId — delete all messages in a session ─────
router.delete('/sessions/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { error } = await supabase
      .from('ai_chats')
      .delete()
      .eq('clinic_id', req.clinicId)
      .eq('session_id', sessionId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PUT /api/ai/sessions/:sessionId/rename — rename a session ─────────────────
router.put('/sessions/:sessionId/rename', [
  body('name').trim().notEmpty().withMessage('Name is required'),
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { sessionId } = req.params;
    const { name } = req.body;

    const { error } = await supabase
      .from('ai_chats')
      .update({ session_name: name })
      .eq('clinic_id', req.clinicId)
      .eq('session_id', sessionId);

    if (error) throw error;
    res.json({ success: true, name });
  } catch (err) { next(err); }
});

// ── POST /api/ai/chat ─────────────────────────────────────────────────────────
const chatRules = [
  body('message').trim().notEmpty().withMessage('Message is required'),
  body('mode').optional({ nullable: true, checkFalsy: true }).isIn(['data', 'thinking', 'automation']).withMessage('Invalid mode'),
  body('session_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('Invalid session ID'),
];

router.post('/chat', chatRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const { message, mode: requestedMode = 'thinking', context = '', session_id, images = [] } = req.body;
    const subscriptionPlan = req.clinic?.subscription_plan || 'basic';
    let { model, mode } = getModel(subscriptionPlan, requestedMode);

    if (images && images.length > 0) {
      model = 'google/gemini-2.0-flash-exp:free';
    }

    // 1. Fetch live clinic context + optional patient search + total message count — in parallel
    const [clinicCtx, patientMatch, totalMsgRes] = await Promise.all([
      fetchClinicContext(req.clinicId),
      searchPatientByName(req.clinicId, message),
      supabase.from('ai_chats').select('*', { count: 'exact', head: true }).eq('clinic_id', req.clinicId),
    ]);

    // isFirstEver = true only when the clinic has never sent a single AI message before
    const isFirstEver = (totalMsgRes.count ?? 0) === 0;

    const contextBlock = serializeContext(clinicCtx, patientMatch);
    const systemPrompt = buildSystemPrompt(mode, contextBlock, isFirstEver);

    // 2. Fetch recent chat history for conversation continuity (this session only)
    let history = [];
    let isFirstMessage = true;
    let existingSessionName = null;

    if (session_id) {
      const { data } = await supabase
        .from('ai_chats')
        .select('role, content, session_name')
        .eq('clinic_id', req.clinicId)
        .eq('session_id', session_id)
        .order('created_at', { ascending: false })
        .limit(10);
      history = data || [];
      isFirstMessage = history.length === 0;
      existingSessionName = history.find(m => m.session_name)?.session_name || null;
    }

    const conversationHistory = history.reverse().map(m => ({
      role:    m.role,
      content: m.content,
    }));

    const userMessageCount = history.filter(m => m.role === 'user').length + 1;

    // 3. Auto-generate a session name on the 2nd user message (or 3rd if still null)
    let sessionName = existingSessionName;
    if (!sessionName && userMessageCount >= 2) {
      const chatContextForNaming = history
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n');
      const namingPrompt = `Conversation:\n${chatContextForNaming}\nUSER: ${message}\n\nTitle:`;
      sessionName = await generateSessionName(namingPrompt);

      // If we generated a name, let's also update the previous messages in this session
      if (sessionName && session_id) {
        supabase.from('ai_chats')
          .update({ session_name: sessionName })
          .eq('session_id', session_id)
          .then(() => {}) // fire and forget
          .catch(e => console.error('Failed to backfill session name', e));
      }
    }

    // 4. Save user message to DB
    const insertPayload = {
      clinic_id:    req.clinicId,
      role:         'user',
      content:      message,
      mode:         mode,
      model_used:   model,
      session_name: sessionName,
    };
    if (session_id) insertPayload.session_id = session_id;

    const { data: userMsgInsert, error: userSaveErr } = await supabase
      .from('ai_chats')
      .insert(insertPayload)
      .select('session_id, session_name')
      .single();
    if (userSaveErr) throw userSaveErr;

    const activeSessionId   = session_id || userMsgInsert.session_id;
    const activeSessionName = sessionName || userMsgInsert.session_name;

    // 5. Build messages array — system prompt now contains live clinic data
    let userMessageContent = context ? `${context}\n\n${message}` : message;
    if (images && images.length > 0) {
      userMessageContent = [{ type: 'text', text: userMessageContent }];
      for (const img of images) {
        userMessageContent.push({ type: 'image_url', image_url: { url: img } });
      }
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessageContent },
    ];

    // 5.5 Check Credits (Soft check before API call)
    const { data: creditCheck, error: creditCheckErr } = await supabase
      .from('clinic_credits')
      .select('credits_allocated, credits_used')
      .eq('clinic_id', req.clinicId)
      .single();

    if (creditCheckErr) throw creditCheckErr;
    
    // Check if they have topups
    const { data: topupCheck } = await supabase
      .from('credit_topup_lots')
      .select('credits_remaining')
      .eq('clinic_id', req.clinicId)
      .gt('expires_at', new Date().toISOString());

    const topupRemaining = (topupCheck || []).reduce((acc, row) => acc + (row.credits_remaining || 0), 0);
    const monthlyRemaining = (creditCheck.credits_allocated - creditCheck.credits_used);
    
    // Strict Mode: Estimate max cost to prevent uncontrolled negative balances
    const maxOutputTokens = 2048; // Matches max_tokens in API call
    const estimatedInputTokens = Math.ceil(JSON.stringify(messages).length / 4);
    const estimatedTotal = estimatedInputTokens + maxOutputTokens;
    const factor = MODEL_FACTORS[model] || 1;
    const estimatedMaxCost = Math.ceil((estimatedTotal / TOKENS_PER_CREDIT) * factor);

    if (Math.max(0, monthlyRemaining) + topupRemaining < estimatedMaxCost) {
      return res.status(402).json({ 
        error: `Insufficient AI credits. Estimated cost: ${estimatedMaxCost} credits. Please purchase a top-up.` 
      });
    }


    // 6. Call OpenRouter API with fallback cascade
    let openRouterRes;
    let usedModel = model;
    const hasImages = images && images.length > 0;
    const modelCandidates = Array.from(new Set([model, ...(hasImages ? VISION_FALLBACK_MODELS : FALLBACK_MODELS)]));
    let lastError = null;

    for (const testModel of modelCandidates) {
      usedModel = testModel;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25000); // 25s per-model timeout
        openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type':  'application/json',
            'HTTP-Referer':  'https://smartdentaldesk.app',
            'X-Title':       'Smart Dental Desk',
          },
          body: JSON.stringify({
            model:       testModel,
            messages:    messages,
            max_tokens:  2048,
            temperature: mode === 'automation' ? 0.1 : 0.7,
          }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);

        if (openRouterRes.ok) break;

        const errBody = await openRouterRes.json().catch(() => ({}));
        lastError = errBody?.error?.message || `OpenRouter error: ${openRouterRes.status}`;
        console.warn(`[AI Chat] Model ${testModel} failed: ${lastError} — Trying fallback...`);
      } catch (fetchErr) {
        lastError = fetchErr.message;
        console.warn(`[AI Chat] Fetch error for ${testModel}: ${lastError} — Trying fallback...`);
      }
    }

    if (!openRouterRes || !openRouterRes.ok) {
      console.error('[OpenRouter Error] All models failed:', lastError);
      throw new Error(lastError || 'All AI models failed to respond.');
    }

    const aiData    = await openRouterRes.json();
    const replyText = aiData?.choices?.[0]?.message?.content?.trim();

    if (!replyText) {
      throw new Error('Empty response from AI model.');
    }

    const inputTokens = aiData?.usage?.prompt_tokens || Math.ceil(JSON.stringify(messages).length / 4);
    const outputTokens = aiData?.usage?.completion_tokens || Math.ceil(replyText.length / 4);
    const totalTokens = inputTokens + outputTokens;
    const usedFactor = MODEL_FACTORS[usedModel] || 1;
    
    const cost = Math.max(1, Math.ceil((totalTokens / TOKENS_PER_CREDIT) * usedFactor));

    // Deduct usage post-call
    const { data: deductRes } = await supabase.rpc('deduct_ai_usage', {
      p_clinic_id: req.clinicId,
      p_cost: cost,
      p_ai_mode: mode,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_total_tokens: totalTokens,
      p_model: usedModel
    });
    
    const txnId = deductRes?.out_txn_id || null;

    // 7. Save assistant reply to DB
    const { data: aiMsg, error: saveErr } = await supabase.from('ai_chats').insert({
      clinic_id:    req.clinicId,
      role:         'assistant',
      content:      replyText,
      mode:         mode,
      model_used:   usedModel,
      session_id:   activeSessionId,
      session_name: activeSessionName,
      credits_cost: cost,
      credit_txn_id: txnId,
    }).select().single();

    if (saveErr) {
       console.error('Failed to save AI chat:', saveErr);
       throw saveErr;
    }

    res.json({
      reply:        aiMsg,
      model_used:   usedModel,
      mode:         mode,
      plan:         subscriptionPlan,
      session_id:   activeSessionId,
      session_name: activeSessionName,
    });

  } catch (err) { next(err); }
});

// ── POST /api/ai/chat/stream — streaming version ──────────────────────────────
router.post('/chat/stream', chatRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const { message, mode: requestedMode = 'thinking', context = '', session_id, images = [] } = req.body;
    const subscriptionPlan = req.clinic?.subscription_plan || 'basic';
    let { model, mode } = getModel(subscriptionPlan, requestedMode);
    
    if (images && images.length > 0) {
      model = 'google/gemini-2.0-flash-exp:free'; // Force a strong free vision model
    }

    const [clinicCtx, patientMatch, totalMsgResStream] = await Promise.all([
      fetchClinicContext(req.clinicId),
      searchPatientByName(req.clinicId, message),
      supabase.from('ai_chats').select('*', { count: 'exact', head: true }).eq('clinic_id', req.clinicId),
    ]);

    const isFirstEverStream = (totalMsgResStream.count ?? 0) === 0;
    const contextBlock = serializeContext(clinicCtx, patientMatch);
    const systemPrompt = buildSystemPrompt(mode, contextBlock, isFirstEverStream);

    let history = [];
    let existingSessionName = null;
    if (session_id) {
      const { data } = await supabase
        .from('ai_chats')
        .select('role, content, session_name')
        .eq('clinic_id', req.clinicId)
        .eq('session_id', session_id)
        .order('created_at', { ascending: false })
        .limit(10);
      history = data || [];
      existingSessionName = history.find(m => m.session_name)?.session_name || null;
    }

    const conversationHistory = history.reverse().map(m => ({ role: m.role, content: m.content }));
    const userMessageCount = history.filter(m => m.role === 'user').length + 1;

    let sessionName = existingSessionName;
    if (!sessionName && userMessageCount >= 2) {
      const chatContext = history
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
      sessionName = await generateSessionName(`${chatContext}\nUSER: ${message}\n\nTitle:`);
      if (sessionName && session_id) {
        supabase.from('ai_chats').update({ session_name: sessionName }).eq('session_id', session_id).then(() => {}).catch(() => {});
      }
    }

    // Save user message to DB (excluding images to save DB space)
    const insertPayload = { clinic_id: req.clinicId, role: 'user', content: message, mode, model_used: model, session_name: sessionName };
    if (session_id) insertPayload.session_id = session_id;

    const { data: userMsgInsert, error: userSaveErr } = await supabase.from('ai_chats').insert(insertPayload).select('session_id, session_name').single();
    if (userSaveErr) throw userSaveErr;

    const activeSessionId   = session_id || userMsgInsert.session_id;
    const activeSessionName = sessionName || userMsgInsert.session_name;

    let userMessageContent = context ? `${context}\n\n${message}` : message;
    if (images && images.length > 0) {
      userMessageContent = [{ type: 'text', text: userMessageContent }];
      for (const img of images) {
        userMessageContent.push({ type: 'image_url', image_url: { url: img } });
      }
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessageContent },
    ];

    // 5.5 Check Credits (Strict check before API call)
    const { data: creditCheck, error: creditCheckErr } = await supabase
      .from('clinic_credits')
      .select('credits_allocated, credits_used')
      .eq('clinic_id', req.clinicId)
      .single();

    if (creditCheckErr) throw creditCheckErr;
    
    // Check if they have topups
    const { data: topupCheck } = await supabase
      .from('credit_topup_lots')
      .select('credits_remaining')
      .eq('clinic_id', req.clinicId)
      .gt('expires_at', new Date().toISOString());

    const topupRemaining = (topupCheck || []).reduce((acc, row) => acc + (row.credits_remaining || 0), 0);
    const monthlyRemaining = (creditCheck.credits_allocated - creditCheck.credits_used);
    
    // Strict Mode: Estimate max cost for stream to prevent uncontrolled negative balances
    const maxOutputTokens = 2048; // Matches max_tokens in API call
    const estimatedInputTokens = Math.ceil(JSON.stringify(messages).length / 4);
    const estimatedTotal = estimatedInputTokens + maxOutputTokens;
    const factor = MODEL_FACTORS[model] || 1;
    const estimatedMaxCost = Math.ceil((estimatedTotal / TOKENS_PER_CREDIT) * factor);

    if (Math.max(0, monthlyRemaining) + topupRemaining < estimatedMaxCost) {
      return res.status(402).json({ 
        error: `Insufficient AI credits. Estimated cost: ${estimatedMaxCost} credits. Please purchase a top-up.` 
      });
    }


    let openRouterRes;
    let usedModel = model;
    const hasImages = images && images.length > 0;
    const modelCandidates = Array.from(new Set([model, ...(hasImages ? VISION_FALLBACK_MODELS : FALLBACK_MODELS)]));

    let lastError = null;
    for (const testModel of modelCandidates) {
      usedModel = testModel;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25000); // 25s per-model timeout
        openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type':  'application/json',
            'HTTP-Referer':  'https://smartdentaldesk.app',
            'X-Title':       'Smart Dental Desk',
          },
          body: JSON.stringify({
            model: testModel,
            messages,
            max_tokens:  2048,
            temperature: mode === 'automation' ? 0.1 : 0.7,
            stream:      true,
          }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);

        if (openRouterRes.ok) break;

        const errBody = await openRouterRes.json().catch(() => ({}));
        lastError = errBody?.error?.message || `OpenRouter error: ${openRouterRes.status}`;
        console.warn(`[AI Stream] Model ${testModel} failed: ${lastError} — Retrying...`);
      } catch (fetchErr) {
        lastError = fetchErr.message;
        console.warn(`[AI Stream] Fetch error for ${testModel}: ${lastError} — Retrying...`);
      }
    }

    if (!openRouterRes || !openRouterRes.ok) {
      throw new Error(lastError || 'All models failed to respond.');
    }

    // Set SSE headers — X-Accel-Buffering:no disables Nginx/Render proxy buffering
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send metadata first so frontend knows session_id
    const metaMsg = `data: ${JSON.stringify({ type: 'meta', session_id: activeSessionId, session_name: activeSessionName })}\n\n`;
    res.write(metaMsg);
    if (typeof res.flush === 'function') res.flush();

    let fullReply = '';
    const reader = openRouterRes.body;
    let buffer = '';
    const decoder = new TextDecoder();

    // Global 55s wall-clock timeout for the entire stream
    const streamAbort = new AbortController();
    const streamGlobalTimer = setTimeout(() => streamAbort.abort('STREAM_TIMEOUT'), 55000);

    // Stall detection: abort if no real token content for 15s
    let stallTimer = setTimeout(() => streamAbort.abort('STREAM_STALL'), 15000);

    try {
      for await (const chunk of reader) {
        if (streamAbort.signal.aborted) break;

        buffer += decoder.decode(chunk, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        let hadRealContent = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) {
              hadRealContent = true;
              fullReply += delta;
              res.write(`data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`);
              if (typeof res.flush === 'function') res.flush();
            }
          } catch { /* skip malformed */ }
        }

        // Only reset stall timer when real content tokens arrive
        if (hadRealContent) {
          clearTimeout(stallTimer);
          stallTimer = setTimeout(() => streamAbort.abort('STREAM_STALL'), 15000);
        }
      }
    } catch (streamErr) {
      console.warn('[AI Stream] Stream read error:', streamErr.message);
    } finally {
      clearTimeout(streamGlobalTimer);
      clearTimeout(stallTimer);
    }

    // If we got a garbage/safety response, throw so frontend shows error
    const trimmedReply = fullReply.trim();
    if (!trimmedReply || trimmedReply.length < 5 || /^user safety:/i.test(trimmedReply)) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'The AI model returned an empty response. Please try again.' })}\n\n`);
      res.end();
      return;
    }

    // Save full reply to DB and Deduct Tokens
    try {
      const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);
      const outputTokens = Math.ceil(fullReply.length / 4);
      const totalTokens = inputTokens + outputTokens;
      const usedFactor = MODEL_FACTORS[usedModel] || 1;
      
      const cost = Math.max(1, Math.ceil((totalTokens / TOKENS_PER_CREDIT) * usedFactor));
  
      // Deduct usage post-call
      const { data: deductRes } = await supabase.rpc('deduct_ai_usage', {
        p_clinic_id: req.clinicId,
        p_cost: cost,
        p_ai_mode: mode,
        p_input_tokens: inputTokens,
        p_output_tokens: outputTokens,
        p_total_tokens: totalTokens,
        p_model: usedModel
      });
      
      const txnId = deductRes?.out_txn_id || null;

      const { data: aiMsg, error: saveErr } = await supabase.from('ai_chats').insert({
        clinic_id:    req.clinicId,
        role:         'assistant',
        content:      fullReply,
        mode,
        model_used:   usedModel,
        session_id:   activeSessionId,
        session_name: activeSessionName,
        credits_cost: cost,
        credit_txn_id: txnId,
      }).select('id').single();

      if (saveErr) throw saveErr;
    } catch (saveErr) {
      console.error('[AI Stream] Failed to save reply or deduct tokens:', saveErr);
    }

    res.write(`data: ${JSON.stringify({ type: 'done', session_id: activeSessionId, session_name: activeSessionName })}\n\n`);
    res.end();

  } catch (err) {
    if (!res.headersSent) return next(err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// ── POST /api/ai/estimate ─────────────────────────────────────────────────────
// Preview the estimated cost of an AI action before running it.
router.post('/estimate', [
  body('message').trim().notEmpty().withMessage('Message is required'),
  body('mode').optional({ nullable: true, checkFalsy: true }).isIn(['data', 'thinking', 'automation'])
], async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    
    const { message, mode: requestedMode = 'thinking' } = req.body;
    const subscriptionPlan = req.clinic?.subscription_plan || 'basic';
    const { model, mode } = getModel(subscriptionPlan, requestedMode);

    // Build mock messages array to estimate input size
    const messages = [
      { role: 'system', content: buildSystemPrompt(mode, 'MOCK_CONTEXT_BLOCK', false) },
      { role: 'user', content: message },
    ];
    
    const maxOutputTokens = 2048;
    const estimatedInputTokens = Math.ceil(JSON.stringify(messages).length / 4);
    const estimatedTotal = estimatedInputTokens + maxOutputTokens;
    const factor = MODEL_FACTORS[model] || 1;
    
    const maxCredits = Math.max(1, Math.ceil((estimatedTotal / TOKENS_PER_CREDIT) * factor));
    const minCredits = Math.max(1, Math.ceil(((estimatedInputTokens + 100) / TOKENS_PER_CREDIT) * factor)); // Assume at least 100 output

    res.json({
      mode,
      model,
      estimated_input_tokens: estimatedInputTokens,
      estimated_cost_range: { min: minCredits, max: maxCredits }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
