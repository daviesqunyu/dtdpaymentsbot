-- Allow telegram channel for console messaging (SMS alternative)
alter table public.smtp_jobs drop constraint if exists smtp_jobs_channel_check;
alter table public.smtp_jobs
  add constraint smtp_jobs_channel_check
  check (channel in ('email', 'sms', 'telegram'));
