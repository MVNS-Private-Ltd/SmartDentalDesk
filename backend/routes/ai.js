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
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const { body, validationResult } = require('express-validator');
const supabase    = require('../lib/supabase');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── Model IDs (OpenRouter) ────────────────────────────────────────────────────
const MODELS = {
  ultra:  'nvidia/nemotron-3-ultra-550b-a55b:free',     // Best reasoning, large context
  super:  'nvidia/nemotron-3-super-120b-a12b:free',     // Premium thinking
  nano:   'nvidia/nemotron-3-nano-30b-a3b:free',        // Fast, cheap, automation
};

// ── System prompts per mode ───────────────────────────────────────────────────
const SYSTEM_PROMPTS = {
  data: `You are a dental clinic data analyst AI for Smart Dental Desk.
Your job is to analyze patient data, appointments, invoices, and clinic statistics
and return clear, concise summaries and insights to the clinic owner.
Always respond in plain language. When listing data, use bullet points or tables.
Never make up data — if information is not provided, say so.`,

  thinking: `You are a senior dental practice management consultant AI for Smart Dental Desk.
You provide strategic advice, workflow suggestions, and operational recommendations
to help the clinic owner improve efficiency, reduce no-shows, and grow their practice.
You have deep knowledge of dentistry workflows, patient communication best practices,
and clinic operations. Be specific and actionable in your recommendations.`,

  automation: `You are an automation assistant AI for Smart Dental Desk.
Your job is to generate structured, precise outputs for clinic write-actions such as
rescheduling appointments, drafting patient messages, or generating reminder text.
When asked to produce structured output, always respond with valid, parseable JSON.
Follow instructions exactly. Do not add commentary — only produce the requested output.`,
};

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
      thinking:   MODELS.super,  // Best reasoning for premium
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

// ── Auto-generate a session name from the first user message ──────────────────
async function generateSessionName(firstMessage) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://smartdentaldesk.app',
        'X-Title':       'Smart Dental Desk',
      },
      body: JSON.stringify({
        model:      MODELS.nano,
        messages:   [
          {
            role: 'system',
            content: 'Generate a short, descriptive title (4-6 words max) for a conversation that starts with the following message. Return ONLY the title, no quotes, no punctuation at the end.',
          },
          { role: 'user', content: firstMessage },
        ],
        max_tokens:  20,
        temperature: 0.5,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const name = data?.choices?.[0]?.message?.content?.trim();
    return name || null;
  } catch {
    return null;
  }
}

// ── GET /api/ai/sessions — list all unique sessions with name + preview ───────
router.get('/sessions', async (req, res, next) => {
  try {
    // Get the first message of each session to use as preview
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
          session_id:   sid,
          session_name: row.session_name || null,
          preview:      null,
          created_at:   row.created_at,
          message_count: 0,
        };
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
  body('mode').optional().isIn(['data', 'thinking', 'automation']).withMessage('Invalid mode'),
  body('session_id').optional().isUUID().withMessage('Invalid session ID'),
];

router.post('/chat', chatRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const { message, mode: requestedMode = 'thinking', context = '', session_id } = req.body;
    const subscriptionPlan = req.clinic?.subscription_plan || 'basic';
    const { model, mode } = getModel(subscriptionPlan, requestedMode);
    const systemPrompt = SYSTEM_PROMPTS[mode];

    // 1. Fetch recent chat history for conversation context (only for this session)
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
      role: m.role,
      content: m.content,
    }));

    // 2. Auto-generate a session name if this is the first message in a new session
    let sessionName = existingSessionName;
    if (isFirstMessage || !sessionName) {
      sessionName = await generateSessionName(message);
    }

    // 3. Save user message to DB
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

    // Use the generated session_id if none was provided
    const activeSessionId   = session_id || userMsgInsert.session_id;
    const activeSessionName = sessionName || userMsgInsert.session_name;

    // 4. Build messages array for OpenRouter
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: context ? `${context}\n\n${message}` : message },
    ];

    // 5. Call OpenRouter API
    const openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://smartdentaldesk.app',
        'X-Title':       'Smart Dental Desk',
      },
      body: JSON.stringify({
        model:       model,
        messages:    messages,
        max_tokens:  1024,
        temperature: mode === 'automation' ? 0.1 : 0.7,
      }),
    });

    if (!openRouterRes.ok) {
      const errBody = await openRouterRes.json().catch(() => ({}));
      console.error('[OpenRouter Error]', openRouterRes.status, errBody);
      throw new Error(errBody?.error?.message || `OpenRouter API error: ${openRouterRes.status}`);
    }

    const aiData    = await openRouterRes.json();
    const replyText = aiData?.choices?.[0]?.message?.content?.trim();

    if (!replyText) throw new Error('Empty response from AI model.');

    // 6. Save assistant reply to DB
    const { data: aiMsg, error: saveErr } = await supabase.from('ai_chats').insert({
      clinic_id:    req.clinicId,
      role:         'assistant',
      content:      replyText,
      mode:         mode,
      model_used:   model,
      session_id:   activeSessionId,
      session_name: activeSessionName,
    }).select().single();

    if (saveErr) throw saveErr;

    res.json({
      reply:        aiMsg,
      model_used:   model,
      mode:         mode,
      plan:         subscriptionPlan,
      session_id:   activeSessionId,
      session_name: activeSessionName,
    });

  } catch (err) { next(err); }
});

module.exports = router;
