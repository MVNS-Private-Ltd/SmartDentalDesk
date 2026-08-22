// ─────────────────────────────────────────────────────────────────────────────
//  Patients Routes
//  GET    /api/patients          — List all patients for this clinic
//  GET    /api/patients/:id      — Get single patient with visit history
//  POST   /api/patients          — Create new patient
//  PUT    /api/patients/:id      — Update patient details
//  DELETE /api/patients/:id      — Soft-delete patient
//  GET    /api/patients/search   — Search by name or phone
// ─────────────────────────────────────────────────────────────────────────────
const express     = require('express');
const { body, query, validationResult } = require('express-validator');
const supabase    = require('../lib/supabase');
const requireAuth = require('../middleware/auth');
const multer      = require('multer');
const Papa        = require('papaparse');

const router = express.Router();
router.use(requireAuth); // All patient routes require auth

const upload = multer({ storage: multer.memoryStorage() });

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// ── GET /api/patients ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 50, search, type = 'all' } = req.query;
    const offset = (page - 1) * limit;

    let q = supabase
      .from('patients')
      .select('id, name, phone, email, dob, gender, address, notes, is_starred, created_at', { count: 'exact' })
      .eq('clinic_id', req.clinicId)
      .eq('is_deleted', false)
      .order('is_starred', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (search) {
      q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    if (type === 'starred') {
      q = q.eq('is_starred', true);
    } else if (type === 'regular') {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      q = q.gte('created_at', sixMonthsAgo.toISOString());
    } else if (type === 'past') {
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      q = q.lt('created_at', twelveMonthsAgo.toISOString());
    }

    const { data, error, count } = await q;
    if (error) throw error;

    res.json({ patients: data, total: count, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
});

// ── GET /api/patients/search ──────────────────────────────────────────────────
router.get('/search', [query('q').notEmpty()], async (req, res, next) => {
  try {
    const { q } = req.query;
    const { data, error } = await supabase
      .from('patients')
      .select('id, name, phone, email')
      .eq('clinic_id', req.clinicId)
      .eq('is_deleted', false)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(10);

    if (error) throw error;
    res.json({ patients: data });
  } catch (err) { next(err); }
});

// ── GET /api/patients/import/template ─────────────────────────────────────────
router.get('/import/template', (req, res) => {
  const csv = Papa.unparse([
    {
      patient_name: 'Priya Sharma',
      phone: '9876543210',
      email: 'priya.s@example.com',
      date_of_birth: '1990-05-15',
      gender: 'female',
      address: '123 Main St, Mumbai',
      notes: 'Allergic to penicillin'
    },
    {
      patient_name: 'Rahul Kumar',
      phone: '9123456789',
      email: '',
      date_of_birth: '1985-11-20',
      gender: 'male',
      address: '45 Park Ave, Delhi',
      notes: ''
    }
  ]);
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="smartdentaldesk_patients_template.csv"');
  res.status(200).send(csv);
});

// ── POST /api/patients/import ─────────────────────────────────────────────────
router.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const fileContent = req.file.buffer.toString('utf8');
    const parsed = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_')
    });
    
    const rows = parsed.data;
    let imported = 0;
    let skipped = 0;
    let errors = [];

    // Helper: pick the first matching key from a row
    function pick(row, ...keys) {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
          return String(row[k]).trim();
        }
      }
      return null;
    }
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Accept common column name variants
      const name  = pick(row, 'patient_name', 'name', 'full_name', 'patient', 'patientname', 'fullname', 'patient_full_name');
      const phone = pick(row, 'phone', 'phone_number', 'mobile', 'mobile_number', 'contact', 'contact_number', 'cell', 'telephone', 'ph_no', 'phno');
      const email = pick(row, 'email', 'email_address', 'e_mail', 'emailaddress', 'email_id');
      const dob   = pick(row, 'date_of_birth', 'dob', 'birth_date', 'birthdate', 'birthday', 'date_of_birth_(yyyy-mm-dd)', 'date_of_birth_(dd/mm/yyyy)');
      const gender= pick(row, 'gender', 'sex');
      const address = pick(row, 'address', 'addr', 'location', 'city', 'residence');
      const notes = pick(row, 'notes', 'note', 'remarks', 'comments', 'medical_notes', 'allergies', 'medical_history');
      
      if (!name || !phone) {
        skipped++;
        const foundKeys = Object.keys(row).join(', ');
        errors.push({ row: i + 2, message: `Missing name or phone. Found columns: [${foundKeys}]`, data: row });
        continue;
      }

      // Normalize phone — strip spaces/dashes/parentheses/+
      const normalizedPhone = phone.replace(/[\s\-().+]/g, '');
      
      const { data: existing } = await supabase
        .from('patients')
        .select('id')
        .eq('clinic_id', req.clinicId)
        .eq('phone', normalizedPhone)
        .maybeSingle();
        
      if (existing) {
        skipped++;
        errors.push({ row: i + 2, message: 'Duplicate phone number', data: row });
        continue;
      }

      // Normalize gender
      let normalizedGender = null;
      if (gender) {
        const g = gender.toLowerCase();
        if (g.startsWith('m')) normalizedGender = 'male';
        else if (g.startsWith('f')) normalizedGender = 'female';
        else normalizedGender = 'other';
      }

      // Validate dob format
      let normalizedDob = null;
      if (dob) {
        const d = new Date(dob);
        if (!isNaN(d.getTime())) normalizedDob = d.toISOString().split('T')[0];
      }
      
      const { error: insertErr } = await supabase
        .from('patients')
        .insert({
          clinic_id: req.clinicId,
          name,
          phone: normalizedPhone,
          email: email || null,
          dob: normalizedDob,
          gender: normalizedGender,
          address: address || null,
          notes: notes || null
        });
        
      if (insertErr) {
        skipped++;
        errors.push({ row: i + 2, message: insertErr.message, data: row });
      } else {
        imported++;
      }
    }
    
    res.json({ success: true, imported, skipped, errors });
  } catch (err) { next(err); }
});

// ── GET /api/patients/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { data: patient, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .eq('is_deleted', false)
      .single();

    if (error || !patient) return res.status(404).json({ error: 'Patient not found.' });

    // Also fetch appointments and treatments
    const { data: appointments } = await supabase
      .from('appointments')
      .select('id, date, time, service, reason, status, notes')
      .eq('patient_id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .order('date', { ascending: false })
      .limit(20);

    const { data: treatments } = await supabase
      .from('treatment_records')
      .select('id, procedure, notes, prescription, cost, created_at')
      .eq('patient_id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({ patient, appointments: appointments || [], treatments: treatments || [] });
  } catch (err) { next(err); }
});

// ── POST /api/patients ────────────────────────────────────────────────────────
const createRules = [
  body('name').trim().notEmpty().withMessage('Patient name is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('email').optional().isEmail().withMessage('Invalid email'),
  body('dob').optional().isDate().withMessage('Invalid date of birth'),
  body('gender').optional().isIn(['male', 'female', 'other'])
];

router.post('/', createRules, async (req, res, next) => {
  try {
    if (!validate(req, res)) return;
    const { name, phone, email, dob, gender, address, notes } = req.body;

    const { data, error } = await supabase
      .from('patients')
      .insert({ clinic_id: req.clinicId, name, phone, email, dob, gender, address, notes })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A patient with this phone number already exists.' });
      throw error;
    }
    res.status(201).json({ message: 'Patient created.', patient: data });
  } catch (err) { next(err); }
});

// ── PUT /api/patients/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['name','phone','email','dob','gender','address','notes'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const { data, error } = await supabase
      .from('patients')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Patient not found.' });
    res.json({ message: 'Patient updated.', patient: data });
  } catch (err) { next(err); }
});

// ── PATCH /api/patients/:id/star ─────────────────────────────────────────────
router.patch('/:id/star', async (req, res, next) => {
  try {
    const { is_starred } = req.body;

    let targetStar = is_starred;
    if (targetStar === undefined) {
      const { data: current } = await supabase
        .from('patients')
        .select('is_starred')
        .eq('id', req.params.id)
        .eq('clinic_id', req.clinicId)
        .single();
      targetStar = !current?.is_starred;
    }

    const { data, error } = await supabase
      .from('patients')
      .update({ is_starred: targetStar, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Patient not found.' });
    res.json({ message: targetStar ? 'Patient starred as VIP.' : 'Patient unstarred.', patient: data });
  } catch (err) { next(err); }
});

module.exports = router;
