-- ============================================================================
-- Tablas/funciones operativas restantes que el código usaba sin existir
-- ============================================================================
-- Cierra la auditoría de .from()/.rpc(): integraciones (API keys, webhooks),
-- BI (reportes guardados, snapshots), OCR de facturas, multi-divisa,
-- la vista sale_items y 3 funciones.

-- ── Integraciones: API keys ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  key_prefix     TEXT NOT NULL,
  key_hash       TEXT NOT NULL,
  environment    TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('production','sandbox')),
  scopes         TEXT[] NOT NULL DEFAULT '{}',
  rate_limit_rpm INTEGER NOT NULL DEFAULT 1000,
  last_used_at   TIMESTAMPTZ,
  request_count  INTEGER NOT NULL DEFAULT 0,
  revoked_at     TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Integraciones: webhooks salientes ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  event_types     TEXT[] NOT NULL DEFAULT '{}',
  active          BOOLEAN NOT NULL DEFAULT true,
  secret_header   TEXT,
  secret_value    TEXT,
  retry_on_fail   BOOLEAN NOT NULL DEFAULT true,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  timeout_seconds INTEGER NOT NULL DEFAULT 10,
  last_fired_at   TIMESTAMPTZ,
  success_count   INTEGER NOT NULL DEFAULT 0,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── BI: reportes guardados y snapshots diarios ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.saved_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  report_type  TEXT NOT NULL DEFAULT 'custom',
  chart_type   TEXT NOT NULL DEFAULT 'bar',
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_pinned    BOOLEAN NOT NULL DEFAULT false,
  is_shared    BOOLEAN NOT NULL DEFAULT false,
  run_count    INTEGER NOT NULL DEFAULT 0,
  last_run_at  TIMESTAMPTZ,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bi_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  snapshot_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  revenue_day       NUMERIC(14,2) NOT NULL DEFAULT 0,
  orders_day        INTEGER NOT NULL DEFAULT 0,
  avg_order_value   NUMERIC(14,2) NOT NULL DEFAULT 0,
  new_customers     INTEGER NOT NULL DEFAULT 0,
  total_stock_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  low_stock_count   INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, snapshot_date)
);

-- ── OCR de facturas de compra ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ocr_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  uploaded_by   UUID,
  filename      TEXT NOT NULL,
  file_url      TEXT,
  file_size     BIGINT,
  mime_type     TEXT,
  ocr_status    TEXT NOT NULL DEFAULT 'pending'
                CHECK (ocr_status IN ('pending','processing','done','failed')),
  ocr_provider  TEXT,
  confidence    NUMERIC(5,2),
  extracted     JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ocr_line_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES public.ocr_documents(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_name    TEXT NOT NULL DEFAULT '',
  sku             TEXT,
  quantity        NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_cost       NUMERIC(14,4) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(6,3) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Multi-divisa ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.multi_currency_transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type          TEXT NOT NULL DEFAULT 'sale',
  entity_id            UUID,
  base_currency        TEXT NOT NULL DEFAULT 'ARS',
  transaction_currency TEXT NOT NULL DEFAULT 'USD',
  base_amount          NUMERIC(16,2) NOT NULL DEFAULT 0,
  transaction_amount   NUMERIC(16,2) NOT NULL DEFAULT 0,
  exchange_rate        NUMERIC(16,6) NOT NULL DEFAULT 1,
  rate_type            TEXT NOT NULL DEFAULT 'oficial',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fx_exposure (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  currency_code   TEXT NOT NULL,
  receivables_fc  NUMERIC(16,2) NOT NULL DEFAULT 0,
  payables_fc     NUMERIC(16,2) NOT NULL DEFAULT 0,
  spot_rate       NUMERIC(16,6) NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, snapshot_date, currency_code)
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_api_keys_org   ON public.api_keys(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhooks_org   ON public.webhook_configs(org_id, active);
CREATE INDEX IF NOT EXISTS idx_saved_rep_org  ON public.saved_reports(org_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_bi_snap_org    ON public.bi_snapshots(org_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_ocr_docs_org   ON public.ocr_documents(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcx_org        ON public.multi_currency_transactions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fx_exp_org     ON public.fx_exposure(org_id, snapshot_date DESC);

DROP TRIGGER IF EXISTS trg_webhooks_updated ON public.webhook_configs;
CREATE TRIGGER trg_webhooks_updated BEFORE UPDATE ON public.webhook_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'api_keys','webhook_configs','saved_reports','bi_snapshots',
    'ocr_documents','ocr_line_items','multi_currency_transactions','fx_exposure'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "org read %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "org read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "admin write %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "admin write %1$s" ON public.%1$I FOR ALL TO authenticated USING (public.has_org_role(org_id, auth.uid(), ARRAY[''owner'',''admin''])) WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY[''owner'',''admin'']))', t);
  END LOOP;
END $$;

-- ── Vista sale_items ────────────────────────────────────────────────────────
-- En este esquema cada fila de `sales` YA es una línea de venta (un producto),
-- así que sale_items es una vista sobre sales. security_invoker respeta la RLS
-- de sales para quien consulta.
CREATE OR REPLACE VIEW public.sale_items
WITH (security_invoker = true) AS
SELECT
  s.id            AS id,
  s.id            AS sale_id,
  s.org_id        AS org_id,
  s.product_id    AS product_id,
  s.product_name  AS product_name,
  s.quantity      AS quantity,
  s.unit_price_ars AS unit_price,
  s.total_ars     AS total_price,
  s.date          AS date,
  s.created_at    AS created_at
FROM public.sales s;

GRANT SELECT ON public.sale_items TO authenticated;

-- ── Funciones ───────────────────────────────────────────────────────────────
-- Marca vencidos los lotes cuya fecha ya pasó; devuelve cuántos actualizó.
CREATE OR REPLACE FUNCTION public.expire_batches(p_org_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.product_batches
     SET status = 'expired'
   WHERE org_id = p_org_id
     AND status = 'active'
     AND expiry_date IS NOT NULL
     AND expiry_date < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Carga los motivos de devolución por defecto (idempotente).
CREATE OR REPLACE FUNCTION public.seed_return_reasons(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO public.return_reasons (org_id, name, requires_photo)
  SELECT p_org_id, r.name, r.photo
  FROM (VALUES
    ('Producto defectuoso', true),
    ('No es lo que esperaba', false),
    ('Llegó dañado', true),
    ('Producto equivocado', true),
    ('Se arrepintió de la compra', false)
  ) AS r(name, photo)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.return_reasons rr
    WHERE rr.org_id = p_org_id AND rr.name = r.name
  );
END;
$$;

-- Resumen de auditoría por entidad/acción en un rango.
CREATE OR REPLACE FUNCTION public.get_audit_summary(p_org_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (entity_type text, action text, event_count bigint, unique_users bigint, last_event timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.entity_type, a.action,
         count(*)::bigint            AS event_count,
         count(DISTINCT a.user_id)::bigint AS unique_users,
         max(a.created_at)           AS last_event
  FROM public.audit_logs a
  WHERE a.org_id = p_org_id
    AND a.created_at >= p_from
    AND a.created_at <= p_to
    AND public.is_org_member(p_org_id, auth.uid())
  GROUP BY a.entity_type, a.action
  ORDER BY count(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.expire_batches(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_return_reasons(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_summary(uuid, timestamptz, timestamptz) TO authenticated;
