-- ═══════════════════════════════════════════════════════════════════════════
-- Los dos caminos del costo respetan la moneda del producto
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Complemento de 20260826000060. Agregar `cost_ars` no sirve de nada si las dos
-- funciones por las que pasa toda venta siguen leyendo sólo dolares:
--
--   `precio_pos_autoritativo` — la autoridad del costo en el POS (C12). Con un
--   producto comprado en pesos devolvia **costo cero**, y el mostrador mostraba
--   margen perfecto sobre una venta que podia estar perdiendo plata.
--
--   `record_stock_movement` — el unico lugar que escribe el Kardex. Guardaba
--   solo `unit_cost_usd`, asi que un producto en pesos dejaba el movimiento sin
--   costo y el asiento contable salia en cero.
--
-- ⚠️ Y `record_stock_movement` ahora **congela el costo en pesos** del momento.
-- Es el estandar de Odoo, SAP Business One y Dynamics: la compra en moneda
-- extranjera se convierte una vez, en la transaccion, y la historia no se
-- vuelve a convertir. Antes el ledger multiplicaba `unit_cost_usd` por la
-- cotizacion **de hoy**, asi que una devaluacion reescribia el margen de las
-- ventas del mes pasado.
--
-- Las dos se regeneraron desde `pg_get_functiondef` con un script: son los dos
-- caminos por los que pasa toda venta y reescribirlas de memoria es como casi
-- se rompe `mark_store_order_paid`.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.precio_pos_autoritativo(p_org uuid, p_product_id uuid, p_variant_id uuid DEFAULT NULL::uuid, p_qty numeric DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resuelto jsonb;
  v_p          record;
  v_var_precio numeric;
  v_lista      numeric;
  v_vigente    numeric;
  v_promo      numeric;
  v_costo_usd  numeric;
  v_tc         numeric;
BEGIN
  SELECT p.id, p.sale_price_ars, p.discount_price_ars, p.category,
         p.cost_usd, p.total_cost_usd
    INTO v_p
    FROM public.products p
   WHERE p.id = p_product_id AND p.org_id = p_org;

  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'El producto no existe en esta organización';
  END IF;

  -- La variante puede pisar el precio del producto. Es el único override que
  -- vive en los datos y no en el navegador.
  SELECT v.price_override INTO v_var_precio
    FROM public.product_variants v
   WHERE v.id = p_variant_id AND v.org_id = p_org;

  v_lista := COALESCE(v_var_precio, v_p.sale_price_ars, 0);

  -- La oferta cargada en el producto. Sólo cuenta si mejora el precio: una
  -- "oferta" más cara que la lista es un dato mal cargado, no una oferta.
  v_vigente := CASE
    WHEN COALESCE(v_p.discount_price_ars, 0) > 0
     AND v_p.discount_price_ars < v_lista THEN v_p.discount_price_ars
    ELSE v_lista END;

  -- Las promociones se resuelven con la MISMA función que usa la tienda. Dos
  -- motores de promoción distintos terminan cobrando distinto en el mostrador
  -- y online, que es de los bugs más caros de encontrar.
  BEGIN
    v_promo := public.store_promo_price(
      p_org, p_product_id, v_p.category, v_lista, v_vigente * GREATEST(p_qty, 1));
  EXCEPTION WHEN OTHERS THEN
    v_promo := NULL;
  END;

  IF COALESCE(v_promo, 0) > 0 AND v_promo < v_vigente THEN
    v_vigente := v_promo;
  END IF;

  -- El costo NUNCA viene del cliente. Sale del producto.
  -- ⚠️ El costo sale del resolver, que respeta la moneda del producto. Antes
  -- era siempre `cost_usd × cotización`: un producto comprado en pesos daba
  -- costo cero y el POS mostraba margen perfecto.
  v_resuelto  := public.costo_unitario_ars(p_org, p_product_id, p_variant_id);
  v_costo_usd := COALESCE(NULLIF(v_p.total_cost_usd, 0), v_p.cost_usd, 0);

  SELECT s.exchange_rate INTO v_tc FROM public.settings s WHERE s.org_id = p_org LIMIT 1;

  RETURN jsonb_build_object(
    'precio_lista',   public.redondear_moneda(v_lista, 'ARS'),
    'precio_vigente', public.redondear_moneda(v_vigente, 'ARS'),
    'costo_usd',      v_costo_usd,
    'costo_ars',      NULLIF(v_resuelto->>'costo_ars', '')::numeric,
    'moneda_costo',   v_resuelto->>'moneda',
    'costo_fuente',   v_resuelto->>'fuente',
    'tipo_cambio',    v_tc,
    'promo_aplicada', (COALESCE(v_promo, 0) > 0 AND v_promo <= v_vigente));
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_stock_movement(p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_product_name text, p_variant_name text, p_movement_type text, p_quantity integer, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_unit_cost_usd numeric DEFAULT NULL::numeric, p_unit_price_ars numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resuelto jsonb;
  v_costo_ars numeric;
  v_stock_before INTEGER;
  v_stock_after  INTEGER;
  v_mov_id       UUID;
  v_location_id  UUID := p_location_id;
BEGIN
  -- Con una sola sucursal activa, cualquier stock sin ubicación sólo puede
  -- estar ahí. Así una variante creada después de habilitar sucursales no
  -- queda global e invisible para la tienda. Con dos o más no se adivina.
  IF v_location_id IS NULL THEN
    SELECT min(l.id::text)::uuid INTO v_location_id
    FROM public.locations l
    WHERE l.org_id = p_org_id AND l.active
    HAVING count(*) = 1;
  END IF;

  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = v_location_id AND l.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'La sucursal del movimiento no pertenece a la organización'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_stock_before
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id;
  ELSE
    SELECT stock INTO v_stock_before
    FROM public.products
    WHERE id = p_product_id AND org_id = p_org_id;
  END IF;
  v_stock_before := COALESCE(v_stock_before, 0);
  v_stock_after  := v_stock_before + p_quantity;

  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants
       SET stock = v_stock_after
     WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id;
    UPDATE public.products p
       SET stock = (
         SELECT COALESCE(SUM(pv.stock), 0)
         FROM public.product_variants pv
         WHERE pv.product_id = p.id
       )
     WHERE id = p_product_id AND org_id = p_org_id;
  ELSE
    UPDATE public.products
       SET stock = v_stock_after
     WHERE id = p_product_id AND org_id = p_org_id;
  END IF;

  IF v_location_id IS NOT NULL AND p_product_id IS NOT NULL THEN
    INSERT INTO public.location_stock (org_id, location_id, product_id, stock, updated_at)
    VALUES (p_org_id, v_location_id, p_product_id, p_quantity, now())
    ON CONFLICT (location_id, product_id) DO UPDATE
      SET stock = public.location_stock.stock + EXCLUDED.stock,
          updated_at = now();

    IF p_variant_id IS NOT NULL THEN
      INSERT INTO public.location_variant_stock (
        org_id, location_id, product_id, variant_id, stock, updated_at
      ) VALUES (
        p_org_id, v_location_id, p_product_id, p_variant_id, p_quantity, now()
      )
      ON CONFLICT (location_id, variant_id) DO UPDATE
        SET stock = public.location_variant_stock.stock + EXCLUDED.stock,
            updated_at = now(),
            product_id = EXCLUDED.product_id,
            org_id = EXCLUDED.org_id;
    END IF;
  END IF;

  -- ⚠️ El costo en pesos se CONGELA acá, en el momento del movimiento.
  --
  -- Antes sólo se guardaba `unit_cost_usd` y el ledger lo multiplicaba por la
  -- cotización **de hoy**: una devaluación reescribía el margen de las ventas
  -- del mes pasado. Es el estándar de cualquier ERP —Odoo, SAP B1, Dynamics—
  -- convertir una vez, en la transacción, y no volver a tocarlo.
  --
  -- Y para un producto cuyo costo es en pesos, `unit_cost_usd` es NULL: sin
  -- esta columna entraba al libro con costo cero.
  v_resuelto := public.costo_unitario_ars(p_org_id, p_product_id, p_variant_id);
  v_costo_ars := CASE
    -- Si vino un costo en dólares explícito en la llamada, manda ése: es el de
    -- la compra que se está registrando, no el del catálogo.
    WHEN COALESCE(p_unit_cost_usd, 0) > 0 AND (v_resuelto->>'moneda') = 'USD'
         AND COALESCE((v_resuelto->>'tipo_cambio')::numeric, 0) > 0
      THEN public.redondear_moneda(p_unit_cost_usd * (v_resuelto->>'tipo_cambio')::numeric, 'ARS')
    ELSE NULLIF(v_resuelto->>'costo_ars', '')::numeric
  END;

  INSERT INTO public.stock_movements (
    org_id, product_id, variant_id, product_name, variant_name,
    movement_type, quantity, stock_before, stock_after,
    reference_type, reference_id, unit_cost_usd, unit_cost_ars, unit_price_ars, notes, created_by,
    location_id
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_product_name, p_variant_name,
    p_movement_type, p_quantity, v_stock_before, v_stock_after,
    p_reference_type, p_reference_id, p_unit_cost_usd, v_costo_ars, p_unit_price_ars, p_notes, p_created_by,
    v_location_id
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$function$;
