-- G6 / Serie temporal de riesgo de abandono.
--
-- `platform_org_health` calcula una fotografía útil para actuar hoy, pero al
-- recalcular ventanas móviles no conserva si el riesgo subía o bajaba. Esta
-- migración guarda una observación diaria factual desde hoy: no rellena días
-- anteriores con una historia inventada.

-- Fuente interna sin el filtro de staff. No se concede a ningún rol de cliente:
-- la vista pública de salud y el capturador privilegiado la reutilizan para que
-- las reglas de señal tengan una única definición.
CREATE OR REPLACE VIEW public.platform_org_health_source AS
WITH tx AS (
  SELECT
    org_id,
    SUM(gross_amount) FILTER (WHERE created_at >= now() - interval '30 days') AS gmv_30d,
    SUM(gross_amount) FILTER (
      WHERE created_at >= now() - interval '60 days'
        AND created_at < now() - interval '30 days'
    ) AS gmv_prev_30d,
    SUM(platform_fee) FILTER (WHERE created_at >= now() - interval '30 days') AS comision_30d,
    SUM(platform_fee) AS comision_total,
    SUM(gross_amount) AS gmv_total,
    COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days') AS cobros_30d,
    COUNT(*) AS cobros_total,
    MAX(created_at) AS ultimo_cobro,
    MIN(created_at) AS primer_cobro
  FROM public.payment_transactions
  WHERE status = 'approved'
  GROUP BY org_id
), conteos AS (
  SELECT
    o.id AS org_id,
    (SELECT count(*) FROM public.memberships m WHERE m.org_id = o.id) AS miembros,
    (SELECT count(*) FROM public.products p WHERE p.org_id = o.id) AS productos,
    (SELECT count(*) FROM public.ecommerce_stores s WHERE s.org_id = o.id AND s.is_active) AS tiendas_activas
  FROM public.organizations o
)
SELECT
  o.id AS org_id,
  o.name AS org_name,
  o.slug,
  o.created_at AS org_creada,
  o.trial_ends_at,
  o.onboarding_completed,
  pl.name AS plan_name,
  pl.price_usd_monthly,
  COALESCE(s.status::text, 'sin_suscripcion') AS subscription_status,
  COALESCE(t.gmv_30d, 0) AS gmv_30d,
  COALESCE(t.gmv_prev_30d, 0) AS gmv_prev_30d,
  COALESCE(t.gmv_total, 0) AS gmv_total,
  COALESCE(t.comision_30d, 0) AS comision_30d,
  COALESCE(t.comision_total, 0) AS comision_total,
  COALESCE(t.cobros_30d, 0) AS cobros_30d,
  COALESCE(t.cobros_total, 0) AS cobros_total,
  t.ultimo_cobro,
  t.primer_cobro,
  CASE
    WHEN t.ultimo_cobro IS NOT NULL THEN EXTRACT(day FROM now() - t.ultimo_cobro)::integer
  END AS dias_sin_cobrar,
  c.miembros,
  c.productos,
  c.tiendas_activas,
  CASE
    WHEN COALESCE(t.gmv_prev_30d, 0) > 0 THEN ROUND(
      (COALESCE(t.gmv_30d, 0) - t.gmv_prev_30d) * 100.0 / t.gmv_prev_30d,
      1
    )
  END AS variacion_pct,
  CASE
    WHEN t.cobros_total IS NULL OR t.cobros_total = 0 THEN 'sin_activar'
    WHEN t.ultimo_cobro < now() - interval '90 days' THEN 'dormido'
    WHEN COALESCE(t.gmv_30d, 0) = 0 AND COALESCE(t.gmv_prev_30d, 0) > 0 THEN 'en_riesgo'
    WHEN COALESCE(t.gmv_prev_30d, 0) > 0
      AND COALESCE(t.gmv_30d, 0) < t.gmv_prev_30d * 0.5 THEN 'cayendo'
    WHEN COALESCE(t.gmv_prev_30d, 0) > 0
      AND COALESCE(t.gmv_30d, 0) > t.gmv_prev_30d * 1.2 THEN 'creciendo'
    ELSE 'estable'
  END AS senal
FROM public.organizations o
LEFT JOIN tx t ON t.org_id = o.id
LEFT JOIN conteos c ON c.org_id = o.id
LEFT JOIN public.subscriptions s ON s.org_id = o.id
LEFT JOIN public.plans pl ON pl.id = COALESCE(s.plan_id, o.plan_id);

REVOKE ALL ON public.platform_org_health_source FROM PUBLIC;
REVOKE ALL ON public.platform_org_health_source FROM anon, authenticated;

CREATE OR REPLACE VIEW public.platform_org_health AS
SELECT *
FROM public.platform_org_health_source
WHERE public.is_platform_admin(auth.uid());

REVOKE ALL ON public.platform_org_health FROM PUBLIC;
REVOKE ALL ON public.platform_org_health FROM anon;
GRANT SELECT ON public.platform_org_health TO authenticated;

CREATE TABLE IF NOT EXISTS public.platform_org_health_snapshots (
  snapshot_date date NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  gmv_30d numeric NOT NULL DEFAULT 0,
  gmv_prev_30d numeric NOT NULL DEFAULT 0,
  cobros_30d integer NOT NULL DEFAULT 0,
  cobros_total integer NOT NULL DEFAULT 0,
  dias_sin_cobrar integer,
  senal text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, org_id),
  CONSTRAINT platform_org_health_snapshots_senal_chk
    CHECK (senal IN ('sin_activar', 'en_riesgo', 'cayendo', 'dormido', 'creciendo', 'estable'))
);

CREATE INDEX IF NOT EXISTS platform_org_health_snapshots_org_date_idx
  ON public.platform_org_health_snapshots (org_id, snapshot_date DESC);

ALTER TABLE public.platform_org_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.capture_platform_org_health_snapshot(
  p_snapshot_date date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_date date := COALESCE(
    p_snapshot_date,
    (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
  );
  v_rows integer;
BEGIN
  INSERT INTO public.platform_org_health_snapshots (
    snapshot_date, org_id, gmv_30d, gmv_prev_30d, cobros_30d, cobros_total,
    dias_sin_cobrar, senal, captured_at
  )
  SELECT
    v_snapshot_date, org_id, gmv_30d, gmv_prev_30d, cobros_30d, cobros_total,
    dias_sin_cobrar, senal, now()
  FROM public.platform_org_health_source
  ON CONFLICT (snapshot_date, org_id) DO UPDATE SET
    gmv_30d = EXCLUDED.gmv_30d,
    gmv_prev_30d = EXCLUDED.gmv_prev_30d,
    cobros_30d = EXCLUDED.cobros_30d,
    cobros_total = EXCLUDED.cobros_total,
    dias_sin_cobrar = EXCLUDED.dias_sin_cobrar,
    senal = EXCLUDED.senal,
    captured_at = EXCLUDED.captured_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_platform_org_health_snapshot(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.capture_platform_org_health_snapshot(date) FROM anon, authenticated;

CREATE OR REPLACE VIEW public.platform_org_risk_series AS
SELECT
  snapshot_date,
  COUNT(*) FILTER (WHERE senal = 'en_riesgo')::integer AS en_riesgo,
  COUNT(*) FILTER (WHERE senal = 'cayendo')::integer AS cayendo,
  COUNT(*) FILTER (WHERE senal = 'dormido')::integer AS dormido,
  COUNT(*) FILTER (WHERE senal = 'sin_activar')::integer AS sin_activar,
  COUNT(*) FILTER (WHERE senal IN ('en_riesgo', 'cayendo', 'dormido'))::integer AS comercios_en_riesgo,
  COALESCE(SUM(gmv_prev_30d) FILTER (WHERE senal IN ('en_riesgo', 'cayendo')), 0) AS gmv_en_riesgo
FROM public.platform_org_health_snapshots
WHERE public.is_platform_admin(auth.uid())
GROUP BY snapshot_date
ORDER BY snapshot_date;

REVOKE ALL ON public.platform_org_risk_series FROM PUBLIC;
REVOKE ALL ON public.platform_org_risk_series FROM anon;
GRANT SELECT ON public.platform_org_risk_series TO authenticated;

COMMENT ON TABLE public.platform_org_health_snapshots IS
  'Fotografía diaria factual de salud por organización. Empieza al aplicar G6; no reconstruye historia previa.';
COMMENT ON VIEW public.platform_org_risk_series IS
  'Serie diaria de riesgo de abandono para plataforma. Riesgo = en_riesgo, cayendo o dormido; sin_activar se informa aparte porque es onboarding.';

-- Prueba la captura con una fecha sintética y borra todos sus restos. No toca
-- stock, precios, órdenes ni filas reales del negocio.
DO $verificar$
DECLARE
  v_test_date date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - 10000;
  v_captured integer;
  v_expected integer;
BEGIN
  SELECT count(*) INTO v_expected FROM public.platform_org_health_source;
  v_captured := public.capture_platform_org_health_snapshot(v_test_date);

  IF v_captured <> v_expected
     OR (SELECT count(*) FROM public.platform_org_health_snapshots WHERE snapshot_date = v_test_date) <> v_expected THEN
    RAISE EXCEPTION 'G6 no capturó todas las organizaciones esperadas';
  END IF;

  DELETE FROM public.platform_org_health_snapshots WHERE snapshot_date = v_test_date;

  IF EXISTS (SELECT 1 FROM public.platform_org_health_snapshots WHERE snapshot_date = v_test_date) THEN
    RAISE EXCEPTION 'Quedaron snapshots sintéticos de G6';
  END IF;
END;
$verificar$;

-- Primera observación real: se registra desde hoy y el cron mantiene la serie.
SELECT public.capture_platform_org_health_snapshot();

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('snapshot-platform-org-health')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-platform-org-health');
    PERFORM cron.schedule(
      'snapshot-platform-org-health',
      '15 6 * * *',
      $job$SELECT public.capture_platform_org_health_snapshot();$job$
    );
  END IF;
END;
$cron$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260814000007', 'platform_risk_series') ON CONFLICT DO NOTHING;
