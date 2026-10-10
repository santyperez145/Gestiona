-- ═══════════════════════════════════════════════════════════════════════════
-- Ajuste de precios en bloque: por proveedor o marca, en una transacción
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Experimento E1/E3 de docs/TESIS.md: para una ferretería con miles de
-- artículos, el trabajo semanal es «el proveedor aumentó 8%». Medido
-- 2026-10-10 sobre el único comercio activo: 5.500 productos, todos con costo
-- en pesos, 48 proveedores y 127 marcas.
--
-- El ajuste que había en Productos no servía para ese trabajo:
--   · exigía una cotización en dólares aunque el comercio compre en pesos, y
--     recalculaba la ganancia con `cost_usd` (0 para todo ese catálogo);
--   · filtraba sólo por categoría, no por proveedor ni marca;
--   · actualizaba fila por fila desde el navegador: 5.500 pedidos, y si uno
--     fallaba quedaba medio catálogo con el precio viejo;
--   · no mostraba qué iba a cambiar antes de aplicarlo.
--
-- `ajustar_precios_en_bloque` hace todo en la base, en una sola transacción.
-- Con `p_aplicar = false` devuelve la vista previa sin tocar nada.
--   p_que = 'precio'          sube/baja precio de venta, oferta y 2×
--   p_que = 'costo'           sube/baja el costo (en su moneda); el precio queda
--   p_que = 'costo_y_precio'  ambos: el proveedor aumentó y se traslada
-- La ganancia por unidad se recalcula con el costo en su moneda; en dólares
-- sólo si hay cotización (sin cotización no se inventa: queda como estaba).
-- El historial de precios lo registra `trg_record_price_change`.
--
-- Idempotente (CREATE OR REPLACE). Reversible: DROP FUNCTION.
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
    'muestra', v_muestra);
END $$;

REVOKE ALL ON FUNCTION public.ajustar_precios_en_bloque(uuid, numeric, text, text, text, uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_precios_en_bloque(uuid, numeric, text, text, text, uuid, integer, boolean) TO authenticated;

COMMENT ON FUNCTION public.ajustar_precios_en_bloque(uuid, numeric, text, text, text, uuid, integer, boolean) IS
  'Ajusta precio, costo o ambos por porcentaje, filtrando por categoría, marca o proveedor, en una transacción. p_aplicar=false devuelve la vista previa.';

COMMIT;
