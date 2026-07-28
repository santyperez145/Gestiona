-- ============================================================================
-- fx_rates: cotizaciones por par de monedas y tipo (oficial/blue/MEP…)
-- ============================================================================
-- `exchange_rates` guarda UNA fila por fecha con columnas por moneda
-- (usd_ars, eur_ars, brl_ars) y la usa el resto de la app (Dashboard,
-- CurrencyHistoryTab). MultiCurrencyPage necesita un modelo distinto:
-- una fila por par de monedas y tipo de cotización, con historial.
-- Se crea aparte para no romper la tabla existente.

CREATE TABLE IF NOT EXISTS public.fx_rates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  currency_from TEXT NOT NULL,
  currency_to   TEXT NOT NULL DEFAULT 'ARS',
  rate          NUMERIC(18,6) NOT NULL,
  rate_type     TEXT NOT NULL DEFAULT 'custom',
  source        TEXT NOT NULL DEFAULT 'manual',
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_lookup
  ON public.fx_rates(org_id, currency_from, rate_type, valid_from DESC);

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org read fx_rates" ON public.fx_rates;
CREATE POLICY "org read fx_rates" ON public.fx_rates FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "admin write fx_rates" ON public.fx_rates;
CREATE POLICY "admin write fx_rates" ON public.fx_rates FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- PlatformAdminPage espera `features` en los planes SaaS (aditivo).
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS features text[] NOT NULL DEFAULT '{}'::text[];
