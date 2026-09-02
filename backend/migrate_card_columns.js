const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/.env' });

const uri = process.env.DATABASE_URL;

const client = new Client({
  connectionString: uri,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL!');

    const query = `
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS card_last4 TEXT;
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS card_brand TEXT;
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS card_exp_month TEXT;
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS card_exp_year TEXT;
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cardholder_name TEXT;
      
      -- Subscription Invoices / Receipts Table
      CREATE TABLE IF NOT EXISTS subscription_invoices (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
        invoice_number TEXT NOT NULL,
        plan TEXT NOT NULL,
        amount_paise INTEGER NOT NULL,
        currency TEXT DEFAULT 'INR',
        status TEXT DEFAULT 'paid',
        payment_method TEXT DEFAULT 'card',
        card_last4 TEXT,
        billing_period_start TIMESTAMPTZ,
        billing_period_end TIMESTAMPTZ,
        pdf_url TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `;

    await client.query(query);
    console.log('Successfully added card columns and subscription_invoices table!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await client.end();
  }
}

run();
