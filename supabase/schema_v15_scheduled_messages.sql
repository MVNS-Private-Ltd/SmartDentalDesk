-- ─────────────────────────────────────────────────────────────────────────────
--  Schema v15 — Scheduled Messages
--  Allows clinics to schedule patient emails for a future date/time.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists scheduled_messages (
  id               uuid        primary key default gen_random_uuid(),
  clinic_id        uuid        not null references clinics(id) on delete cascade,
  patient_id       uuid        references patients(id) on delete set null,

  -- Recipient info (stored at creation time in case patient record changes)
  recipient_name   text        not null,
  recipient_email  text        not null,

  -- Message content
  subject          text        not null,
  body             text        not null,

  -- Scheduling
  scheduled_at     timestamptz not null,   -- when to send (UTC)

  -- Status lifecycle: pending → sent | failed | cancelled
  status           text        not null default 'pending'
                               check (status in ('pending', 'sent', 'failed', 'cancelled')),

  -- Result tracking
  sent_at          timestamptz,
  error_message    text,
  resend_message_id text,

  -- Audit
  created_by       uuid        references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Index for the cron job: find all pending messages due right now
create index if not exists idx_scheduled_messages_cron
  on scheduled_messages (status, scheduled_at)
  where status = 'pending';

-- Per-clinic listing
create index if not exists idx_scheduled_messages_clinic
  on scheduled_messages (clinic_id, created_at desc);

-- RLS
alter table scheduled_messages enable row level security;

create policy "Clinic staff can manage their own scheduled messages"
  on scheduled_messages for all
  using  (clinic_id = (select clinic_id from staff where auth_id = auth.uid() limit 1))
  with check (clinic_id = (select clinic_id from staff where auth_id = auth.uid() limit 1));
