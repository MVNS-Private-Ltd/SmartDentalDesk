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
      // Normalize all headers: lowercase, spaces → underscores, remove special chars
      transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    });
    
    const rows = parsed.data;
    let imported = 0;
    let skipped = 0;
    let errors = [];

    // Pick the first non-empty value matching any of the given keys
    function pick(row, ...keys) {
      for (const k of keys) {
        const v = row[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          return String(v).trim();
        }
      }
      return null;
    }
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // ── Resolve name (full name or firstname + lastname) ──────────────────
      let name = pick(row,
        'patient_name', 'name', 'full_name', 'fullname',
        'patientname', 'patient_full_name', 'patient'
      );
      if (!name) {
        const first = pick(row, 'firstname', 'first_name', 'given_name', 'givenname', 'fname');
        const last  = pick(row, 'lastname',  'last_name',  'surname',    'family_name', 'lname');
        if (first || last) name = [first, last].filter(Boolean).join(' ');
      }

      // ── Resolve phone (optional) ──────────────────────────────────────────
      const rawPhone = pick(row,
        'phone', 'phone_number', 'phonenumber', 'mobile', 'mobile_number',
        'mobilenumber', 'contact', 'contact_number', 'cell', 'telephone',
        'ph_no', 'phno', 'tel'
      );

      // ── Resolve other fields ──────────────────────────────────────────────
      const email   = pick(row, 'email', 'email_address', 'emailaddress', 'e_mail', 'email_id');
      const dobRaw  = pick(row, 'date_of_birth', 'dob', 'birth_date', 'birthdate', 'birthday',
                                'dateofbirth', 'date_of_birth_yyyymmdd');
      const gender  = pick(row, 'gender', 'sex');
      // Combine city + state if available, otherwise just address
      const city    = pick(row, 'city');
      const state   = pick(row, 'state', 'province', 'region');
      const addrRaw = pick(row, 'address', 'addr', 'location', 'residence', 'home_address');
      const address = addrRaw || [city, state].filter(Boolean).join(', ') || null;
      // Extra clinical info → notes
      const notesRaw = pick(row, 'notes', 'note', 'remarks', 'comments',
                                 'medical_notes', 'allergies', 'medical_history');
      const diagnosis   = pick(row, 'diagnosis', 'condition', 'chief_complaint');
      const department  = pick(row, 'department', 'dept', 'specialty', 'speciality');
      const notes = [notesRaw, diagnosis ? `Diagnosis: ${diagnosis}` : null,
                     department ? `Dept: ${department}` : null].filter(Boolean).join(' | ') || null;

      // ── Name is required ──────────────────────────────────────────────────
      if (!name) {
        skipped++;
        errors.push({ row: i + 2, message: `No name found. Columns: [${Object.keys(row).join(', ')}]` });
        continue;
      }

      // ── Phone: normalize or leave null ───────────────────────────────────
      const normalizedPhone = rawPhone
        ? rawPhone.replace(/[\s\-().+]/g, '').replace(/^0+/, '') // strip leading zeros too
        : null;

      // ── Duplicate check ───────────────────────────────────────────────────
      if (normalizedPhone) {
        // Primary: match by phone
        const { data: existing } = await supabase
          .from('patients')
          .select('id, name')
          .eq('clinic_id', req.clinicId)
          .eq('phone', normalizedPhone)
          .eq('is_deleted', false)
          .maybeSingle();
        if (existing) {
          skipped++;
          errors.push({ row: i + 2, message: `Duplicate — phone ${normalizedPhone} already exists (${existing.name})` });
          continue;
        }
      }

      // ── Normalize gender ──────────────────────────────────────────────────
      let normalizedGender = null;
      if (gender) {
        const g = gender.toLowerCase();
        if (g.startsWith('m')) normalizedGender = 'male';
        else if (g.startsWith('f')) normalizedGender = 'female';
        else normalizedGender = 'other';
      }

      // ── Normalize DOB; if only age given, estimate ────────────────────────
      let normalizedDob = null;
      if (dobRaw) {
        const d = new Date(dobRaw);
        if (!isNaN(d.getTime())) normalizedDob = d.toISOString().split('T')[0];
      } else {
        const age = pick(row, 'age');
        if (age && !isNaN(Number(age))) {
          const year = new Date().getFullYear() - Math.round(Number(age));
          normalizedDob = `${year}-01-01`;
        }
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
        errors.push({ row: i + 2, message: insertErr.message });
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

    // ── Duplicate checks before insert ───────────────────────────────────────
    if (phone) {
      const normalizedPhone = phone.replace(/[\s\-().+]/g, '').replace(/^0+/, '');
      const { data: byPhone } = await supabase
        .from('patients')
        .select('id, name')
        .eq('clinic_id', req.clinicId)
        .eq('phone', normalizedPhone)
        .eq('is_deleted', false)
        .maybeSingle();
      if (byPhone) {
        return res.status(409).json({ error: `A patient with this phone number already exists (${byPhone.name}).` });
      }
    }

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

// ── DELETE /api/patients/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('patients')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('clinic_id', req.clinicId)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Patient not found.' });
    res.json({ message: 'Patient deleted successfully.' });
  } catch (err) { next(err); }
});

// ── DELETE /api/patients (bulk) ───────────────────────────────────────────────
router.delete('/', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Provide an array of patient IDs to delete.' });
    }

    const { error } = await supabase
      .from('patients')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .in('id', ids)
      .eq('clinic_id', req.clinicId);

    if (error) throw error;
    res.json({ message: `${ids.length} patient(s) deleted.` });
  } catch (err) { next(err); }
});

module.exports = router;
