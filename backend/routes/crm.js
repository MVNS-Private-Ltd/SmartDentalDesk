const express = require('express');
const requireAuth = require('../middleware/auth');
const { auditLogger } = require('../middleware/audit');
const { createScopedClient } = require('../lib/supabaseScoped');

const router = express.Router();

// Allow public POST to /api/crm/leads for website integrations without auth
router.post('/leads', async (req, res, next) => {
  try {
    // Determine clinic_id from payload (since public)
    const { clinic_id, name, phone, email, source } = req.body;
    if (!clinic_id || !name) return res.status(400).json({ error: 'clinic_id and name are required' });

    const adminSupabase = require('../lib/supabase'); // Service role required for public insert
    const { data, error } = await adminSupabase
      .from('leads')
      .insert({ clinic_id, name, phone, email, source: source || 'website', status: 'new' })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'Lead captured', lead: data });
  } catch (err) { next(err); }
});

// All following routes require auth
router.use(requireAuth);
router.use(auditLogger('crm'));

// GET /api/crm/leads
router.get('/leads', async (req, res, next) => {
  try {
    const supabase = createScopedClient(req.token);
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('clinic_id', req.clinicId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ leads: data });
  } catch (err) { next(err); }
});

// GET /api/crm/campaigns
router.get('/campaigns', async (req, res, next) => {
  try {
    const supabase = createScopedClient(req.token);
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('clinic_id', req.clinicId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ campaigns: data });
  } catch (err) { next(err); }
});

// POST /api/crm/campaigns
router.post('/campaigns', async (req, res, next) => {
  try {
    const { name, type } = req.body;
    const supabase = createScopedClient(req.token);
    const { data, error } = await supabase
      .from('campaigns')
      .insert({ clinic_id: req.clinicId, name, type, created_by: req.user.id })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'Campaign created', campaign: data });
  } catch (err) { next(err); }
});

module.exports = router;
