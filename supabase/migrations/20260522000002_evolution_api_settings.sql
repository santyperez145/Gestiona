-- Session 46: Evolution API columns on settings table
-- 2026-05-22

alter table settings
  add column if not exists evolution_api_url  text,
  add column if not exists evolution_api_key  text,
  add column if not exists evolution_instance text default 'gestiona';
