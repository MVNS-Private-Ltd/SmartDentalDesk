-- ─────────────────────────────────────────────────────────────────────────────
--  Smart Dental Desk — Supabase PostgreSQL Schema
--  Run this in the Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Clinics table (Root tenant)
CREATE TABLE clinics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id) NOT NULL,
  owner_name TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  subscription_plan TEXT DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Patients table
CREATE TABLE patients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  dob DATE,
  gender TEXT,
  address TEXT,
  notes TEXT,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(clinic_id, phone)
);

-- 3. Appointments table
CREATE TABLE appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  service TEXT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in-progress', 'completed', 'cancelled', 'no-show')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Treatment Records table
CREATE TABLE treatment_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  procedure TEXT NOT NULL,
  notes TEXT,
  prescription TEXT,
  tooth_number TEXT,
  photos JSONB DEFAULT '[]'::jsonb,
  cost NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Invoices table
CREATE TABLE invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  items JSONB NOT NULL, -- [{ description, quantity, unit_price, total }]
  amount NUMERIC(10, 2) NOT NULL,
  tax_rate NUMERIC(5, 2) DEFAULT 0,
  tax_amount NUMERIC(10, 2) DEFAULT 0,
  total_amount NUMERIC(10, 2) NOT NULL,
  status TEXT DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'cancelled', 'refunded')),
  payment_method TEXT,
  due_date DATE,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Staff table
CREATE TABLE staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('dentist', 'hygienist', 'receptionist', 'assistant', 'manager', 'other')),
  email TEXT,
  phone TEXT,
  schedule JSONB, -- e.g. { "monday": ["09:00", "17:00"] }
  specialization TEXT,
  joining_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Note: We are using a server-side only API architecture (Express handles everything).
-- We do NOT need to enable Row Level Security (RLS) policies for browser access, 
-- because the frontend will talk to our Express backend, which uses the service_role key.
