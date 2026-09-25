-- ─────────────────────────────────────────────────────────────────────────────
-- schema_v19_crm.sql
-- MVP CRM layer (leads, campaigns, campaign_logs)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.leads (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    source TEXT DEFAULT 'website', -- website, whatsapp, manual
    status TEXT DEFAULT 'new',     -- new, contacted, converted, lost
    assigned_to UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- reminder, newsletter, birthday
    status TEXT DEFAULT 'active', -- active, draft, completed
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.campaign_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
    channel TEXT NOT NULL, -- email, whatsapp, sms
    status TEXT NOT NULL,  -- sent, failed, delivered, bounced
    message_id TEXT,       -- external ID (e.g. from Twilio or Mailgun)
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_leads_clinic_id ON public.leads(clinic_id);
CREATE INDEX idx_campaigns_clinic_id ON public.campaigns(clinic_id);
CREATE INDEX idx_campaign_logs_clinic_id ON public.campaign_logs(clinic_id);
CREATE INDEX idx_campaign_logs_campaign_id ON public.campaign_logs(campaign_id);

-- Apply RLS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for leads" ON public.leads FOR ALL TO authenticated USING (clinic_id IN (SELECT get_user_clinics(auth.uid()))) WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));
CREATE POLICY "Tenant isolation for campaigns" ON public.campaigns FOR ALL TO authenticated USING (clinic_id IN (SELECT get_user_clinics(auth.uid()))) WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));
CREATE POLICY "Tenant isolation for campaign_logs" ON public.campaign_logs FOR ALL TO authenticated USING (clinic_id IN (SELECT get_user_clinics(auth.uid()))) WITH CHECK (clinic_id IN (SELECT get_user_clinics(auth.uid())));
