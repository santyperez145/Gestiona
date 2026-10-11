-- ═══════════════════════════════════════════════════════════════════════════
-- Tienda: tope de términos de búsqueda distintos por comercio y día
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Las funciones públicas que registran búsquedas (20261011000500, 0700, 1100)
-- suman una fila por término distinto por día, sin límite: cualquiera podía
-- mandar miles de términos inventados y hacer crecer la base (que pesa 405
-- MB). Los contadores ya tenían tope; la cantidad de filas, no.
--
-- `_busquedas_del_dia_llenas(org, tabla)`: si ese comercio ya tiene 2.000
-- términos distintos hoy en esa tabla, un término nuevo se ignora (los que
-- ya existen siguen sumando). 2.000 es mucho más de lo que busca una tienda
-- real en un día. Las funciones públicas lo consultan antes de insertar.
--
-- Idempotente (CREATE OR REPLACE). Reversible: las versiones anteriores.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public._busquedas_del_dia_llenas(p_org uuid, p_tabla text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF p_tabla = 'sin_resultado' THEN
    SELECT count(*) INTO v_n FROM public.store_busquedas_sin_resultado WHERE org_id = p_org AND dia = current_date;
  ELSE
    SELECT count(*) INTO v_n FROM public.store_busquedas WHERE org_id = p_org AND dia = current_date;
  END IF;
  RETURN v_n >= 2000;
END;
$$;

REVOKE ALL ON FUNCTION public._busquedas_del_dia_llenas(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.registrar_busqueda_sin_resultado(p_slug text, p_termino text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_termino text;
BEGIN
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
$$;

CREATE OR REPLACE FUNCTION public.registrar_busqueda(p_slug text, p_termino text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
BEGIN
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
$$;

CREATE OR REPLACE FUNCTION public.registrar_clic_de_busqueda(p_slug text, p_termino text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
BEGIN
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
$$;

CREATE OR REPLACE FUNCTION public.registrar_pedido_de_busqueda(p_slug text, p_terminos text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_termino text;
  v_vistos text[] := '{}';
BEGIN
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
$$;

COMMIT;
