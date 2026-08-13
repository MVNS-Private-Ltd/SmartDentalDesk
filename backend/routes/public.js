const express  = require('express');
const supabase = require('../lib/supabase');

const router = express.Router();

// ── GET /api/public/clinic/:slug ──────────────────────────────────────────────
router.get('/clinic/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const { data, error } = await supabase
      .from('clinics')
      .select('id, name, address, phone, appointment_settings')
      .eq('booking_slug', slug)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Clinic not found or invalid booking link.' });
    }

    res.json({ clinic: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
