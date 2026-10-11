-- ═══════════════════════════════════════════════════════════════════════════
-- Ajuste de precios en bloque: avisa si deja productos por debajo del costo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Guardián de margen (Profit) aplicado al trabajo semanal de E1 de
-- docs/TESIS.md: «el proveedor aumentó 8%». Si se sube sólo el costo, o el
-- precio con un porcentaje menor, productos que daban ganancia pasan a
-- perder plata en cada venta. Medido 2026-10-10: Ferretería Famatina ya tiene
-- 21 productos con precio por debajo del costo, y la vista previa del ajuste
-- no lo decía.
--
-- Cambio: la respuesta (vista previa y aplicación) suma `bajo_costo_despues`
-- (cuántos de los afectados quedarían con precio menor al costo; en dólares
-- sólo con cotización) y `bajo_costo_muestra` (hasta 5 nombres). No cambia
-- qué se ajusta ni cómo.
--
-- Idempotente (CREATE OR REPLACE). Reversible: la definición de 20261010001700.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.ajustar_precios_en_bloque(
  p_org uuid,
  p_porcentaje numeric,
  p_que text,
  p_categoria text DEFAULT NULL,
  p_marca text DEFAULT NULL,
  p_proveedor uuid DEFAULT NULL,
  p_redondeo integer DEFAULT 1,
  p_aplicar boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_factor numeric;
  v_tc numeric;
  v_afectados integer;
  v_muestra jsonb;
  v_bajo_costo integer;
  v_bajo_costo_muestra jsonb;
  v_precio boolean := p_que IN ('precio', 'costo_y_precio');
  v_costo boolean := p_que IN ('costo', 'costo_y_precio');
BEGIN
  IF v_actor IS NULL OR NOT public.is_org_member(p_org, v_actor)
     OR NOT public.has_permission(p_org, 'products', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para editar productos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_que IS NULL OR p_que NOT IN ('precio', 'costo', 'costo_y_precio') THEN
    RAISE EXCEPTION 'Elegí si cambia el precio, el costo o los dos' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_porcentaje IS NULL OR p_porcentaje = 0 OR p_porcentaje <= -90 OR p_porcentaje > 500 THEN
    RAISE EXCEPTION 'El porcentaje tiene que estar entre -90%% y 500%% y no ser 0' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_redondeo IS NULL OR p_redondeo NOT IN (1, 10, 50, 100) THEN
    RAISE EXCEPTION 'El redondeo tiene que ser 1, 10, 50 o 100' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_factor := 1 + p_porcentaje / 100;
  SELECT NULLIF(s.exchange_rate, 0) INTO v_tc FROM public.settings s WHERE s.org_id = p_org;

  CREATE TEMP TABLE IF NOT EXISTS _ajuste_precios (
    id uuid, nombre text, moneda text,
    precio_antes numeric, precio_despues numeric,
    oferta_despues numeric, doble_despues numeric,
    costo_antes numeric, costo_despues numeric,
    costo_usd_despues numeric, costo_total_usd_despues numeric
  ) ON COMMIT DROP;
  TRUNCATE _ajuste_precios;

  INSERT INTO _ajuste_precios
  SELECT p.id, p.name, m.moneda,
    p.sale_price_ars,
    CASE WHEN v_precio AND COALESCE(p.sale_price_ars, 0) > 0
      THEN round(p.sale_price_ars * v_factor / p_redondeo) * p_redondeo ELSE p.sale_price_ars END,
    CASE WHEN v_precio AND COALESCE(p.discount_price_ars, 0) > 0
      THEN round(p.discount_price_ars * v_factor / p_redondeo) * p_redondeo ELSE p.discount_price_ars END,
    CASE WHEN v_precio AND COALESCE(p.price_2x_ars, 0) > 0
      THEN round(p.price_2x_ars * v_factor / p_redondeo) * p_redondeo ELSE p.price_2x_ars END,
    CASE WHEN m.moneda = 'ARS' THEN p.cost_ars ELSE p.cost_usd END,
    CASE WHEN v_costo AND m.moneda = 'ARS' AND COALESCE(p.cost_ars, 0) > 0
      THEN round(p.cost_ars * v_factor, 2) ELSE p.cost_ars END,
    CASE WHEN v_costo AND m.moneda = 'USD' AND COALESCE(p.cost_usd, 0) > 0
      THEN round(p.cost_usd * v_factor, 4) ELSE p.cost_usd END,
    CASE WHEN v_costo AND m.moneda = 'USD' AND COALESCE(p.total_cost_usd, 0) > 0
      THEN round(p.total_cost_usd * v_factor, 4) ELSE p.total_cost_usd END
  FROM public.products p
  CROSS JOIN LATERAL (SELECT COALESCE(p.cost_currency,
    CASE WHEN COALESCE(p.cost_ars, 0) > 0 THEN 'ARS' ELSE 'USD' END) AS moneda) m
  WHERE p.org_id = p_org
    AND (p_categoria IS NULL OR p.category = p_categoria)
    AND (p_marca IS NULL OR p.brand = p_marca)
    AND (p_proveedor IS NULL OR p.supplier_id = p_proveedor)
    AND ((v_precio AND COALESCE(p.sale_price_ars, 0) > 0)
      OR (v_costo AND (COALESCE(p.cost_ars, 0) > 0 OR COALESCE(p.cost_usd, 0) > 0)));

  SELECT count(*) INTO v_afectados FROM _ajuste_precios;

  -- Guardián de margen: cuántos quedarían vendiéndose por debajo del costo.
  -- En dólares sólo con cotización; sin costo conocido no cuenta.
  CREATE TEMP TABLE IF NOT EXISTS _ajuste_bajo_costo (nombre text) ON COMMIT DROP;
  DELETE FROM _ajuste_bajo_costo;
  INSERT INTO _ajuste_bajo_costo
  SELECT a.nombre FROM _ajuste_precios a
  WHERE COALESCE(a.precio_despues, 0) > 0 AND (
    (a.moneda = 'ARS' AND COALESCE(a.costo_despues, 0) > 0 AND a.precio_despues < a.costo_despues)
    OR (a.moneda = 'USD' AND v_tc IS NOT NULL
        AND COALESCE(a.costo_total_usd_despues, a.costo_usd_despues, 0) > 0
        AND a.precio_despues < COALESCE(a.costo_total_usd_despues, a.costo_usd_despues) * v_tc));
  SELECT count(*), COALESCE((SELECT jsonb_agg(n) FROM (SELECT nombre AS n FROM _ajuste_bajo_costo ORDER BY nombre LIMIT 5) t), '[]'::jsonb)
    INTO v_bajo_costo, v_bajo_costo_muestra FROM _ajuste_bajo_costo;
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_muestra FROM (
    SELECT jsonb_build_object('id', id, 'nombre', nombre, 'moneda', moneda,
      'precio_antes', precio_antes, 'precio_despues', precio_despues,
      'costo_antes', costo_antes,
      'costo_despues', CASE WHEN moneda = 'ARS' THEN costo_despues ELSE costo_usd_despues END) AS x
    FROM _ajuste_precios ORDER BY nombre LIMIT 8) s;

  IF p_aplicar AND v_afectados > 0 THEN
    UPDATE public.products p SET
      sale_price_ars = a.precio_despues,
      discount_price_ars = a.oferta_despues,
      price_2x_ars = a.doble_despues,
      cost_ars = a.costo_despues,
      cost_usd = a.costo_usd_despues,
      total_cost_usd = a.costo_total_usd_despues,
      profit_per_unit_ars = CASE
        WHEN a.moneda = 'ARS' AND a.costo_despues IS NOT NULL THEN a.precio_despues - a.costo_despues
        WHEN a.moneda = 'USD' AND v_tc IS NOT NULL THEN a.precio_despues - COALESCE(a.costo_total_usd_despues, a.costo_usd_despues, 0) * v_tc
        ELSE p.profit_per_unit_ars END,
      profit_per_unit_usd = CASE
        WHEN v_tc IS NULL THEN p.profit_per_unit_usd
        WHEN a.moneda = 'ARS' AND a.costo_despues IS NOT NULL THEN (a.precio_despues - a.costo_despues) / v_tc
        WHEN a.moneda = 'USD' THEN a.precio_despues / v_tc - COALESCE(a.costo_total_usd_despues, a.costo_usd_despues, 0)
        ELSE p.profit_per_unit_usd END
    FROM _ajuste_precios a
    WHERE p.id = a.id AND p.org_id = p_org;
  END IF;

  RETURN jsonb_build_object(
    'aplicado', p_aplicar AND v_afectados > 0,
    'afectados', v_afectados,
    'porcentaje', p_porcentaje,
    'que', p_que,
    'bajo_costo_despues', v_bajo_costo,
    'bajo_costo_muestra', v_bajo_costo_muestra,
    'muestra', v_muestra);
END $$;

REVOKE ALL ON FUNCTION public.ajustar_precios_en_bloque(uuid, numeric, text, text, text, uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_precios_en_bloque(uuid, numeric, text, text, text, uuid, integer, boolean) TO authenticated;

COMMIT;
