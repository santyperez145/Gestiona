-- Session 41: MercadoLibre marketplace + Shopify integration columns
-- 2026-05-23
-- Stores OAuth tokens / API keys for third-party marketplace connections.

alter table settings
  add column if not exists ml_access_token  text,
  add column if not exists ml_refresh_token text,
  add column if not exists ml_user_id       text,
  add column if not exists ml_enabled       boolean default false,
  add column if not exists shopify_store_url text,
  add column if not exists shopify_api_key  text,
  add column if not exists shopify_api_secret text,
  add column if not exists shopify_enabled  boolean default false;
