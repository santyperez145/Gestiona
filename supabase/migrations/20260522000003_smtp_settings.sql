-- Session 47: SMTP settings columns on settings table
-- 2026-05-22
-- Moves SMTP config from localStorage to DB so edge functions can access it server-side.

alter table settings
  add column if not exists smtp_host       text,
  add column if not exists smtp_port       integer default 587,
  add column if not exists smtp_user       text,
  add column if not exists smtp_pass       text,
  add column if not exists smtp_secure     boolean default false,
  add column if not exists smtp_from_name  text,
  add column if not exists smtp_from_email text;
