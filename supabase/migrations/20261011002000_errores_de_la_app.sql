-- ═══════════════════════════════════════════════════════════════════════════
-- P0.3: los errores de la app se registran aunque no haya Sentry
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido 2026-10-11: el bundle publicado en nerqia.app no tiene DSN de Sentry
-- (`initSentry` no hace nada sin `VITE_SENTRY_DSN`), así que los errores que
-- ven los comercios y sus clientes no quedan registrados en ningún lado.
-- ROADMAP P0.3 pide medir errores sin datos personales innecesarios.
--
--   · `app_errores`: por día y huella (origen + mensaje con números y ids
--     reemplazados), cuántas veces, el mensaje y la ruta (sin query string)
--     de ejemplo, ya limpios en el navegador. Sin usuario, sin comercio, sin
--     IP. Tope de 500 huellas distintas por día y 1.000.000 por contador.
--   · `registrar_error_app(p_origen, p_mensaje, p_ruta)` (pública: también
--     falla la tienda, sin sesión).
--   · `platform_errores_app(p_dias)`: sólo administradores de plataforma.
--   · Retención: `podar_datos_operativos()` borra los de más de 30 días.
--
-- Idempotente. Reversible: DROP FUNCTION x2, DROP TABLE, volver a
-- 20261011001500 para la poda.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_errores (
  dia date NOT NULL DEFAULT current_date,
  huella text NOT NULL CHECK (char_length(huella) = 32),
  origen text NOT NULL CHECK (origen IN ('panel', 'tienda', 'otro')),
  mensaje text NOT NULL CHECK (char_length(mensaje) BETWEEN 1 AND 300),
  ruta text CHECK (char_length(ruta) <= 120),
  veces integer NOT NULL DEFAULT 1 CHECK (veces BETWEEN 1 AND 1000000),
  ultima_vez timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dia, huella)
);

ALTER TABLE public.app_errores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_errores FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.app_errores IS
  'Errores de la app (panel y tienda) agrupados por día y huella, sin usuario, comercio ni IP. Sólo la escribe registrar_error_app; la lee platform_errores_app.';

CREATE OR REPLACE FUNCTION public.registrar_error_app(p_origen text, p_mensaje text, p_ruta text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origen text := CASE WHEN p_origen IN ('panel', 'tienda') THEN p_origen ELSE 'otro' END;
  v_mensaje text := left(btrim(coalesce(p_mensaje, '')), 300);
  v_ruta text := left(split_part(split_part(coalesce(p_ruta, ''), '?', 1), '#', 1), 120);
  v_huella text;
BEGIN
  IF v_mensaje = '' THEN
    RETURN;
  END IF;
  -- La huella ignora números e ids: «quedan 3» y «quedan 5» son el mismo error.
  v_huella := md5(v_origen || '|' || regexp_replace(lower(v_mensaje), '[0-9a-f-]{8,}|[0-9]+', '#', 'g'));

  IF NOT EXISTS (SELECT 1 FROM public.app_errores WHERE dia = current_date AND huella = v_huella)
     AND (SELECT count(*) FROM public.app_errores WHERE dia = current_date) >= 500 THEN
    RETURN;
  END IF;

  INSERT INTO public.app_errores AS e (dia, huella, origen, mensaje, ruta)
  VALUES (current_date, v_huella, v_origen, v_mensaje, nullif(v_ruta, ''))
  ON CONFLICT (dia, huella) DO UPDATE
    SET veces = LEAST(e.veces + 1, 1000000), ultima_vez = now();
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_error_app(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_error_app(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.platform_errores_app(p_dias integer DEFAULT 7)
RETURNS TABLE (origen text, mensaje text, ruta text, veces bigint, dias bigint, ultima_vez timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sólo administradores de plataforma' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT max(e.origen), max(e.mensaje), max(e.ruta), sum(e.veces)::bigint, count(DISTINCT e.dia)::bigint, max(e.ultima_vez)
  FROM public.app_errores e
  WHERE e.dia >= current_date - LEAST(GREATEST(coalesce(p_dias, 7), 1), 30)
  GROUP BY e.huella
  ORDER BY sum(e.veces) DESC
  LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_errores_app(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_errores_app(integer) TO authenticated;

-- La poda diaria suma los errores de más de 30 días.
CREATE OR REPLACE FUNCTION public.podar_datos_operativos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cron integer := 0;
  v_filas integer := 0;
  v_errores integer := 0;
BEGIN
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '14 days';
  GET DIAGNOSTICS v_cron = ROW_COUNT;

  DELETE FROM public.product_import_rows r
  USING public.catalog_import_chunks c, public.catalog_import_sessions s
  WHERE r.batch_id = c.batch_id AND c.session_id = s.id
    AND s.status = 'cancelled' AND s.updated_at < now() - interval '7 days';
  GET DIAGNOSTICS v_filas = ROW_COUNT;

  DELETE FROM public.app_errores WHERE dia < current_date - 30;
  GET DIAGNOSTICS v_errores = ROW_COUNT;

  RETURN jsonb_build_object('corridas_de_cron', v_cron, 'filas_de_importaciones_canceladas', v_filas, 'errores_de_la_app', v_errores);
END;
$$;

REVOKE ALL ON FUNCTION public.podar_datos_operativos() FROM PUBLIC, anon, authenticated;

COMMIT;
