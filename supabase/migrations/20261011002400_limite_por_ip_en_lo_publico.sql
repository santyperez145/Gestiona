-- ═══════════════════════════════════════════════════════════════════════════
-- Límite por IP en las funciones públicas nuevas de la tienda y de errores
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Las funciones públicas que agregamos el 2026-10-11 (búsquedas, avisos de
-- búsqueda, velocidad y errores) sólo tenían topes por comercio y día: una
-- sola IP podía agotar el cupo de todos —p. ej. llenar los 300 avisos del día
-- de una tienda y dejar sin aviso a los clientes reales—. Las de antes
-- (carrito, newsletter, pedido, cupón) ya usan `rate_limit_publico`, que
-- limita por IP (hasheada) con la tienda como respaldo. Ahora éstas también:
--
--   búsquedas (registrar, sin resultado, clic, pedido)  60 por minuto
--   velocidad de la tienda                              20 por minuto
--   errores de la app                                   30 por minuto
--   «avisame si lo consiguen»                            5 cada 15 minutos (avisa)
--
-- Pasado el límite, las de medición no registran (no molestan al visitante);
-- el aviso responde «Probá de nuevo en unos minutos». El resto de cada
-- función no cambia (se generó desde la definición en producción).
--
-- Idempotente (CREATE OR REPLACE). Reversible: las versiones anteriores.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_busqueda(p_slug text, p_termino text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v record;
BEGIN
  IF NOT public.rate_limit_publico('tienda_busqueda', p_slug, 60, interval '1 minute') THEN RETURN; END IF;
  v := public._busqueda_de_tienda(p_slug, p_termino);
  IF v.org_id IS NULL OR v.termino IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_busquedas WHERE org_id = v.org_id AND dia = current_date AND termino = v.termino)
     AND public._busquedas_del_dia_llenas(v.org_id, 'con_resultado') THEN
    RETURN;
  END IF;
  INSERT INTO public.store_busquedas AS b (org_id, dia, termino, veces)
  VALUES (v.org_id, current_date, v.termino, 1)
  ON CONFLICT (org_id, dia, termino) DO UPDATE
    SET veces = LEAST(b.veces + 1, 1000000), ultima_vez = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_busqueda_sin_resultado(p_slug text, p_termino text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_termino text;
BEGIN
  IF NOT public.rate_limit_publico('tienda_busqueda', p_slug, 60, interval '1 minute') THEN RETURN; END IF;
  v_termino := left(btrim(regexp_replace(public.texto_catalogo(p_termino), '\s+', ' ', 'g')), 60);
  IF v_termino IS NULL OR char_length(v_termino) < 2 OR v_termino !~ '^[a-z0-9 ]+$' THEN
    RETURN;
  END IF;

  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  ORDER BY s.is_primary DESC, s.created_at
  LIMIT 1;
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.store_busquedas_sin_resultado WHERE org_id = v_org AND dia = current_date AND termino = v_termino)
     AND public._busquedas_del_dia_llenas(v_org, 'sin_resultado') THEN
    RETURN;
  END IF;

  INSERT INTO public.store_busquedas_sin_resultado AS b (org_id, dia, termino)
  VALUES (v_org, current_date, v_termino)
  ON CONFLICT (org_id, dia, termino) DO UPDATE
    SET veces = LEAST(b.veces + 1, 1000000), ultima_vez = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_clic_de_busqueda(p_slug text, p_termino text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v record;
BEGIN
  IF NOT public.rate_limit_publico('tienda_busqueda', p_slug, 60, interval '1 minute') THEN RETURN; END IF;
  v := public._busqueda_de_tienda(p_slug, p_termino);
  IF v.org_id IS NULL OR v.termino IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_busquedas WHERE org_id = v.org_id AND dia = current_date AND termino = v.termino)
     AND public._busquedas_del_dia_llenas(v.org_id, 'con_resultado') THEN
    RETURN;
  END IF;
  -- Un clic sin búsqueda registrada (p. ej. la llamada anterior se cortó)
  -- cuenta también la búsqueda: nunca más clics que búsquedas.
  INSERT INTO public.store_busquedas AS b (org_id, dia, termino, veces, con_clic)
  VALUES (v.org_id, current_date, v.termino, 1, 1)
  ON CONFLICT (org_id, dia, termino) DO UPDATE
    SET con_clic = LEAST(b.con_clic + 1, 1000000),
        veces = GREATEST(b.veces, LEAST(b.con_clic + 1, 1000000)),
        ultima_vez = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_pedido_de_busqueda(p_slug text, p_terminos text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v record;
  v_termino text;
  v_vistos text[] := '{}';
BEGIN
  IF NOT public.rate_limit_publico('tienda_busqueda', p_slug, 60, interval '1 minute') THEN RETURN; END IF;
  FOREACH v_termino IN ARRAY coalesce(p_terminos[1:10], '{}') LOOP
    v := public._busqueda_de_tienda(p_slug, v_termino);
    CONTINUE WHEN v.org_id IS NULL OR v.termino IS NULL OR v.termino = ANY (v_vistos);
    v_vistos := v_vistos || v.termino;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.store_busquedas WHERE org_id = v.org_id AND dia = current_date AND termino = v.termino)
      AND public._busquedas_del_dia_llenas(v.org_id, 'con_resultado');
    INSERT INTO public.store_busquedas AS b (org_id, dia, termino, veces, con_clic, con_pedido)
    VALUES (v.org_id, current_date, v.termino, 1, 1, 1)
    ON CONFLICT (org_id, dia, termino) DO UPDATE
      SET con_pedido = LEAST(b.con_pedido + 1, 1000000),
          con_clic = GREATEST(b.con_clic, LEAST(b.con_pedido + 1, 1000000)),
          veces = GREATEST(b.veces, LEAST(b.con_pedido + 1, 1000000)),
          ultima_vez = now();
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_vitales_tienda(p_slug text, p_pagina text, p_lcp numeric, p_cls numeric, p_inp numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_pagina text := CASE WHEN p_pagina IN ('inicio', 'productos', 'producto') THEN p_pagina ELSE 'otra' END;
  m record;
BEGIN
  IF NOT public.rate_limit_publico('tienda_vitales', p_slug, 20, interval '1 minute') THEN RETURN; END IF;
  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  ORDER BY s.is_primary DESC, s.created_at
  LIMIT 1;
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  FOR m IN
    SELECT * FROM (VALUES
      -- metrica, valor, límite bueno, límite malo, máximo creíble
      ('lcp', p_lcp, 2500::numeric, 4000::numeric, 120000::numeric),
      ('cls', p_cls, 0.1, 0.25, 50),
      ('inp', p_inp, 200, 500, 60000)
    ) AS t(metrica, valor, bueno, malo, maximo)
  LOOP
    CONTINUE WHEN m.valor IS NULL OR m.valor < 0 OR m.valor > m.maximo;
    INSERT INTO public.store_vitales AS v (org_id, dia, pagina, metrica, buenas, regulares, malas)
    VALUES (
      v_org, current_date, v_pagina, m.metrica,
      (m.valor <= m.bueno)::int,
      (m.valor > m.bueno AND m.valor <= m.malo)::int,
      (m.valor > m.malo)::int
    )
    ON CONFLICT (org_id, dia, pagina, metrica) DO UPDATE SET
      buenas = LEAST(v.buenas + EXCLUDED.buenas, 1000000),
      regulares = LEAST(v.regulares + EXCLUDED.regulares, 1000000),
      malas = LEAST(v.malas + EXCLUDED.malas, 1000000);
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_error_app(p_origen text, p_mensaje text, p_ruta text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_origen text := CASE WHEN p_origen IN ('panel', 'tienda') THEN p_origen ELSE 'otro' END;
  v_mensaje text := left(btrim(coalesce(p_mensaje, '')), 300);
  v_ruta text := left(split_part(split_part(coalesce(p_ruta, ''), '?', 1), '#', 1), 120);
  v_huella text;
BEGIN
  IF NOT public.rate_limit_publico('app_errores', coalesce(p_origen, '?'), 30, interval '1 minute') THEN RETURN; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.pedir_aviso_de_busqueda(p_slug text, p_termino text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_termino text;
  v_store record;
BEGIN
  IF NOT public.rate_limit_publico('tienda_aviso_busqueda', p_slug, 5, interval '15 minutes') THEN
    RAISE EXCEPTION 'Probá de nuevo en unos minutos' USING ERRCODE = '53400';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR char_length(v_email) > 254 THEN
    RAISE EXCEPTION 'Revisá el email';
  END IF;

  v_termino := left(btrim(regexp_replace(public.texto_catalogo(p_termino), '\s+', ' ', 'g')), 60);
  IF v_termino IS NULL OR char_length(v_termino) < 2 OR v_termino !~ '^[a-z0-9 ]+$' THEN
    RAISE EXCEPTION 'Escribí qué estás buscando';
  END IF;

  SELECT s.id, s.org_id INTO v_store FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  ORDER BY s.is_primary DESC, s.created_at
  LIMIT 1;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada';
  END IF;

  IF (SELECT count(*) FROM public.store_avisos_de_busqueda a
      WHERE a.org_id = v_store.org_id AND a.created_at > now() - interval '1 day') >= 300 THEN
    RAISE EXCEPTION 'Probá de nuevo más tarde';
  END IF;

  DELETE FROM public.store_avisos_de_busqueda WHERE retener_hasta <= now() AND org_id = v_store.org_id;

  INSERT INTO public.store_avisos_de_busqueda (org_id, store_id, termino, email)
  VALUES (v_store.org_id, v_store.id, v_termino, v_email)
  ON CONFLICT (org_id, termino, email) DO UPDATE
    SET created_at = now(), retener_hasta = now() + interval '180 days';

  RETURN jsonb_build_object('ok', true);
END;
$function$;

COMMIT;
