-- Presupuestos: guardar con totales de la base y productos verificados.
--
-- Pedido del dueño 2026-10-14: «rearmá completamente la página de
-- presupuestos, quedó legacy: no toma los productos, sólo carga manual».
-- Medido en el código: el navegador calculaba subtotal y total y los
-- insertaba tal cual; no se podía editar un presupuesto; si fallaba la
-- numeración se inventaba `PRE-<timestamp>`.
--
-- `guardar_presupuesto` crea o edita (mientras no esté vendido: lo congela
-- trg_guard_presupuesto_convertido) y:
-- · recalcula cada renglón (cantidad × precio − descuento %) y los totales;
-- · verifica que cada producto y variante sean de este negocio y completa la
--   descripción, el SKU y la unidad desde el catálogo;
-- · numera con `next_quote_number` en la misma transacción;
-- · guarda los ítems con las claves que ya leen el PDF, el link de pago y la
--   caja (description, qty, unitPrice, total, productId) más las nuevas.
-- Corre con los permisos de quien llama: crear pide «ventas: crear» y editar
-- «ventas: editar», las mismas políticas de `quotes`.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.guardar_presupuesto(p_org uuid, p_id uuid, p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_items jsonb := coalesce(p_datos->'items', '[]'::jsonb);
  v_salida jsonb := '[]'::jsonb;
  it jsonb;
  v_desc text;
  v_cant numeric;
  v_precio numeric;
  v_dpct numeric;
  v_linea numeric;
  v_prod uuid;
  v_var uuid;
  v_nombre_producto text;
  v_sku text;
  v_unidad text;
  v_variante text;
  v_sub numeric := 0;
  v_descuento numeric;
  v_cliente uuid;
  v_nombre text;
  v_fila public.quotes;
  v_n int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No tenés acceso a este negocio' USING ERRCODE = '42501';
  END IF;
  v_nombre := nullif(btrim(coalesce(p_datos->>'customer_name', '')), '');
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'Elegí o escribí el cliente' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Agregá al menos un ítem' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_items) > 300 THEN
    RAISE EXCEPTION 'Un presupuesto puede tener hasta 300 ítems' USING ERRCODE = '22023';
  END IF;

  FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_n := v_n + 1;
    v_desc := left(nullif(btrim(coalesce(it->>'description', '')), ''), 300);
    IF coalesce(it->>'qty', '') !~ '^\s*\d+(\.\d+)?\s*$' OR coalesce(it->>'unitPrice', '0') !~ '^\s*\d+(\.\d+)?\s*$'
       OR coalesce(it->>'discountPct', '0') !~ '^\s*\d+(\.\d+)?\s*$' THEN
      RAISE EXCEPTION 'Ítem %: revisá cantidad, precio y descuento', v_n USING ERRCODE = '22023';
    END IF;
    v_cant := round((it->>'qty')::numeric, 3);
    v_precio := round(coalesce((it->>'unitPrice')::numeric, 0), 2);
    v_dpct := round(coalesce((it->>'discountPct')::numeric, 0), 2);
    IF v_cant <= 0 THEN
      RAISE EXCEPTION 'Ítem % (%): la cantidad tiene que ser mayor a cero', v_n, coalesce(v_desc, 'sin descripción') USING ERRCODE = '22023';
    END IF;
    IF v_dpct > 100 THEN
      RAISE EXCEPTION 'Ítem % (%): el descuento va de 0 a 100 %%', v_n, coalesce(v_desc, 'sin descripción') USING ERRCODE = '22023';
    END IF;

    v_prod := nullif(it->>'productId', '')::uuid;
    v_var := nullif(it->>'variantId', '')::uuid;
    v_sku := NULL; v_unidad := NULL; v_variante := NULL; v_nombre_producto := NULL;
    IF v_prod IS NOT NULL THEN
      SELECT name, sku, unidad_medida INTO v_nombre_producto, v_sku, v_unidad
        FROM public.products WHERE id = v_prod AND org_id = p_org;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ítem % (%): el producto ya no está en el catálogo', v_n, coalesce(v_desc, 'sin descripción') USING ERRCODE = '22023';
      END IF;
      IF v_var IS NOT NULL THEN
        SELECT variant_name, coalesce(sku, v_sku) INTO v_variante, v_sku
          FROM public.product_variants WHERE id = v_var AND product_id = v_prod;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Ítem % (%): la variante no es de ese producto', v_n, coalesce(v_desc, v_nombre_producto) USING ERRCODE = '22023';
        END IF;
      END IF;
      v_desc := coalesce(v_desc, concat_ws(' · ', v_nombre_producto, v_variante));
    ELSE
      v_var := NULL;
    END IF;
    IF v_desc IS NULL THEN
      RAISE EXCEPTION 'Ítem %: falta la descripción', v_n USING ERRCODE = '22023';
    END IF;

    v_linea := round(v_cant * v_precio * (1 - v_dpct / 100), 2);
    v_sub := v_sub + v_linea;
    v_salida := v_salida || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'description', v_desc, 'qty', v_cant, 'unitPrice', v_precio,
      'discountPct', nullif(v_dpct, 0), 'total', v_linea,
      'productId', v_prod, 'variantId', v_var, 'sku', v_sku,
      'unidad', nullif(v_unidad, 'unidad'))));
  END LOOP;

  IF coalesce(p_datos->>'discount_amount', '0') !~ '^\s*\d+(\.\d+)?\s*$' THEN
    RAISE EXCEPTION 'Revisá el descuento general' USING ERRCODE = '22023';
  END IF;
  v_descuento := round(coalesce((p_datos->>'discount_amount')::numeric, 0), 2);
  IF v_descuento > v_sub THEN
    RAISE EXCEPTION 'El descuento general supera el subtotal' USING ERRCODE = '22023';
  END IF;

  v_cliente := nullif(p_datos->>'customer_id', '')::uuid;
  IF v_cliente IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = v_cliente AND org_id = p_org) THEN
    RAISE EXCEPTION 'El cliente no es de este negocio' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.quotes (org_id, quote_number, customer_name, customer_id, customer_email, customer_phone,
                               items, subtotal, discount_amount, total, status, valid_until, notes, created_by)
    VALUES (p_org, public.next_quote_number(p_org), v_nombre, v_cliente,
            nullif(btrim(coalesce(p_datos->>'customer_email', '')), ''), nullif(btrim(coalesce(p_datos->>'customer_phone', '')), ''),
            v_salida, v_sub, v_descuento, v_sub - v_descuento, 'draft',
            nullif(p_datos->>'valid_until', '')::date, nullif(btrim(coalesce(p_datos->>'notes', '')), ''), auth.uid())
    RETURNING * INTO v_fila;
  ELSE
    UPDATE public.quotes
       SET customer_name = v_nombre, customer_id = v_cliente,
           customer_email = nullif(btrim(coalesce(p_datos->>'customer_email', '')), ''),
           customer_phone = nullif(btrim(coalesce(p_datos->>'customer_phone', '')), ''),
           items = v_salida, subtotal = v_sub, discount_amount = v_descuento, total = v_sub - v_descuento,
           valid_until = nullif(p_datos->>'valid_until', '')::date,
           notes = nullif(btrim(coalesce(p_datos->>'notes', '')), ''), updated_at = now()
     WHERE id = p_id AND org_id = p_org
     RETURNING * INTO v_fila;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se encontró el presupuesto o no tenés permiso para editarlo' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN to_jsonb(v_fila);
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_presupuesto(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_presupuesto(uuid, uuid, jsonb) TO authenticated, service_role;

COMMIT;
