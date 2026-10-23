-- Recálculo de precios desde el costo en dólares, en una sola transacción.
--
-- «Ajuste masivo de precios › Costo en dólares» leía los productos con
-- `getProductsDB(userId)` —los del usuario, hasta 1.000 filas de PostgREST—
-- y hacía un UPDATE por producto desde el navegador: con un catálogo como el
-- de Famatina (5.500) quedaba a medias, tardaba minutos y no tocaba lo que
-- cargó otro usuario. Lo mismo que ya resolvieron el ajuste por porcentaje
-- (`ajustar_precios_en_bloque`) y el de cotización (20261009000300):
--   precio = costo U$S × tipo de cambio × (1 + markup/100), redondeado;
--   ganancia por unidad en pesos y en dólares;
-- en un UPDATE por negocio (y categoría, si se elige), con permiso de editar
-- productos, y guarda el tipo de cambio en la configuración. Todo o nada.
-- Reversible: DROP de la función.
BEGIN;

CREATE OR REPLACE FUNCTION public.recalcular_precios_desde_costo_usd(
  p_org uuid,
  p_tipo_cambio numeric,
  p_markup_pct numeric,
  p_category text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'products', 'edit', 'recalcular precios desde el costo en dólares');
  IF COALESCE(p_tipo_cambio, 0) <= 0 OR p_tipo_cambio > 1000000 THEN
    RAISE EXCEPTION 'Ingresá un tipo de cambio válido' USING ERRCODE = '22023';
  END IF;
  IF p_markup_pct IS NULL OR p_markup_pct < 0 OR p_markup_pct > 10000 THEN
    RAISE EXCEPTION 'Ingresá un markup válido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products p
     SET sale_price_ars = round(p.cost_usd * p_tipo_cambio * (1 + p_markup_pct / 100)),
         profit_per_unit_ars = round(p.cost_usd * p_tipo_cambio * (1 + p_markup_pct / 100)) - p.cost_usd * p_tipo_cambio,
         profit_per_unit_usd = (round(p.cost_usd * p_tipo_cambio * (1 + p_markup_pct / 100)) - p.cost_usd * p_tipo_cambio) / p_tipo_cambio
   WHERE p.org_id = p_org
     AND COALESCE(p.cost_usd, 0) > 0
     AND (NULLIF(btrim(p_category), '') IS NULL OR p.category = btrim(p_category));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.settings SET exchange_rate = p_tipo_cambio WHERE org_id = p_org;

  RETURN jsonb_build_object('ok', true, 'updated', v_count, 'tipo_cambio', p_tipo_cambio);
END;
$fn$;

REVOKE ALL ON FUNCTION public.recalcular_precios_desde_costo_usd(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_precios_desde_costo_usd(uuid, numeric, numeric, text) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       'Exige ser miembro con permiso de editar productos; sólo recalcula los productos de su negocio.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-23'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'recalcular_precios_desde_costo_usd'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
