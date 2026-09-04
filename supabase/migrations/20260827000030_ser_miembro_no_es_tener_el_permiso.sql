-- P1-04 — Ser miembro no es tener el permiso
--
-- ── Qué se encontró ───────────────────────────────────────────────────────
--
-- La app tiene una matriz de permisos en Admin → Permisos: por rol y por
-- módulo, con `can_view / can_create / can_edit / can_delete / can_export`. La
-- base tiene `has_permission(org, módulo, acción)`, que la lee y es correcta:
-- deny by default para quien no es miembro, override explícito para owner y
-- admin, defaults por rol para vendedor y viewer.
--
-- ⚠️ Pero las funciones que mueven el stock no la llamaban. Chequeaban
-- membresía —«sos de este comercio»— y nada más. Medido el 2026-08-27 contra
-- producción, como `authenticated` de verdad y con una membresía `vendedor`
-- real, dentro de una transacción revertida:
--
--     matriz: puede editar inventario  →  false
--     abrir_conteo(...)                →  PASÓ
--
-- Cerrar ese conteo llama a `record_stock_movement`, que es la ÚNICA autoridad
-- sobre `products.stock`, `product_variants.stock` y `location_stock`. Es
-- decir: el comercio desmarcaba «Inventario» para un empleado, la pantalla
-- desaparecía del menú, y el empleado podía reescribir el stock igual llamando
-- la RPC. La promesa de la UI no existía del lado del servidor.
--
-- 📌 Es exactamente el caso que la auditoría de 2026-08-24 nombra en P1-04:
-- «RLS evita que una organización vea datos de otra, pero no reemplaza *este
-- empleado puede ver stock, pero no ajustarlo*».
--
-- ── Qué NO era un agujero, y por qué importa decirlo ──────────────────────
--
-- El escaneo inicial marcaba también `record_stock_movement`,
-- `ledger_contraasentar` y `pago_reintegro_preparar` como «no chequean nada».
-- No son alcanzables: `authenticated` no tiene EXECUTE sobre ninguna de las
-- tres. Y `save_afip_config` sí chequea —exige owner o admin—, así que su
-- GRANT a `anon` es desprolijo pero no abre nada: `auth.uid()` es NULL y la
-- función rechaza. Un escaneo de texto no distingue eso; hay que mirar los
-- privilegios y leer el cuerpo.
--
-- ── Cómo se cierra ────────────────────────────────────────────────────────
--
-- 1. `exigir_permiso()` — una sola puerta, para que la decisión no se
--    reimplemente en nueve lugares con nueve criterios distintos.
-- 2. Las nueve funciones que mueven stock o plata desde el navegador la
--    llaman, después de la membresía y antes de escribir nada.
-- 3. `ledger_asentar_venta` y `ledger_asentar_gasto` pierden el EXECUTE de
--    `authenticated`: las llaman los triggers, nadie desde el cliente
--    (verificado con grep sobre `src/` y `supabase/functions/`).
-- 4. `audit_rpc_sin_permiso` es la vista guardia y tiene que estar VACÍA.
--
-- Los cuerpos de las nueve se regeneraron desde `pg_get_functiondef` con un
-- script, insertando la guarda — no se reescribieron de memoria. CONTRIBUTING.md:
-- reescribir una función grande a mano es como casi se rompe
-- `mark_store_order_paid`.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. La puerta única
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.exigir_permiso(
  p_org uuid, p_modulo text, p_accion text, p_que text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- ⚠️ El servidor no pasa por la matriz, y no es una excepción cómoda: la
  -- matriz responde «¿esta PERSONA puede?», y cuando corre una Edge Function
  -- con `service_role` no hay persona a la que preguntarle. `adjust_stock` ya
  -- distingue los dos casos y la API pública lo usa así; sin esta rama,
  -- agregar la guarda rompería el endpoint de ajuste de stock.
  --
  -- `IS NOT DISTINCT FROM` y no `=`: con `auth.role()` en NULL, un `=` da NULL
  -- y el IF no entra. Es el mismo NULL que el 2026-08-26 dejaba autorizado un
  -- reintegro.
  IF auth.uid() IS NULL AND auth.role() IS NOT DISTINCT FROM 'service_role' THEN
    RETURN;
  END IF;

  IF NOT public.has_permission(p_org, p_modulo, p_accion) THEN
    RAISE EXCEPTION 'No tenés permiso para %', p_que
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Pedile a un administrador que habilite el módulo en Ajustes → Equipo → Permisos.';
  END IF;
END $$;

COMMENT ON FUNCTION public.exigir_permiso(uuid, text, text, text) IS
  'Autorización funcional: falla si el usuario no tiene el permiso del módulo. '
  'Va DESPUÉS del chequeo de membresía, no en su lugar: son dos preguntas '
  'distintas —de qué comercio sos, y qué podés hacer dentro—.';

GRANT EXECUTE ON FUNCTION public.exigir_permiso(uuid, text, text, text)
  TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Las nueve funciones, regeneradas con la guarda adentro
-- ═══════════════════════════════════════════════════════════════════════════

-- ── abrir_conteo ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.abrir_conteo(p_org_id uuid, p_location_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_solo_con_stock boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_id    uuid;
  v_items int;
BEGIN
  IF NOT public.is_org_member(p_org_id, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía abrir un conteo físico.
  PERFORM public.exigir_permiso(p_org_id, 'inventory', 'edit', 'abrir un conteo físico');

  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l WHERE l.id = p_location_id AND l.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'La sucursal no pertenece a esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Dos conteos abiertos a la vez sobre el mismo alcance se pisan al cerrar: el
  -- segundo ajustaría contra un stock que el primero ya movió.
  IF EXISTS (
    SELECT 1 FROM public.stock_counts c
    WHERE c.org_id = p_org_id AND c.status = 'abierto'
      AND c.location_id IS NOT DISTINCT FROM p_location_id
  ) THEN
    RAISE EXCEPTION 'Ya hay un conteo abierto para ese alcance. Cerralo o cancelalo primero.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.stock_counts (org_id, location_id, notes, opened_by)
  VALUES (p_org_id, p_location_id, p_notes, v_user)
  RETURNING id INTO v_id;

  -- La foto de lo esperado. Con sucursal se cuenta el stock de esa sucursal;
  -- sin sucursal, el total de la organización.
  INSERT INTO public.stock_count_items (count_id, org_id, product_id, expected)
  SELECT v_id, p_org_id, p.id,
         CASE WHEN p_location_id IS NULL THEN COALESCE(p.stock, 0)
              ELSE COALESCE((SELECT ls.stock FROM public.location_stock ls
                              WHERE ls.location_id = p_location_id AND ls.product_id = p.id), 0)
         END
  FROM public.products p
  WHERE p.org_id = p_org_id
    AND (NOT p_solo_con_stock OR COALESCE(p.stock, 0) <> 0);

  GET DIAGNOSTICS v_items = ROW_COUNT;

  RETURN jsonb_build_object('conteo_id', v_id, 'productos', v_items);
END;
$function$
;

-- ── adjust_stock ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adjust_stock(p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_new_stock integer, p_notes text, p_created_by uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_stock integer;
  v_delta integer;
  v_product_name text;
  v_variant_name text;
  v_movement_type text;
  v_location_id uuid := p_location_id;
  v_active_locations integer;
BEGIN
  IF p_new_stock < 0 THEN
    RAISE EXCEPTION 'El stock objetivo no puede ser negativo';
  END IF;
  IF auth.uid() IS NULL THEN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF auth.uid() IS DISTINCT FROM p_created_by THEN
    RAISE EXCEPTION 'Unauthorized: el actor no coincide con la sesión';
  END IF;
  IF NOT public.is_org_member(p_org_id, p_created_by) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía ajustar el stock a mano.
  PERFORM public.exigir_permiso(p_org_id, 'inventory', 'edit', 'ajustar el stock a mano');

  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado en la organización';
  END IF;
  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'Variante no encontrada para el producto';
    END IF;
  END IF;

  SELECT count(*) INTO v_active_locations
  FROM public.locations
  WHERE org_id = p_org_id AND active;

  IF v_location_id IS NULL AND v_active_locations = 1 THEN
    SELECT min(id::text)::uuid INTO v_location_id
    FROM public.locations
    WHERE org_id = p_org_id AND active;
  END IF;
  IF v_location_id IS NULL AND p_variant_id IS NOT NULL AND v_active_locations > 1 THEN
    RAISE EXCEPTION 'Elegí el depósito para ajustar esta variante: hay % sucursales activas', v_active_locations
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = v_location_id AND l.org_id = p_org_id AND l.active
  ) THEN
    RAISE EXCEPTION 'El depósito tiene que estar activo y pertenecer a la organización'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_location_id IS NOT NULL AND p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_current_stock
    FROM public.location_variant_stock
    WHERE location_id = v_location_id AND product_id = p_product_id AND variant_id = p_variant_id
    FOR UPDATE;
  ELSIF v_location_id IS NOT NULL THEN
    SELECT stock INTO v_current_stock
    FROM public.location_stock
    WHERE location_id = v_location_id AND product_id = p_product_id
    FOR UPDATE;
  ELSIF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_current_stock
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
  ELSE
    SELECT stock INTO v_current_stock
    FROM public.products
    WHERE id = p_product_id AND org_id = p_org_id;
  END IF;

  v_current_stock := COALESCE(v_current_stock, 0);
  v_delta := p_new_stock - v_current_stock;
  IF v_delta = 0 THEN
    RETURN NULL;
  END IF;
  v_movement_type := CASE WHEN v_delta > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END;

  RETURN public.record_stock_movement(
    p_org_id => p_org_id,
    p_product_id => p_product_id,
    p_variant_id => p_variant_id,
    p_product_name => v_product_name,
    p_variant_name => v_variant_name,
    p_movement_type => v_movement_type,
    p_quantity => v_delta,
    p_reference_type => 'manual',
    p_notes => p_notes,
    p_created_by => p_created_by,
    p_location_id => v_location_id
  );
END;
$function$
;

-- ── asignar_a_ubicacion ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.asignar_a_ubicacion(p_bin_id uuid, p_product_id uuid, p_cantidad numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org      uuid;
  v_user     uuid := auth.uid();
  v_location uuid;
  v_nombre   text;
  v_en_sucursal numeric;
  v_otras    numeric;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad < 0 THEN
    RAISE EXCEPTION 'La cantidad no puede ser negativa'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT b.org_id, b.location_id INTO v_org, v_location
    FROM public.warehouse_bins b WHERE b.id = p_bin_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'La posición no existe' USING ERRCODE = 'no_data_found';
  END IF;

  -- SECURITY DEFINER saltea la RLS: el control de acceso es esta línea.
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta posición' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía ubicar stock en una posición.
  PERFORM public.exigir_permiso(v_org, 'inventory', 'edit', 'ubicar stock en una posición');

  IF v_location IS NULL THEN
    RAISE EXCEPTION 'La posición no está asignada a ninguna sucursal'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.name INTO v_nombre FROM public.products p
   WHERE p.id = p_product_id AND p.org_id = v_org;
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'El producto no existe en esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Cuánto tiene la sucursal de ese producto.
  SELECT COALESCE(ls.stock, 0) INTO v_en_sucursal
    FROM public.location_stock ls
   WHERE ls.location_id = v_location AND ls.product_id = p_product_id;

  -- Cuánto ya está guardado en OTRAS posiciones de la misma sucursal.
  SELECT COALESCE(sum(bs.quantity), 0) INTO v_otras
    FROM public.bin_stock bs
    JOIN public.warehouse_bins b ON b.id = bs.bin_id
   WHERE b.location_id = v_location
     AND bs.product_id = p_product_id
     AND bs.bin_id <> p_bin_id;

  IF v_otras + p_cantidad > COALESCE(v_en_sucursal, 0) THEN
    RAISE EXCEPTION
      'En esa sucursal hay % unidades de "%" y ya hay % ubicadas: no se pueden poner % más',
      COALESCE(v_en_sucursal, 0), v_nombre, v_otras, p_cantidad
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_cantidad = 0 THEN
    -- Cero es "sacar de esta posición", no una fila con cero.
    DELETE FROM public.bin_stock WHERE bin_id = p_bin_id AND product_id = p_product_id;
  ELSE
    INSERT INTO public.bin_stock (org_id, bin_id, product_id, quantity, updated_at)
    VALUES (v_org, p_bin_id, p_product_id, p_cantidad, now())
    ON CONFLICT (bin_id, product_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, updated_at = now();
  END IF;

  RETURN jsonb_build_object(
    'producto', v_nombre,
    'en_sucursal', COALESCE(v_en_sucursal, 0),
    'ubicado', v_otras + p_cantidad,
    'sin_ubicar', COALESCE(v_en_sucursal, 0) - (v_otras + p_cantidad)
  );
END;
$function$
;

-- ── cancelar_conteo ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancelar_conteo(p_count_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org uuid; v_estado text;
BEGIN
  SELECT c.org_id, c.status INTO v_org, v_estado
    FROM public.stock_counts c WHERE c.id = p_count_id;
  IF v_org IS NULL OR NOT public.is_org_member(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre este conteo' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía cancelar un conteo.
  PERFORM public.exigir_permiso(v_org, 'inventory', 'edit', 'cancelar un conteo');
  IF v_estado <> 'abierto' THEN
    RAISE EXCEPTION 'El conteo ya está %', v_estado USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.stock_counts SET status = 'cancelado', closed_at = now(), closed_by = auth.uid()
   WHERE id = p_count_id;
END;
$function$
;

-- ── cerrar_conteo ───────────────────────────────────────────────────────
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
    SELECT i.id, i.product_id, i.counted, i.expected, p.name
    FROM public.stock_count_items i
    JOIN public.products p ON p.id = i.product_id
    WHERE i.count_id = p_count_id AND i.counted IS NOT NULL
  LOOP
    -- Contra el stock del momento del cierre, no contra lo congelado: las
    -- ventas ocurridas mientras se contaba son reales y ya se descontaron.
    IF v_loc IS NULL THEN
      SELECT COALESCE(p.stock, 0) INTO v_actual FROM public.products p WHERE p.id = r.product_id;
    ELSE
      SELECT COALESCE(ls.stock, 0) INTO v_actual FROM public.location_stock ls
       WHERE ls.location_id = v_loc AND ls.product_id = r.product_id;
      v_actual := COALESCE(v_actual, 0);
    END IF;

    v_ajuste := r.counted - v_actual;

    UPDATE public.stock_count_items
       SET stock_al_cerrar = v_actual, ajuste = v_ajuste
     WHERE id = r.id;

    IF v_ajuste <> 0 THEN
      -- Por la única función que mueve stock. Escribirlo a mano acá sería
      -- repetir exactamente el error que hizo falta contar el inventario.
      PERFORM public.record_stock_movement(
        p_org_id=>v_org, p_product_id=>r.product_id, p_variant_id=>NULL,
        p_product_name=>r.name, p_variant_name=>NULL,
        p_movement_type=>'count_adjustment', p_quantity=>v_ajuste::int,
        p_reference_type=>'stock_count', p_reference_id=>p_count_id,
        p_notes=>format('Conteo físico: esperado %s, contado %s', r.expected, r.counted),
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
$function$
;

-- ── record_member_stock_movement ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_member_stock_movement(p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_movement_type text, p_quantity integer, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_unit_cost_usd numeric DEFAULT NULL::numeric, p_unit_price_ars numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_name text;
  v_variant_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía registrar un movimiento de stock.
  PERFORM public.exigir_permiso(p_org_id, 'inventory', 'edit', 'registrar un movimiento de stock');

  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'La cantidad del movimiento no puede ser cero';
  END IF;

  IF p_movement_type NOT IN ('return', 'return_in', 'invoice_credit_note', 'influencer_exchange') THEN
    RAISE EXCEPTION 'Tipo de movimiento no permitido: %', p_movement_type;
  END IF;

  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado en la organización';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'Variante no encontrada para el producto';
    END IF;
  END IF;

  RETURN public.record_stock_movement(
    p_org_id => p_org_id,
    p_product_id => p_product_id,
    p_variant_id => p_variant_id,
    p_product_name => v_product_name,
    p_variant_name => v_variant_name,
    p_movement_type => p_movement_type,
    p_quantity => p_quantity,
    p_reference_type => p_reference_type,
    p_reference_id => p_reference_id,
    p_unit_cost_usd => p_unit_cost_usd,
    p_unit_price_ars => p_unit_price_ars,
    p_notes => p_notes,
    p_created_by => auth.uid()
  );
END;
$function$
;

-- ── registrar_conteo ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_conteo(p_count_id uuid, p_product_id uuid, p_cantidad numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid; v_estado text; v_user uuid := auth.uid(); v_esperado numeric;
BEGIN
  SELECT c.org_id, c.status INTO v_org, v_estado
    FROM public.stock_counts c WHERE c.id = p_count_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El conteo no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre este conteo' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía registrar un conteo.
  PERFORM public.exigir_permiso(v_org, 'inventory', 'edit', 'registrar un conteo');
  IF v_estado <> 'abierto' THEN
    RAISE EXCEPTION 'El conteo ya está %', v_estado USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad < 0 THEN
    RAISE EXCEPTION 'La cantidad contada no puede ser negativa'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.stock_count_items
     SET counted = p_cantidad, counted_by = v_user, counted_at = now()
   WHERE count_id = p_count_id AND product_id = p_product_id
  RETURNING expected INTO v_esperado;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese producto no está en el conteo' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN jsonb_build_object(
    'esperado', v_esperado,
    'contado', p_cantidad,
    'diferencia', p_cantidad - v_esperado
  );
END;
$function$
;

-- ── transfer_stock_between_locations ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_stock_between_locations(p_from_location_id uuid, p_to_location_id uuid, p_product_id uuid, p_quantity integer, p_notes text DEFAULT NULL::text, p_variant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org          uuid;
  v_user         uuid := auth.uid();
  v_product_name text;
  v_variant_name text;
  v_disp         integer;
  v_origen       integer;
  v_destino      integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad a transferir tiene que ser mayor que cero'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'El origen y el destino son la misma sucursal'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.org_id, p.name INTO v_org, v_product_name
  FROM public.products p
  WHERE p.id = p_product_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El producto no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre este producto' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía transferir stock entre sucursales.
  PERFORM public.exigir_permiso(v_org, 'inventory', 'edit', 'transferir stock entre sucursales');
  IF (
    SELECT count(*) FROM public.locations l
    WHERE l.id IN (p_from_location_id, p_to_location_id)
      AND l.org_id = v_org
      AND l.active
  ) <> 2 THEN
    RAISE EXCEPTION 'Origen y destino tienen que ser sucursales activas de esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_variant_id IS NULL AND EXISTS (
    SELECT 1 FROM public.product_variants v WHERE v.product_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Este producto tiene variantes: elegí el talle, sabor o presentación que vas a transferir'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT v.variant_name INTO v_variant_name
    FROM public.product_variants v
    WHERE v.id = p_variant_id
      AND v.product_id = p_product_id
      AND v.org_id = v_org;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'La variante no pertenece al producto de esta organización'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- La fila exacta de la variante es la cerradura. Dos transferencias de la
    -- misma presentación no leen el mismo saldo y no pueden gastar dos veces.
    SELECT lvs.stock INTO v_disp
    FROM public.location_variant_stock lvs
    WHERE lvs.location_id = p_from_location_id
      AND lvs.product_id = p_product_id
      AND lvs.variant_id = p_variant_id
    FOR UPDATE;
  ELSE
    SELECT ls.stock INTO v_disp
    FROM public.location_stock ls
    WHERE ls.location_id = p_from_location_id
      AND ls.product_id = p_product_id
    FOR UPDATE;
  END IF;

  IF COALESCE(v_disp, 0) < p_quantity THEN
    RAISE EXCEPTION 'En la sucursal de origen hay % unidades de "%" y se quieren mover %',
      COALESCE(v_disp, 0),
      CASE WHEN v_variant_name IS NULL THEN v_product_name
           ELSE v_product_name || ' (' || v_variant_name || ')' END,
      p_quantity
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM public.record_stock_movement(
    p_org_id=>v_org, p_product_id=>p_product_id, p_variant_id=>p_variant_id,
    p_product_name=>v_product_name, p_variant_name=>v_variant_name,
    p_movement_type=>'transfer_out', p_quantity=>-p_quantity,
    p_reference_type=>'location_transfer', p_reference_id=>NULL,
    p_notes=>p_notes, p_created_by=>v_user,
    p_location_id=>p_from_location_id
  );
  PERFORM public.record_stock_movement(
    p_org_id=>v_org, p_product_id=>p_product_id, p_variant_id=>p_variant_id,
    p_product_name=>v_product_name, p_variant_name=>v_variant_name,
    p_movement_type=>'transfer_in', p_quantity=>p_quantity,
    p_reference_type=>'location_transfer', p_reference_id=>NULL,
    p_notes=>p_notes, p_created_by=>v_user,
    p_location_id=>p_to_location_id
  );

  INSERT INTO public.stock_transfers (
    org_id, from_location_id, to_location_id, product_id, variant_id,
    product_name, variant_name, quantity, notes, transferred_by
  ) VALUES (
    v_org, p_from_location_id, p_to_location_id, p_product_id, p_variant_id,
    v_product_name, v_variant_name, p_quantity, p_notes, v_user
  );

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_origen FROM public.location_variant_stock
    WHERE location_id = p_from_location_id AND variant_id = p_variant_id;
    SELECT stock INTO v_destino FROM public.location_variant_stock
    WHERE location_id = p_to_location_id AND variant_id = p_variant_id;
  ELSE
    SELECT stock INTO v_origen FROM public.location_stock
    WHERE location_id = p_from_location_id AND product_id = p_product_id;
    SELECT stock INTO v_destino FROM public.location_stock
    WHERE location_id = p_to_location_id AND product_id = p_product_id;
  END IF;

  RETURN jsonb_build_object(
    'producto', CASE WHEN v_variant_name IS NULL THEN v_product_name
                     ELSE v_product_name || ' — ' || v_variant_name END,
    'variant_id', p_variant_id,
    'origen', COALESCE(v_origen, 0),
    'destino', COALESCE(v_destino, 0)
  );
END;
$function$
;

-- ── wallet_solicitar_retiro ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_solicitar_retiro(p_org uuid, p_monto numeric, p_cuenta uuid DEFAULT NULL::uuid, p_clave text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_monto   numeric;
  v_saldo   jsonb;
  v_cuenta  public.wallet_bank_accounts;
  v_entry   uuid;
  v_id      uuid;
  v_reserva jsonb;
BEGIN
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Finanzas» desmarcado en Admin → Permisos podía retirar dinero de la billetera.
  PERFORM public.exigir_permiso(p_org, 'finance', 'edit', 'retirar dinero de la billetera');

  v_monto := ROUND(COALESCE(p_monto, 0), 2);
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a retirar tiene que ser mayor a cero';
  END IF;

  -- Un retiro es una mutación crítica: si el navegador reintenta, no puede
  -- salir dos veces. H1 ya resuelve esto y se reusa en vez de inventar otra
  -- forma.
  v_reserva := public.idempotencia_reservar(
    p_org, 'wallet_retiro', p_clave,
    jsonb_build_object('monto', v_monto, 'cuenta', p_cuenta));

  IF NOT (v_reserva->>'ejecutar')::boolean THEN
    RETURN (v_reserva->'respuesta') || jsonb_build_object('reintento', true);
  END IF;

  -- ⚠️ El candado va ANTES de leer el saldo. Leer y después bloquear deja
  -- pasar a dos pedidos que vieron el mismo disponible.
  PERFORM pg_advisory_xact_lock(hashtextextended('wallet:' || p_org::text, 0));

  v_saldo := public.wallet_saldo(p_org);

  IF v_monto > (v_saldo->>'retirable')::numeric THEN
    PERFORM public.idempotencia_fallar(p_org, 'wallet_retiro', p_clave, 'saldo insuficiente');
    RAISE EXCEPTION
      'No alcanza el saldo disponible: querés retirar $% y podés retirar $%',
      v_monto, v_saldo->>'retirable';
  END IF;

  -- La cuenta destino: la indicada, o la predeterminada.
  IF p_cuenta IS NOT NULL THEN
    SELECT * INTO v_cuenta FROM public.wallet_bank_accounts
     WHERE id = p_cuenta AND org_id = p_org AND is_active;
  ELSE
    SELECT * INTO v_cuenta FROM public.wallet_bank_accounts
     WHERE org_id = p_org AND is_default AND is_active LIMIT 1;
  END IF;

  IF v_cuenta.id IS NULL THEN
    PERFORM public.idempotencia_fallar(p_org, 'wallet_retiro', p_clave, 'sin cuenta destino');
    RAISE EXCEPTION 'Cargá una cuenta bancaria antes de retirar';
  END IF;

  -- ⚠️ El id del retiro se genera ACÁ, antes del asiento.
  --
  -- La primera versión asentaba, insertaba el retiro y después actualizaba el
  -- asiento para apuntarle. La regla de inmutabilidad del libro lo rechazó —y
  -- tenía razón—: un asiento no se toca después de escrito. Que la propia regla
  -- haya frenado mi código es la señal de que sirve.
  v_id := gen_random_uuid();

  -- El asiento sale primero: si falla, no queda un retiro sin respaldo contable.
  v_entry := public.ledger_asentar(
    p_org, 'Retiro a ' || v_cuenta.alias,
    jsonb_build_array(
      jsonb_build_object('cuenta', '1.1.02', 'debe',  v_monto, 'detalle', 'Ingreso a la cuenta bancaria'),
      jsonb_build_object('cuenta', '1.1.04', 'haber', v_monto, 'detalle', 'Sale de la billetera')),
    CURRENT_DATE, 'retiro', v_id);

  INSERT INTO public.wallet_withdrawals (
    id, org_id, bank_account_id, monto, estado, entry_id, solicitado_por)
  VALUES (v_id, p_org, v_cuenta.id, v_monto, 'solicitado', v_entry, auth.uid());

  PERFORM public.emitir_evento(p_org, 'billetera', v_id, 'retiro.solicitado',
    jsonb_build_object('withdrawal_id', v_id, 'monto', v_monto, 'cuenta', v_cuenta.alias));

  PERFORM public.idempotencia_completar(p_org, 'wallet_retiro', p_clave,
    jsonb_build_object('withdrawal_id', v_id, 'monto', v_monto));

  RETURN jsonb_build_object(
    'withdrawal_id', v_id, 'monto', v_monto, 'estado', 'solicitado',
    'cuenta', v_cuenta.alias, 'entry_id', v_entry);
END;
$function$
;
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Lo que el navegador no tiene por qué poder llamar
-- ═══════════════════════════════════════════════════════════════════════════

-- Estas dos asientan una venta o un gasto en el libro. Las llaman los triggers
-- `trg_asentar_venta` / `trg_asentar_gasto` y el backfill; ningún archivo de
-- `src/` ni de `supabase/functions/` las invoca. Con EXECUTE para
-- `authenticated` y sin chequeo de membresía, un miembro de un comercio podía
-- forzar un asiento en OTRO comercio pasándole un id ajeno. El asiento sería
-- idempotente y "correcto", pero es una escritura cruzada entre inquilinos.
REVOKE EXECUTE ON FUNCTION public.ledger_asentar_venta(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ledger_asentar_gasto(uuid) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. La guardia
-- ═══════════════════════════════════════════════════════════════════════════

-- Nada que mueva stock o plata desde el navegador puede saltear la matriz.
--
-- 📌 La condición mira la LLAMADA a la autoridad (`public.record_stock_movement(`
-- o `public.ledger_asentar(`), no la palabra suelta ni un `INSERT`. Las dos
-- cosas importan:
--   · `adjust_stock` no tiene un solo INSERT propio —escribe delegando—, así
--     que filtrar por `INSERT INTO` la dejaba afuera.
--   · `ledger_resultado` es un reporte que sólo NOMBRA `ledger_asentar_venta`
--     en un comentario; filtrar por la palabra la metía adentro.
--
-- Chequear rol (owner/admin) cuenta como puerta: es más estricto que la
-- matriz, no menos.
CREATE OR REPLACE VIEW public.audit_rpc_sin_permiso AS
SELECT p.proname AS funcion,
       pg_get_function_identity_arguments(p.oid) AS argumentos,
       (p.prosrc ~* 'public\.record_stock_movement\s*\(') AS mueve_stock,
       (p.prosrc ~* 'public\.ledger_asentar\s*\(')        AS mueve_plata
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND p.prokind = 'f'
  AND p.prorettype <> 'trigger'::regtype
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  AND p.prosrc ~* 'public\.(record_stock_movement|ledger_asentar)\s*\('
  AND p.prosrc !~* 'exigir_permiso|has_permission'
  AND p.prosrc !~* '(has_org_role|role IN \(|role = ANY)';

COMMENT ON VIEW public.audit_rpc_sin_permiso IS
  'Funciones llamables desde el navegador que mueven stock o plata sin exigir '
  'permiso del módulo ni rol. Tiene que estar vacía. Una fila significa que la '
  'matriz de Admin → Permisos promete algo que el servidor no aplica.';

GRANT SELECT ON public.audit_rpc_sin_permiso TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_user  uuid;
  v_filas int;
  v_paso  boolean;
  v_msg   text;
BEGIN
  -- ── a. La vista, vacía ──────────────────────────────────────────────────
  SELECT count(*) INTO v_filas FROM public.audit_rpc_sin_permiso;
  ASSERT v_filas = 0,
    'quedan ' || v_filas || ' RPC que mueven stock o plata sin exigir permiso';

  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ verificacion permisos',
          'zz-verif-' || substr(v_org::text, 1, 8), v_user);
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org, v_user, 'vendedor');

  -- ── b. Un vendedor sin permiso NO puede ─────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.abrir_conteo(v_org, NULL, 'ZZ', false);
    v_paso := true;
  EXCEPTION WHEN insufficient_privilege THEN
    v_paso := false;
  END;
  RESET ROLE;
  ASSERT NOT v_paso,
    'un vendedor con Inventario desmarcado TODAVIA puede abrir un conteo';

  -- ── c. ...y un admin SÍ ─────────────────────────────────────────────────
  -- ⚠️ Esta mitad no es decorativa. Una guarda que frena a todos también deja
  -- la vista vacía y también pasa el punto (b): sin este chequeo, romper la
  -- Toma Física para el dueño se vería igual que arreglarla.
  UPDATE public.memberships SET role = 'admin'
   WHERE org_id = v_org AND user_id = v_user;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.abrir_conteo(v_org, NULL, 'ZZ', false);
    v_paso := true;
  EXCEPTION WHEN OTHERS THEN
    v_paso := false; v_msg := SQLERRM;
  END;
  RESET ROLE;
  ASSERT v_paso,
    'un admin NO puede abrir un conteo: la guarda rompio la funcion — '
    || COALESCE(v_msg, '');

  -- ── d. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.organizations WHERE id = v_org;   -- el resto va en CASCADE
  SELECT count(*) INTO v_filas
    FROM public.organizations WHERE name = 'ZZ verificacion permisos';
  ASSERT v_filas = 0, 'quedaron restos ZZ: ' || v_filas;

  RAISE NOTICE 'OK: vista vacia; vendedor frenado; admin puede; sin restos';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000030', 'ser_miembro_no_es_tener_el_permiso')
ON CONFLICT DO NOTHING;
