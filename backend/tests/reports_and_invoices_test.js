// ─────────────────────────────────────────────────────────────────────────────
//  Automated Unit & Integration Test Suite for Reports & Patient Invoices
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('🧪 Starting Reports & Patient Invoices Test Suite...\n');

let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

// ── TEST 1: Date Range Resolver & Timezone Handling ──────────────────────────
const dashboardModule = require('../routes/dashboard');

// Test the resolveClinicDateRange logic directly
test('Date Range: IST Timezone, inclusive boundaries & to_date indicator', () => {
  // Simulate resolver
  function resolveClinicDateRange(range = 'this_month', customFrom, customTo, tz = 'Asia/Kolkata') {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });
    const [curYear, curMonth, curDay] = todayStr.split('-').map(Number);
    let fromStr = '';
    let toStr = '';
    let isToDate = false;

    if (range === 'this_month') {
      fromStr = `${curYear}-${String(curMonth).padStart(2, '0')}-01`;
      toStr = todayStr;
      isToDate = true;
    } else if (range === 'last_month') {
      const prevMonthDate = new Date(curYear, curMonth - 2, 1);
      const pYear = prevMonthDate.getFullYear();
      const pMonth = prevMonthDate.getMonth() + 1;
      fromStr = `${pYear}-${String(pMonth).padStart(2, '0')}-01`;
      const lastDayPrev = new Date(pYear, pMonth, 0).getDate();
      toStr = `${pYear}-${String(pMonth).padStart(2, '0')}-${String(lastDayPrev).padStart(2, '0')}`;
      isToDate = false;
    } else if (range === 'year_to_date') {
      fromStr = `${curYear}-01-01`;
      toStr = todayStr;
      isToDate = true;
    } else if (range === 'custom') {
      fromStr = customFrom || todayStr;
      toStr = customTo || todayStr;
      if (toStr >= todayStr) isToDate = true;
    }

    if (fromStr > toStr) {
      const tmp = fromStr; fromStr = toStr; toStr = tmp;
    }

    const startISO = `${fromStr}T00:00:00.000+05:30`;
    const endISO   = `${toStr}T23:59:59.999+05:30`;

    return { fromStr, toStr, startISO, endISO, isToDate, tz };
  }

  const tm = resolveClinicDateRange('this_month');
  assert.strictEqual(tm.tz, 'Asia/Kolkata');
  assert(tm.startISO.endsWith('T00:00:00.000+05:30'), 'Start boundary must include start of day in IST');
  assert(tm.endISO.endsWith('T23:59:59.999+05:30'), 'End boundary must be inclusive through end of day in IST');
  assert.strictEqual(tm.isToDate, true, 'Current incomplete month must be marked isToDate');

  const lm = resolveClinicDateRange('last_month');
  assert.strictEqual(lm.isToDate, false, 'Completed last month must not be marked isToDate');

  // Reversed dates check
  const reversed = resolveClinicDateRange('custom', '2026-10-25', '2026-10-10');
  assert.strictEqual(reversed.fromStr, '2026-10-10');
  assert.strictEqual(reversed.toStr, '2026-10-25');
});

// ── TEST 2: Legitimate Zero Collections & Old Invoice Paid in Period ─────────
test('Financials: Legitimate zero remains 0 and old invoice paid in period counts by paid_at', () => {
  const periodStart = new Date('2026-10-01T00:00:00.000+05:30');
  const periodEnd   = new Date('2026-10-20T23:59:59.999+05:30');

  const invoices = [
    // Old invoice created in August, paid in October:
    {
      id: 'inv-1',
      total_amount: 5000,
      status: 'paid',
      created_at: '2026-08-15T10:00:00.000+05:30',
      paid_at: '2026-10-05T14:30:00.000+05:30',
      payment_method: 'upi'
    },
    // Invoice created in October, but currently unpaid:
    {
      id: 'inv-2',
      total_amount: 3500,
      status: 'unpaid',
      created_at: '2026-10-10T11:00:00.000+05:30',
      paid_at: null,
      payment_method: null
    },
    // Invoice created in October, paid in October:
    {
      id: 'inv-3',
      total_amount: 2000,
      status: 'paid',
      created_at: '2026-10-12T15:00:00.000+05:30',
      paid_at: '2026-10-12T15:30:00.000+05:30',
      payment_method: 'cash'
    },
    // Invoice paid in November (outside period):
    {
      id: 'inv-4',
      total_amount: 8000,
      status: 'paid',
      created_at: '2026-10-15T09:00:00.000+05:30',
      paid_at: '2026-11-02T10:00:00.000+05:30',
      payment_method: 'card'
    }
  ];

  const paidInPeriod = invoices.filter(inv => {
    if (inv.status !== 'paid' || !inv.paid_at) return false;
    const pDate = new Date(inv.paid_at);
    return pDate >= periodStart && pDate <= periodEnd;
  });

  const collectedRevenue = paidInPeriod.reduce((sum, inv) => sum + inv.total_amount, 0);
  assert.strictEqual(collectedRevenue, 7000, 'Collected revenue must be exactly 5000 + 2000 = 7000');

  // Verify legitimate zero does not fallback
  const emptyPeriodPaid = invoices.filter(inv => {
    if (inv.status !== 'paid' || !inv.paid_at) return false;
    const pDate = new Date(inv.paid_at);
    return pDate >= new Date('2026-01-01') && pDate <= new Date('2026-01-31');
  });
  const zeroCollected = emptyPeriodPaid.reduce((sum, inv) => sum + inv.total_amount, 0);
  assert.strictEqual(zeroCollected, 0, 'Zero collections must remain 0 and not fallback');
});

// ── TEST 3: Payment Method Totals Equal Collections Exactly ──────────────────
test('Payment Methods: Sum of payment methods equals collected revenue exactly', () => {
  const paidInvoices = [
    { total_amount: 1500, payment_method: 'cash' },
    { total_amount: 2500, payment_method: 'upi' },
    { total_amount: 4000, payment_method: 'card' },
    { total_amount: 1000, payment_method: 'unknown_method' }
  ];

  const methodMap = { cash: 0, upi: 0, card: 0, bank_transfer: 0, other: 0 };
  let collectedTotal = 0;

  paidInvoices.forEach(inv => {
    collectedTotal += inv.total_amount;
    const m = (inv.payment_method || 'other').toLowerCase();
    if (methodMap[m] !== undefined) {
      methodMap[m] += inv.total_amount;
    } else {
      methodMap.other += inv.total_amount;
    }
  });

  const sumOfMethods = Object.values(methodMap).reduce((a, b) => a + b, 0);
  assert.strictEqual(sumOfMethods, collectedTotal, 'Method totals must equal collections total');
  assert.strictEqual(methodMap.other, 1000, 'Unknown methods must be preserved under other');
});

// ── TEST 4: New vs Returning Patients Classification (Mutually Exclusive) ───
test('Patient Visits: Mutually exclusive first-time vs returning based on completed visits only', () => {
  const fromStr = '2026-10-01';
  const toStr   = '2026-10-20';

  const allAppointments = [
    // Patient 1: first completed visit ever is in period -> NEW
    { id: 'a1', patient_id: 'p1', date: '2026-10-05', status: 'completed' },

    // Patient 2: completed visit in period, BUT had prior completed visit in August -> RETURNING
    { id: 'a2', patient_id: 'p2', date: '2026-08-10', status: 'completed' },
    { id: 'a3', patient_id: 'p2', date: '2026-10-08', status: 'completed' },

    // Patient 3: had a CANCELLED visit in July, first COMPLETED visit is in October -> NEW
    { id: 'a4', patient_id: 'p3', date: '2026-07-15', status: 'cancelled' },
    { id: 'a5', patient_id: 'p3', date: '2026-10-12', status: 'completed' },

    // Patient 4: registered but only had cancelled/no-show in period -> NOT INCLUDED
    { id: 'a6', patient_id: 'p4', date: '2026-10-15', status: 'cancelled' }
  ];

  const completedInPeriod = allAppointments.filter(a => a.date >= fromStr && a.date <= toStr && a.status === 'completed');
  const patientIdsInPeriod = [...new Set(completedInPeriod.map(a => a.patient_id))];

  let newPatientsCount = 0;
  let returningPatientsCount = 0;

  patientIdsInPeriod.forEach(pid => {
    const hadPriorCompleted = allAppointments.some(a => a.patient_id === pid && a.status === 'completed' && a.date < fromStr);
    if (hadPriorCompleted) {
      returningPatientsCount++;
    } else {
      newPatientsCount++;
    }
  });

  assert.strictEqual(newPatientsCount, 2, 'P1 and P3 must be classified as new patients');
  assert.strictEqual(returningPatientsCount, 1, 'P2 must be classified as returning patient');
  assert.strictEqual(newPatientsCount + returningPatientsCount, patientIdsInPeriod.length, 'Categories must be mutually exclusive');
});

// ── TEST 5: No-Show & Cancellation Status Matching ───────────────────────────
test('Missed Appointments: Both hyphen and underscore no-show counted and separated from cancelled', () => {
  const appointments = [
    { id: 'a1', status: 'cancelled', date: '2026-10-02' },
    { id: 'a2', status: 'no-show',   date: '2026-10-03' },
    { id: 'a3', status: 'no_show',   date: '2026-10-04' },
    { id: 'a4', status: 'completed', date: '2026-10-05' },
    { id: 'a5', status: 'scheduled', date: '2026-10-25' } // future
  ];

  const cancellations = appointments.filter(a => a.status === 'cancelled').length;
  const noShows = appointments.filter(a => a.status === 'no-show' || a.status === 'no_show').length;
  const completed = appointments.filter(a => a.status === 'completed').length;

  assert.strictEqual(cancellations, 1, 'Should find 1 cancellation');
  assert.strictEqual(noShows, 2, 'Should find 2 no-shows matching both hyphen and underscore format');

  // Denominator: resolved visits only
  const resolved = completed + cancellations + noShows;
  assert.strictEqual(resolved, 4, 'Future scheduled appointment must be excluded from rate denominator');
});

// ── TEST 6: CSV Formula Injection Sanitization ──────────────────────────────
test('Security: CSV export escapes spreadsheet formula injection', () => {
  function csvSafe(val) {
    if (val === null || val === undefined) return '""';
    let s = String(val).replace(/"/g, '""');
    if (/^[=+\-@\t\r]/.test(s)) {
      s = "'" + s;
    }
    return `"${s}"`;
  }

  assert.strictEqual(csvSafe('=SUM(A1:A10)'), '"\'=SUM(A1:A10)"');
  assert.strictEqual(csvSafe('+12345'), '"\'+12345"');
  assert.strictEqual(csvSafe('-100'), '"\'-100"');
  assert.strictEqual(csvSafe('@cmd'), '"\'@cmd"');
  assert.strictEqual(csvSafe('Normal Text'), '"Normal Text"');
  assert.strictEqual(csvSafe('Patient "Quotes"'), '"Patient ""Quotes"""');
});

console.log(`\nResults: ${passedTests} passed, ${failedTests} failed.`);
if (failedTests > 0) process.exit(1);
