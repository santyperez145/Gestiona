-- ═══════════════════════════════════════════════════════════════════════════
-- Transferir entre sucursales sin inventar mercadería
--
-- La transferencia se hacía desde el navegador, con un read-modify-write sobre
-- `location_stock` (`upsertLocationStock` en LocationsPage). Tenía tres
-- problemas, y el primero crea stock de la nada:
--
-- **1. Inventaba unidades.** El origen se escribía con
-- `Math.max(0, stock + delta)` y el destino con un INSERT del delta completo.
-- Reproducido contra la base: con 10 unidades en el origen, transferir 50 deja
-- **origen 0, destino 50** — la suma por sucursal da 50 y el total de la
-- organización sigue diciendo 10. Cuarenta unidades salidas de ningún lado.
-- Peor todavía, si el origen no tenía fila, la resta se descartaba entera y el
-- destino igual sumaba.
--
-- **2. Se perdían transferencias simultáneas.** Leer, sumar en JavaScript y
-- escribir no es atómico: dos transferencias a la vez se pisan y una desaparece.
--
-- **3. No dejaban rastro en el Kardex.** `stock_movements` no registraba nada,
-- así que la mercadería cambiaba de sucursal sin explicación en el historial —
-- justo lo que hay que auditar cuando falta algo.
--
-- Ahora es un RPC: valida contra lo que hay, mueve las dos puntas en la misma
-- transacción y deja los dos asientos.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.transfer_stock_between_locations(
  p_from_location_id uuid,
  p_to_location_id   uuid,
  p_product_id       uuid,
  p_quantity         integer,
  p_notes            text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org      uuid;
  v_user     uuid := auth.uid();
  v_nombre   text;
  v_disp     integer;
  v_origen   integer;
  v_destino  integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad a transferir tiene que ser mayor que cero'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'El origen y el destino son la misma sucursal'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.org_id, p.name INTO v_org, v_nombre
    FROM public.products p WHERE p.id = p_product_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El producto no existe' USING ERRCODE = 'no_data_found';
  END IF;

  -- SECURITY DEFINER saltea la RLS: el control de acceso es esta línea.
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre este producto' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Las dos sucursales tienen que ser de la misma organización que el producto:
  -- si no, una transferencia movería mercadería entre tenants.
  IF (SELECT count(*) FROM public.locations l
       WHERE l.id IN (p_from_location_id, p_to_location_id) AND l.org_id = v_org) <> 2 THEN
    RAISE EXCEPTION 'Alguna de las sucursales no pertenece a esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- FOR UPDATE: dos transferencias simultáneas del mismo producto se serializan
  -- en vez de pisarse. Es lo que el read-modify-write del cliente no podía dar.
  SELECT ls.stock INTO v_disp
    FROM public.location_stock ls
   WHERE ls.location_id = p_from_location_id AND ls.product_id = p_product_id
     FOR UPDATE;

  IF COALESCE(v_disp, 0) < p_quantity THEN
    RAISE EXCEPTION 'En la sucursal de origen hay % unidades de "%" y se quieren mover %',
      COALESCE(v_disp, 0), v_nombre, p_quantity USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Las dos puntas por `record_stock_movement`, que es el único lugar que mueve
  -- stock. Mantiene `location_stock` y deja el asiento en el Kardex. El efecto
  -- neto sobre `products.stock` es cero —baja q y sube q— porque una
  -- transferencia no cambia cuánto tiene la organización, sólo dónde está.
  PERFORM public.record_stock_movement(
    p_org_id=>v_org, p_product_id=>p_product_id, p_variant_id=>NULL,
    p_product_name=>v_nombre, p_variant_name=>NULL,
    p_movement_type=>'transfer_out', p_quantity=>-p_quantity,
    p_reference_type=>'location_transfer', p_reference_id=>NULL,
    p_notes=>p_notes, p_created_by=>v_user,
    p_location_id=>p_from_location_id
  );

  PERFORM public.record_stock_movement(
    p_org_id=>v_org, p_product_id=>p_product_id, p_variant_id=>NULL,
    p_product_name=>v_nombre, p_variant_name=>NULL,
    p_movement_type=>'transfer_in', p_quantity=>p_quantity,
    p_reference_type=>'location_transfer', p_reference_id=>NULL,
    p_notes=>p_notes, p_created_by=>v_user,
    p_location_id=>p_to_location_id
  );

  INSERT INTO public.stock_transfers (
    org_id, from_location_id, to_location_id, product_id, product_name,
    quantity, notes, transferred_by
  ) VALUES (
    v_org, p_from_location_id, p_to_location_id, p_product_id, v_nombre,
    p_quantity, p_notes, v_user
  );

  SELECT stock INTO v_origen FROM public.location_stock
   WHERE location_id = p_from_location_id AND product_id = p_product_id;
  SELECT stock INTO v_destino FROM public.location_stock
   WHERE location_id = p_to_location_id AND product_id = p_product_id;

  RETURN jsonb_build_object(
    'producto', v_nombre,
    'origen',   COALESCE(v_origen, 0),
    'destino',  COALESCE(v_destino, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.transfer_stock_between_locations IS
  'Mueve stock entre dos sucursales de la misma organización. Valida contra lo que hay en el origen, serializa con FOR UPDATE y deja los dos asientos en el Kardex. Reemplaza el read-modify-write del cliente, que con Math.max(0, ...) inventaba unidades: transferir 50 teniendo 10 dejaba origen 0 y destino 50.';

REVOKE ALL ON FUNCTION public.transfer_stock_between_locations(uuid, uuid, uuid, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.transfer_stock_between_locations(uuid, uuid, uuid, integer, text) TO authenticated;

-- ── `location_stock` deja de escribirse desde el navegador ────────────────
--
-- La policy era `ALL`, así que cualquier miembro podía escribir la tabla
-- directamente — que es exactamente como se inventaban las 40 unidades. Ahora
-- se lee desde la UI y se escribe sólo por las funciones que mueven stock, que
-- son `SECURITY DEFINER` y validan.
DROP POLICY IF EXISTS location_stock_org_access ON public.location_stock;

CREATE POLICY location_stock_org_read ON public.location_stock
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

COMMENT ON TABLE public.location_stock IS
  'Stock por sucursal. Sólo lectura desde la UI: lo escriben record_stock_movement y transfer_stock_between_locations, que validan. Antes tenía una policy ALL y el cliente lo escribía a mano con un read-modify-write que inventaba unidades.';
