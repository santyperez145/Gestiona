-- AFIP Facturación Electrónica
-- Adds credential fields to settings and authorization fields to invoices.

-- ── Settings: AFIP credentials per org ────────────────────────────────────────
alter table public.settings
  add column if not exists afip_cuit            text,
  add column if not exists afip_razon_social     text,
  add column if not exists afip_domicilio        text,
  add column if not exists afip_punto_venta      integer default 1,
  add column if not exists afip_environment      text    default 'homologacion',
  add column if not exists afip_tipo_emisor      text    default 'monotributo',
  add column if not exists afip_certificate      text,   -- PEM X.509 cert
  add column if not exists afip_private_key      text,   -- PEM RSA private key
  add column if not exists afip_ta_token         text,   -- cached TA token
  add column if not exists afip_ta_sign          text,   -- cached TA sign
  add column if not exists afip_ta_expires_at    timestamptz;

-- ── Invoices: CAE / AFIP authorization data ──────────────────────────────────
alter table public.invoices
  add column if not exists tipo_comprobante  integer,
  add column if not exists cae               text,
  add column if not exists cae_vencimiento   date,
  add column if not exists afip_status       text default 'not_applicable',
  add column if not exists afip_error        text,
  add column if not exists numero_afip       integer;

-- Valid values for reference:
-- tipo_comprobante: 1=Factura A, 6=Factura B, 11=Factura C
-- afip_status: 'not_applicable' | 'pending' | 'authorized' | 'rejected'
