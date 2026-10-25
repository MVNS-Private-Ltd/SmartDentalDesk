/**
 * seed_demo_clinic.js
 * Creates a complete demo clinic account with realistic data:
 *   - Clinic owner (admin login)
 *   - 2 staff members with login accounts
 *   - 15 patients with varied demographics
 *   - 30+ appointments (past, upcoming, pending)
 *   - Treatment records linked to completed appointments
 *   - Invoices (paid & unpaid)
 *   - Subscription record
 *
 * Usage: node seed_demo_clinic.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ─── Credentials ─────────────────────────────────────────────────────────────
const OWNER_EMAIL    = 'demo.owner@brightsmileclinic.in';
const OWNER_PASSWORD = 'BrightSmile@2024';

const STAFF_1_EMAIL    = 'dr.priya@brightsmileclinic.in';
const STAFF_1_PASSWORD = 'Staff@Priya2024';

const STAFF_2_EMAIL    = 'receptionist@brightsmileclinic.in';
const STAFF_2_PASSWORD = 'Staff@Neha2024';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function inv(n) { return `INV-2024-${String(n).padStart(4, '0')}`; }

async function deleteExistingDemo() {
  console.log('🧹  Cleaning up any previous demo data...');
  const { data: existing } = await supabase
    .from('clinics').select('id, owner_id').eq('email', OWNER_EMAIL).maybeSingle();
  if (existing) {
    // Cascading delete will remove patients, appointments, invoices, staff etc.
    await supabase.from('clinics').delete().eq('id', existing.id);
    await supabase.auth.admin.deleteUser(existing.owner_id);
    console.log('   ✅ Old demo clinic removed.');
  }
  // Also remove old staff auth accounts
  const { data: { users } } = await supabase.auth.admin.listUsers();
  for (const u of users) {
    if ([STAFF_1_EMAIL, STAFF_2_EMAIL].includes(u.email)) {
      await supabase.auth.admin.deleteUser(u.id);
    }
  }
}

async function main() {
  console.log('\n🦷  Seeding Bright Smile Dental Clinic (Demo)\n');

  await deleteExistingDemo();

  // ── 1. Create owner auth user ────────────────────────────────────────────────
  console.log('👤  Creating clinic owner auth account...');
  const { data: ownerAuth, error: ownerErr } = await supabase.auth.admin.createUser({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Dr. Arjun Sharma' }
  });
  if (ownerErr) throw new Error('Owner auth: ' + ownerErr.message);
  const ownerId = ownerAuth.user.id;
  console.log(`   ✅ Owner UID: ${ownerId}`);

  // ── 2. Create clinic ─────────────────────────────────────────────────────────
  console.log('🏥  Creating clinic record...');
  const { data: clinic, error: clinicErr } = await supabase
    .from('clinics')
    .insert({
      owner_id: ownerId,
      owner_name: 'Dr. Arjun Sharma',
      name: 'Bright Smile Dental Clinic',
      email: OWNER_EMAIL,
      phone: '+91-98765-43210',
      address: '14, Shivaji Nagar, Pune - 411005, Maharashtra',
      subscription_plan: 'growth',
      is_active: true,
      booking_slug: 'bright-smile-pune',
      appointment_settings: { slot_duration_minutes: 30, auto_approve: false },
      created_at: new Date(Date.now() - 90 * 86400000).toISOString()
    })
    .select().single();
  if (clinicErr) throw new Error('Clinic: ' + clinicErr.message);
  const clinicId = clinic.id;
  console.log(`   ✅ Clinic ID: ${clinicId}`);

  // ── 3. Subscription ──────────────────────────────────────────────────────────
  console.log('💳  Creating subscription...');
  const periodStart = new Date(Date.now() - 15 * 86400000);
  const periodEnd   = new Date(Date.now() + 15 * 86400000);
  await supabase.from('subscriptions').insert({
    clinic_id: clinicId,
    plan: 'growth',
    status: 'active',
    billing_cycle: 'monthly',
    current_period_start: periodStart.toISOString(),
    current_period_end: periodEnd.toISOString(),
  });

  // AI credits
  await supabase.from('clinic_credits').insert({
    clinic_id: clinicId,
    credits_allocated: 500,
    credits_used: 47,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  });
  console.log('   ✅ Subscription: growth/active, 453 AI credits remaining');

  // ── 4. Staff auth accounts + staff rows ──────────────────────────────────────
  console.log('👩‍⚕️  Creating staff members...');

  // Staff 1 — Dentist
  const { data: staff1Auth, error: s1Err } = await supabase.auth.admin.createUser({
    email: STAFF_1_EMAIL,
    password: STAFF_1_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Dr. Priya Mehta' }
  });
  if (s1Err) throw new Error('Staff1 auth: ' + s1Err.message);

  const { data: staffRow1, error: sr1Err } = await supabase.from('staff').insert({
    clinic_id: clinicId,
    auth_id: staff1Auth.user.id,
    name: 'Dr. Priya Mehta',
    role: 'dentist',
    email: STAFF_1_EMAIL,
    phone: '+91-98123-45678',
    specialization: 'Orthodontics & Cosmetic Dentistry',
    joining_date: daysAgo(75),
    is_active: true,
    schedule: {
      monday: ['09:00', '18:00'], tuesday: ['09:00', '18:00'],
      wednesday: ['09:00', '18:00'], thursday: ['09:00', '18:00'],
      friday: ['09:00', '16:00'], saturday: ['10:00', '14:00']
    }
  }).select().single();
  if (sr1Err) throw new Error('Staff row 1: ' + sr1Err.message);
  console.log(`   ✅ Dr. Priya Mehta (dentist) — login: ${STAFF_1_EMAIL}`);

  // Staff 2 — Receptionist
  const { data: staff2Auth, error: s2Err } = await supabase.auth.admin.createUser({
    email: STAFF_2_EMAIL,
    password: STAFF_2_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Neha Kulkarni' }
  });
  if (s2Err) throw new Error('Staff2 auth: ' + s2Err.message);

  const { data: staffRow2, error: sr2Err } = await supabase.from('staff').insert({
    clinic_id: clinicId,
    auth_id: staff2Auth.user.id,
    name: 'Neha Kulkarni',
    role: 'receptionist',
    email: STAFF_2_EMAIL,
    phone: '+91-97654-32109',
    specialization: null,
    joining_date: daysAgo(60),
    is_active: true,
    schedule: {
      monday: ['09:00', '17:00'], tuesday: ['09:00', '17:00'],
      wednesday: ['09:00', '17:00'], thursday: ['09:00', '17:00'],
      friday: ['09:00', '17:00']
    }
  }).select().single();
  if (sr2Err) throw new Error('Staff row 2: ' + sr2Err.message);
  console.log(`   ✅ Neha Kulkarni (receptionist) — login: ${STAFF_2_EMAIL}`);

  // ── 5. Patients ───────────────────────────────────────────────────────────────
  console.log('🧑‍🤝‍🧑  Creating 15 patients...');
  const patientsData = [
    { name: 'Rahul Desai',       phone: '9876543001', email: 'rahul.desai@gmail.com',        dob: '1988-03-14', gender: 'male',   address: '12, Koregaon Park, Pune', notes: 'Allergic to penicillin', is_starred: true,  created_at: daysAgo(80) },
    { name: 'Ananya Joshi',      phone: '9876543002', email: 'ananya.joshi@gmail.com',        dob: '1995-07-22', gender: 'female', address: '5, Baner Road, Pune',     notes: 'Prefers morning slots',   is_starred: true,  created_at: daysAgo(70) },
    { name: 'Vikram Patil',      phone: '9876543003', email: 'vikram.patil@outlook.com',      dob: '1975-11-05', gender: 'male',   address: '8, Hadapsar, Pune',       notes: 'Dental anxiety — handle gently', is_starred: false, created_at: daysAgo(65) },
    { name: 'Sunita Reddy',      phone: '9876543004', email: 'sunita.reddy@yahoo.com',        dob: '1982-01-30', gender: 'female', address: '22, Kothrud, Pune',       notes: null,                      is_starred: false, created_at: daysAgo(60) },
    { name: 'Akash Kulkarni',    phone: '9876543005', email: 'akash.kulkarni@gmail.com',      dob: '2001-09-18', gender: 'male',   address: '3, Viman Nagar, Pune',    notes: 'Student — fee concession applied', is_starred: false, created_at: daysAgo(55) },
    { name: 'Deepa Nair',        phone: '9876543006', email: 'deepa.nair@gmail.com',          dob: '1990-04-25', gender: 'female', address: '45, Aundh, Pune',         notes: 'Braces follow-up patient',is_starred: true,  created_at: daysAgo(50) },
    { name: 'Manish Gupta',      phone: '9876543007', email: 'manish.gupta@hotmail.com',      dob: '1968-12-12', gender: 'male',   address: '7, Shivajinagar, Pune',   notes: 'Diabetic — check BP before treatment', is_starred: false, created_at: daysAgo(45) },
    { name: 'Kavita Singh',      phone: '9876543008', email: 'kavita.singh@gmail.com',        dob: '1993-06-08', gender: 'female', address: '18, Camp, Pune',          notes: null,                      is_starred: false, created_at: daysAgo(42) },
    { name: 'Rohan Mehta',       phone: '9876543009', email: 'rohan.mehta@gmail.com',         dob: '1985-08-20', gender: 'male',   address: '31, Magarpatta, Pune',    notes: 'Corporate discount — TCS employee', is_starred: false, created_at: daysAgo(38) },
    { name: 'Priyanka Shah',     phone: '9876543010', email: 'priyanka.shah@gmail.com',       dob: '1997-02-14', gender: 'female', address: '9, Deccan, Pune',         notes: 'Referred by Ananya Joshi', is_starred: false, created_at: daysAgo(35) },
    { name: 'Suresh Iyer',       phone: '9876543011', email: 'suresh.iyer@rediffmail.com',    dob: '1960-05-05', gender: 'male',   address: '55, Sadashiv Peth, Pune', notes: 'Senior citizen — 10% discount', is_starred: false, created_at: daysAgo(30) },
    { name: 'Meera Pillai',      phone: '9876543012', email: 'meera.pillai@gmail.com',        dob: '1987-10-17', gender: 'female', address: '14, Wakad, Pune',         notes: null,                      is_starred: true,  created_at: daysAgo(25) },
    { name: 'Arjun Bhosale',     phone: '9876543013', email: null,                             dob: '2010-03-21', gender: 'male',   address: '27, Katraj, Pune',        notes: 'Minor — parent: Suhas Bhosale 9900112233', is_starred: false, created_at: daysAgo(20) },
    { name: 'Nisha Wagh',        phone: '9876543014', email: 'nisha.wagh@gmail.com',           dob: '1992-11-29', gender: 'female', address: '6, Kalyani Nagar, Pune',  notes: 'Teeth whitening follow-up', is_starred: false, created_at: daysAgo(15) },
    { name: 'Gaurav Tiwari',     phone: '9876543015', email: 'gaurav.tiwari@gmail.com',        dob: '1978-07-04', gender: 'male',   address: '33, Bibwewadi, Pune',     notes: 'Root canal in progress',  is_starred: false, created_at: daysAgo(10) },
  ];

  const patientRows = patientsData.map(p => ({ ...p, clinic_id: clinicId }));
  const { data: patients, error: patErr } = await supabase
    .from('patients').insert(patientRows).select();
  if (patErr) throw new Error('Patients: ' + patErr.message);
  console.log(`   ✅ ${patients.length} patients created`);

  const p = {}; // map name → id
  patients.forEach(pt => { p[pt.name] = pt.id; });

  // ── 6. Appointments ───────────────────────────────────────────────────────────
  console.log('📅  Creating appointments...');
  const services = ['Routine Checkup', 'Teeth Cleaning', 'Root Canal', 'Tooth Extraction', 'Dental Filling', 'Teeth Whitening', 'Braces Adjustment', 'Crown Fitting', 'X-Ray', 'Consultation'];
  const times    = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00'];

  const apptData = [
    // ── Past completed ──────────────────────────────────────────────────────────
    { patient_id: p['Rahul Desai'],    date: daysAgo(75), time: '10:00', service: 'Routine Checkup',    status: 'completed', notes: 'No major issues found. Scale & polish done.' },
    { patient_id: p['Ananya Joshi'],   date: daysAgo(68), time: '11:00', service: 'Teeth Cleaning',    status: 'completed', notes: 'Plaque buildup on lower molars. Cleaning done.' },
    { patient_id: p['Vikram Patil'],   date: daysAgo(62), time: '09:30', service: 'Dental Filling',    status: 'completed', notes: 'Composite filling on tooth #16.' },
    { patient_id: p['Sunita Reddy'],   date: daysAgo(58), time: '14:00', service: 'Root Canal',        status: 'completed', notes: 'RCT on upper left molar. Session 1 of 2.' },
    { patient_id: p['Akash Kulkarni'], date: daysAgo(52), time: '11:30', service: 'X-Ray',             status: 'completed', notes: 'OPG taken. Wisdom tooth impaction noted.' },
    { patient_id: p['Deepa Nair'],     date: daysAgo(48), time: '15:00', service: 'Braces Adjustment', status: 'completed', notes: 'Wire tightened. Next visit in 3 weeks.' },
    { patient_id: p['Manish Gupta'],   date: daysAgo(44), time: '10:00', service: 'Consultation',      status: 'completed', notes: 'BP checked 130/85. Decided on partial denture plan.' },
    { patient_id: p['Sunita Reddy'],   date: daysAgo(40), time: '14:30', service: 'Root Canal',        status: 'completed', notes: 'RCT session 2. Permanent filling placed.' },
    { patient_id: p['Kavita Singh'],   date: daysAgo(38), time: '09:00', service: 'Teeth Whitening',   status: 'completed', notes: 'In-chair whitening done. 3 shade improvement.' },
    { patient_id: p['Rahul Desai'],    date: daysAgo(35), time: '10:30', service: 'Dental Filling',    status: 'completed', notes: 'Small cavity on #25 filled.' },
    { patient_id: p['Rohan Mehta'],    date: daysAgo(30), time: '16:00', service: 'Tooth Extraction',  status: 'completed', notes: 'Wisdom tooth extraction. Healing good.' },
    { patient_id: p['Priyanka Shah'],  date: daysAgo(28), time: '11:00', service: 'Routine Checkup',   status: 'completed', notes: 'First visit. Good oral hygiene.' },
    { patient_id: p['Suresh Iyer'],    date: daysAgo(25), time: '09:30', service: 'Consultation',      status: 'completed', notes: 'Discussed denture options for missing teeth.' },
    { patient_id: p['Meera Pillai'],   date: daysAgo(22), time: '14:00', service: 'Teeth Cleaning',   status: 'completed', notes: 'Scaling done. Mild gingivitis noted, prescribed mouthwash.' },
    { patient_id: p['Arjun Bhosale'],  date: daysAgo(18), time: '10:00', service: 'Routine Checkup',   status: 'completed', notes: 'Milk tooth examination. All healthy.' },
    { patient_id: p['Nisha Wagh'],     date: daysAgo(14), time: '15:30', service: 'Teeth Whitening',   status: 'completed', notes: 'Whitening trays delivered. Instructions given.' },
    { patient_id: p['Gaurav Tiwari'],  date: daysAgo(10), time: '11:00', service: 'Root Canal',        status: 'completed', notes: 'RCT on lower right molar started. Temp filling placed.' },
    { patient_id: p['Deepa Nair'],     date: daysAgo(7),  time: '16:00', service: 'Braces Adjustment', status: 'completed', notes: 'Elastics changed. Good progress.' },
    // ── No-shows ────────────────────────────────────────────────────────────────
    { patient_id: p['Vikram Patil'],   date: daysAgo(20), time: '10:00', service: 'Crown Fitting',     status: 'no-show',   notes: 'Patient did not show up. Called but unreachable.' },
    { patient_id: p['Manish Gupta'],   date: daysAgo(5),  time: '09:00', service: 'Consultation',      status: 'no-show',   notes: 'Patient cancelled last minute.' },
    // ── Today/recent scheduled ──────────────────────────────────────────────────
    { patient_id: p['Gaurav Tiwari'],  date: daysFromNow(0), time: '11:30', service: 'Root Canal',      status: 'confirmed', notes: 'RCT session 2 — permanent filling.' },
    { patient_id: p['Ananya Joshi'],   date: daysFromNow(0), time: '14:00', service: 'Braces Adjustment', status: 'scheduled', notes: null },
    // ── Upcoming ────────────────────────────────────────────────────────────────
    { patient_id: p['Suresh Iyer'],    date: daysFromNow(2),  time: '10:00', service: 'Crown Fitting',   status: 'scheduled', notes: 'Permanent crown for upper molar.' },
    { patient_id: p['Rahul Desai'],    date: daysFromNow(3),  time: '11:00', service: 'Routine Checkup', status: 'scheduled', notes: '6-month follow-up.' },
    { patient_id: p['Meera Pillai'],   date: daysFromNow(4),  time: '15:00', service: 'Teeth Cleaning',  status: 'scheduled', notes: null },
    { patient_id: p['Priyanka Shah'],  date: daysFromNow(5),  time: '09:30', service: 'Dental Filling',  status: 'scheduled', notes: 'Cavity on #14 to be filled.' },
    { patient_id: p['Kavita Singh'],   date: daysFromNow(7),  time: '16:00', service: 'Teeth Whitening', status: 'scheduled', notes: 'Top-up whitening session.' },
    { patient_id: p['Arjun Bhosale'],  date: daysFromNow(8),  time: '10:30', service: 'Routine Checkup', status: 'scheduled', notes: null },
    // ── Pending approval (from online booking) ───────────────────────────────────
    { patient_id: p['Nisha Wagh'],     date: daysFromNow(4),  time: '11:00', service: 'Consultation',    status: 'pending', notes: 'Wants to discuss implants.' },
    { patient_id: p['Gaurav Tiwari'],  date: daysFromNow(12), time: '14:00', service: 'Root Canal',      status: 'pending', notes: 'Final RCT session + crown fitting.' },
    { patient_id: p['Rohan Mehta'],    date: daysFromNow(6),  time: '10:00', service: 'Consultation',    status: 'pending', notes: 'Post-extraction review requested online.' },
  ];

  const apptInsert = apptData.map(a => ({ ...a, clinic_id: clinicId }));
  const { data: appointments, error: apptErr } = await supabase
    .from('appointments').insert(apptInsert).select();
  if (apptErr) throw new Error('Appointments: ' + apptErr.message);
  console.log(`   ✅ ${appointments.length} appointments created`);

  // ── 7. Treatment Records ─────────────────────────────────────────────────────
  console.log('🦷  Creating treatment records...');
  const completedAppts = appointments.filter(a => a.status === 'completed');

  const treatmentMap = {
    'Routine Checkup':    { procedure: 'Oral Examination & Prophylaxis', cost: 500 },
    'Teeth Cleaning':     { procedure: 'Ultrasonic Scaling & Polishing', cost: 1200 },
    'Root Canal':         { procedure: 'Root Canal Treatment (RCT) — Single Session', cost: 4500 },
    'Tooth Extraction':   { procedure: 'Surgical Tooth Extraction', cost: 1500 },
    'Dental Filling':     { procedure: 'Composite Resin Filling', cost: 1800 },
    'Teeth Whitening':    { procedure: 'In-Office Laser Teeth Whitening', cost: 8000 },
    'Braces Adjustment':  { procedure: 'Orthodontic Braces Wire Adjustment', cost: 800 },
    'Crown Fitting':      { procedure: 'Ceramic Crown Fitting & Cementation', cost: 6000 },
    'X-Ray':              { procedure: 'Orthopantomogram (OPG) X-Ray', cost: 600 },
    'Consultation':       { procedure: 'Dental Consultation & Treatment Planning', cost: 300 },
  };

  const prescriptionTemplates = {
    'Root Canal':       'Tab Amoxicillin 500mg TDS x 5 days\nTab Ibuprofen 400mg TDS x 3 days\nClove oil for pain relief',
    'Tooth Extraction': 'Tab Metronidazole 400mg TDS x 5 days\nTab Diclofenac 50mg BD x 3 days\nSalt water rinse 3x daily',
    'Dental Filling':   'No specific medications. Avoid hard food for 24 hours.',
    'Teeth Cleaning':   'Chlorhexidine mouthwash 0.2% twice daily for 7 days',
  };

  const treatmentInserts = completedAppts.map(a => {
    const t = treatmentMap[a.service] || { procedure: a.service, cost: 1000 };
    return {
      clinic_id: clinicId,
      patient_id: a.patient_id,
      appointment_id: a.id,
      procedure: t.procedure,
      notes: `Treatment completed successfully on ${a.date}.`,
      prescription: prescriptionTemplates[a.service] || null,
      tooth_number: ['Root Canal', 'Dental Filling', 'Tooth Extraction', 'Crown Fitting'].includes(a.service)
        ? rnd(['#14', '#16', '#25', '#36', '#37', '#46', '#47']) : null,
      cost: t.cost,
      created_at: new Date(a.date + 'T' + a.time).toISOString()
    };
  });

  const { data: treatments, error: tErr } = await supabase
    .from('treatment_records').insert(treatmentInserts).select();
  if (tErr) throw new Error('Treatments: ' + tErr.message);
  console.log(`   ✅ ${treatments.length} treatment records created`);

  // ── 8. Invoices ───────────────────────────────────────────────────────────────
  console.log('🧾  Creating invoices...');
  const invoiceData = [];
  let invNum = 1;

  completedAppts.forEach(a => {
    const t = treatmentMap[a.service] || { procedure: a.service, cost: 1000 };
    const amount = t.cost;
    const tax = parseFloat((amount * 0.18).toFixed(2));
    const total = parseFloat((amount + tax).toFixed(2));
    const isPaid = a.date < daysAgo(7); // older than 7 days are paid
    const methods = ['cash', 'upi', 'card'];

    invoiceData.push({
      clinic_id: clinicId,
      patient_id: a.patient_id,
      appointment_id: a.id,
      invoice_number: inv(invNum++),
      items: JSON.stringify([{
        description: t.procedure,
        quantity: 1,
        unit_price: amount,
        total: amount
      }]),
      amount,
      tax_rate: 18,
      tax_amount: tax,
      total_amount: total,
      status: isPaid ? 'paid' : 'unpaid',
      payment_method: isPaid ? rnd(methods) : null,
      due_date: isPaid ? null : daysFromNow(7),
      paid_at: isPaid ? new Date(a.date + 'T16:00:00').toISOString() : null,
      notes: null,
      created_at: new Date(a.date + 'T' + a.time).toISOString()
    });
  });

  const { data: invoices, error: invErr } = await supabase
    .from('invoices').insert(invoiceData).select();
  if (invErr) throw new Error('Invoices: ' + invErr.message);

  const paidCount   = invoices.filter(i => i.status === 'paid').length;
  const unpaidCount = invoices.filter(i => i.status === 'unpaid').length;
  const totalRev    = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + parseFloat(i.total_amount), 0);
  console.log(`   ✅ ${invoices.length} invoices (${paidCount} paid, ${unpaidCount} unpaid)`);
  console.log(`   💰 Total revenue: ₹${totalRev.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);

  // ── Done ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('🎉  DEMO CLINIC SEEDED SUCCESSFULLY!\n');
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│              BRIGHT SMILE DENTAL CLINIC                 │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│  CLINIC OWNER (Admin)                                   │');
  console.log(`│  Email   : ${OWNER_EMAIL.padEnd(45)} │`);
  console.log(`│  Password: ${OWNER_PASSWORD.padEnd(45)} │`);
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│  STAFF ACCOUNT #1 — Dentist                             │');
  console.log(`│  Email   : ${STAFF_1_EMAIL.padEnd(45)} │`);
  console.log(`│  Password: ${STAFF_1_PASSWORD.padEnd(45)} │`);
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│  STAFF ACCOUNT #2 — Receptionist                        │');
  console.log(`│  Email   : ${STAFF_2_EMAIL.padEnd(45)} │`);
  console.log(`│  Password: ${STAFF_2_PASSWORD.padEnd(45)} │`);
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│  SUMMARY                                                │');
  console.log(`│  Patients    : 15                                       │`);
  console.log(`│  Appointments: ${String(appointments.length).padEnd(44)} │`);
  console.log(`│  Invoices    : ${String(invoices.length).padEnd(44)} │`);
  console.log(`│  Revenue     : ₹${totalRev.toLocaleString('en-IN').padEnd(43)} │`);
  console.log('└─────────────────────────────────────────────────────────┘\n');
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  process.exit(1);
});
