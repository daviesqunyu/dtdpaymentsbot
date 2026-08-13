-- SMTP Console Tables
-- Run this in your Supabase SQL Editor

-- SMTP jobs table (tracks email/SMS send jobs)
CREATE TABLE IF NOT EXISTS public.smtp_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL DEFAULT 'email', -- 'email' or 'sms'
  recipients TEXT,
  recipient_count INTEGER DEFAULT 0,
  subject TEXT,
  body_preview TEXT,
  status TEXT NOT NULL DEFAULT 'queued', -- queued, sending, sent, failed, partial
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OTP messages table (for SMS OTP inbox)
CREATE TABLE IF NOT EXISTS public.otp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender TEXT,
  recipient TEXT,
  message TEXT,
  otp TEXT,
  label TEXT,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.smtp_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_messages ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by Pages Functions)
CREATE POLICY "Service role full access on smtp_jobs"
  ON public.smtp_jobs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on otp_messages"
  ON public.otp_messages FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Index for faster queries
CREATE INDEX IF NOT EXISTS smtp_jobs_created_at_idx ON public.smtp_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS otp_messages_received_at_idx ON public.otp_messages (received_at DESC);