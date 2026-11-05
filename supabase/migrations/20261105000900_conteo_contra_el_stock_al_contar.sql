-- El conteo ajusta contra el stock del momento en que se contó (2026-11-05).
--
-- cerrar_conteo ajustaba con «contado − stock al cerrar». Si se contaron 10 y
-- después se vendieron 2 (el sistema ya tiene 8 y el estante también), el
-- ajuste daba +2 y el stock quedaba en 10: toda venta hecha entre contar y
-- cerrar inflaba el stock. Ahora el ajuste es «contado − stock al contar»,
-- donde el stock al contar es el del cierre menos lo que se movió después de
-- registrar ese producto (counted_at). Si el producto se registró al cerrar,
-- da lo mismo que antes. El panel registra cada producto en el momento en que
-- se cuenta.
-- Idempotente (CREATE OR REPLACE).
BEGIN;

CREATE OR REPLACE FUNCTION public.cerrar_conteo(p_count_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid; v_loc uuid; v_estado text; v_user uuid := auth.uid();
  r record;
  v_actual numeric;
  v_ajuste numeric;
  v_despues numeric;
  v_al_contar numeric;
  v_ajustados int := 0;
  v_sin_contar int;
  v_unidades numeric := 0;
BEGIN
  SELECT c.org_id, c.location_id, c.status INTO v_org, v_loc, v_estado
    FROM public.stock_counts c WHERE c.id = p_count_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El conteo no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre este conteo' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía cerrar un conteo y ajustar el stock.
  PERFORM public.exigir_permiso(v_org, 'inventory', 'edit', 'cerrar un conteo y ajustar el stock');
  IF v_estado <> 'abierto' THEN
    RAISE EXCEPTION 'El conteo ya está %', v_estado USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN
    SELECT i.id, i.product_id, i.counted, i.counted_at, i.expected, p.name
    FROM public.stock_count_items i
    JOIN public.products p ON p.id = i.product_id
    WHERE i.count_id = p_count_id AND i.counted IS NOT NULL
  LOOP
    -- Contra el stock del momento en que se contó ESE producto (20261105000900).
    -- Antes era contra el stock al cerrar: una venta hecha después de contar
    -- (ya descontada del sistema, y ya fuera del estante) volvía como ajuste a
    -- favor y el stock quedaba inflado.
    IF v_loc IS NULL THEN
      SELECT COALESCE(p.stock, 0) INTO v_actual FROM public.products p WHERE p.id = r.product_id;
    ELSE
      SELECT COALESCE(ls.stock, 0) INTO v_actual FROM public.location_stock ls
       WHERE ls.location_id = v_loc AND ls.product_id = r.product_id;
      v_actual := COALESCE(v_actual, 0);
    END IF;

    -- Lo que se movió después de contarlo (ventas, compras), sin los ajustes de
    -- este mismo conteo.
    SELECT COALESCE(sum(m.quantity), 0) INTO v_despues
      FROM public.stock_movements m
     WHERE m.org_id = v_org AND m.product_id = r.product_id
       AND m.created_at > COALESCE(r.counted_at, now())
       AND (v_loc IS NULL OR m.location_id = v_loc)
       AND NOT (m.reference_type = 'stock_count' AND m.reference_id IS NOT DISTINCT FROM p_count_id);
    v_al_contar := v_actual - v_despues;
    v_ajuste := r.counted - v_al_contar;

    UPDATE public.stock_count_items
       SET stock_al_cerrar = v_actual, ajuste = v_ajuste
     WHERE id = r.id;

    IF v_ajuste <> 0 THEN
      -- Por la única función que mueve stock. Escribirlo a mano acá sería
      -- repetir exactamente el error que hizo falta contar el inventario.
      PERFORM public.record_stock_movement(
        p_org_id=>v_org, p_product_id=>r.product_id, p_variant_id=>NULL,
        p_product_name=>r.name, p_variant_name=>NULL,
        p_movement_type=>'count_adjustment', p_quantity=>v_ajuste,
        p_reference_type=>'stock_count', p_reference_id=>p_count_id,
        p_notes=>format('Conteo físico: esperado %s, había %s al contar, contado %s', trim_scale(r.expected), trim_scale(v_al_contar), trim_scale(r.counted)),
        p_created_by=>v_user, p_location_id=>v_loc
      );
      v_ajustados := v_ajustados + 1;
      v_unidades := v_unidades + abs(v_ajuste);
    END IF;
  END LOOP;

  SELECT count(*) INTO v_sin_contar
    FROM public.stock_count_items WHERE count_id = p_count_id AND counted IS NULL;

  UPDATE public.stock_counts
     SET status = 'cerrado', closed_at = now(), closed_by = v_user
   WHERE id = p_count_id;

  RETURN jsonb_build_object(
    'productos_ajustados', v_ajustados,
    'unidades_corregidas', v_unidades,
    -- Se informa a propósito: cerrar con la mitad sin contar es válido —un
    -- conteo cíclico cuenta un sector por vez— pero tiene que verse.
    'sin_contar', v_sin_contar
  );
END;
$function$;

CREATE INDEX IF NOT EXISTS idx_stock_movements_producto_fecha
  ON public.stock_movements (org_id, product_id, created_at);

UPDATE public.security_function_contracts sfc
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-11-05'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'cerrar_conteo'
   AND sfc.function_name = p.proname
   AND sfc.identity_arguments = pg_get_function_identity_arguments(p.oid);

COMMIT;
