-- Toma física: registrar lo contado en tandas, no producto por producto.
--
-- «Cerrar toma» llamaba a `registrar_conteo` una vez por fila contada: con
-- el catálogo de Famatina (5.500) eran 5.500 llamadas seguidas desde el
-- navegador, varios minutos, y un corte de red a la mitad cancelaba el
-- conteo entero. `registrar_conteo_lote` recibe hasta 2.000 renglones
-- [{product_id, cantidad}] y los registra en un UPDATE, con los mismos
-- controles que la versión de a uno: miembro con permiso de editar
-- inventario, conteo abierto, cantidades no negativas y productos del
-- conteo. Todo o nada por tanda. Reversible: DROP de la función.
BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_conteo_lote(p_count_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_org uuid; v_estado text; v_user uuid := auth.uid();
  v_total integer; v_distintos integer; v_sin_producto integer; v_negativos integer; v_registrados integer;
BEGIN
  SELECT c.org_id, c.status INTO v_org, v_estado
    FROM public.stock_counts c WHERE c.id = p_count_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El conteo no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_user IS NULL OR NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre este conteo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_org, 'inventory', 'edit', 'registrar un conteo');
  IF v_estado <> 'abierto' THEN
    RAISE EXCEPTION 'El conteo ya está %', v_estado USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No hay renglones para registrar' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(p_items) > 2000 THEN
    RAISE EXCEPTION 'Mandá los renglones en tandas de hasta 2.000' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT count(*), count(DISTINCT x.product_id),
         count(*) FILTER (WHERE x.product_id IS NULL),
         count(*) FILTER (WHERE x.cantidad IS NULL OR x.cantidad < 0)
    INTO v_total, v_distintos, v_sin_producto, v_negativos
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, cantidad numeric);
  IF v_sin_producto > 0 THEN
    RAISE EXCEPTION 'Hay un renglón sin producto' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_distintos <> v_total THEN
    RAISE EXCEPTION 'Un producto aparece dos veces en la tanda' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_negativos > 0 THEN
    RAISE EXCEPTION 'La cantidad contada no puede ser negativa' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.stock_count_items i
     SET counted = x.cantidad, counted_by = v_user, counted_at = now()
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, cantidad numeric)
   WHERE i.count_id = p_count_id AND i.product_id = x.product_id;
  GET DIAGNOSTICS v_registrados = ROW_COUNT;

  IF v_registrados <> v_total THEN
    RAISE EXCEPTION 'Hay % producto(s) que no están en el conteo', v_total - v_registrados USING ERRCODE = 'no_data_found';
  END IF;

  RETURN jsonb_build_object('ok', true, 'registrados', v_registrados);
END;
$fn$;

REVOKE ALL ON FUNCTION public.registrar_conteo_lote(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_conteo_lote(uuid, jsonb) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       'Exige ser miembro con permiso de editar inventario; sólo registra en conteos abiertos de su negocio.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-23'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'registrar_conteo_lote'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
