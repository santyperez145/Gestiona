-- Actualización masiva de precios por cotización en una sola transacción.
--
-- La pantalla leía hasta 1.000 productos (tope de PostgREST) y hacía un UPDATE
-- por producto desde el navegador: con 11.000 productos actualizaba sólo una
-- parte, tardaba minutos y descartaba los errores. Esta función aplica el
-- mismo multiplicador a todo el alcance en un UPDATE, valida permiso y
-- registra la cantidad exacta. Todo o nada.

CREATE OR REPLACE FUNCTION public.actualizar_precios_por_cotizacion(
  p_org uuid,
  p_nombre text,
  p_rate_before numeric,
  p_rate_after numeric,
  p_margin_type text,
  p_margin_value numeric,
  p_category text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_multiplier numeric;
  v_count integer;
BEGIN
  IF v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'products', 'edit', 'actualizar precios por cotización');
  IF NULLIF(btrim(p_nombre), '') IS NULL THEN RAISE EXCEPTION 'Falta el nombre de la actualización'; END IF;
  IF COALESCE(p_rate_before, 0) <= 0 OR COALESCE(p_rate_after, 0) <= 0 THEN
    RAISE EXCEPTION 'Las cotizaciones deben ser mayores a cero';
  END IF;
  IF p_margin_type NOT IN ('fixed_pct', 'keep_margin', 'custom') THEN
    RAISE EXCEPTION 'Tipo de ajuste inválido';
  END IF;
  v_multiplier := CASE WHEN p_margin_type = 'fixed_pct'
    THEN 1 + COALESCE(p_margin_value, 0) / 100
    ELSE p_rate_after / p_rate_before END;
  IF v_multiplier <= 0 OR v_multiplier > 100 THEN
    RAISE EXCEPTION 'El ajuste resultante está fuera de rango';
  END IF;

  UPDATE public.products p
  SET sale_price_ars = ceil(COALESCE(p.sale_price_ars, 0) * v_multiplier)
  WHERE p.org_id = p_org
    AND (NULLIF(btrim(p_category), '') IS NULL OR p.category = btrim(p_category));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.currency_price_updates (org_id, name, rate_before, rate_after, products_updated, margin_type, margin_value)
  VALUES (p_org, btrim(p_nombre), p_rate_before, p_rate_after, v_count, p_margin_type, COALESCE(p_margin_value, 0));

  RETURN jsonb_build_object('ok', true, 'updated', v_count, 'multiplier', v_multiplier);
END;
$fn$;

REVOKE ALL ON FUNCTION public.actualizar_precios_por_cotizacion(uuid, text, numeric, numeric, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_precios_por_cotizacion(uuid, text, numeric, numeric, text, numeric, text) TO authenticated, service_role;
