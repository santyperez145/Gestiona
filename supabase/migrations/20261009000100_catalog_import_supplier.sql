-- Proveedor en la importación de catálogo.
--
-- `stage_product_import` es copia exacta de 20261003000200 (verificada contra
-- la base vinculada el 2026-10-09) con tres agregados: lee `supplier`, lo
-- guarda en `normalized` y avisa si se creará o si el nombre es ambiguo.
-- Al aplicar, un trigger sobre la fila asocia el producto al proveedor por
-- nombre o lo crea; una columna vacía nunca quita el proveedor existente.

CREATE INDEX IF NOT EXISTS suppliers_org_lower_name_idx
  ON public.suppliers (org_id, lower(btrim(name)));

CREATE OR REPLACE FUNCTION public.stage_product_import(p_org_id uuid, p_filename text, p_source_format text, p_rows jsonb, p_stock_mode text DEFAULT 'replace'::text, p_location_id uuid DEFAULT NULL::uuid, p_exchange_rate numeric DEFAULT NULL::numeric, p_customs_percent numeric DEFAULT 0, p_default_margin_percent numeric DEFAULT 0, p_auto_fill_sale_price boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_batch_id uuid;
  v_hash text;
  v_row jsonb;
  v_row_number integer;
  v_name text;
  v_sku text;
  v_match_key text;
  v_cost numeric;
  v_cost_ars numeric;
  v_native_ars boolean;
  v_aliases text[];
  v_price numeric;
  v_discount numeric;
  v_stock_numeric numeric;
  v_stock integer;
  v_content numeric;
  v_low_stock numeric;
  v_errors text[];
  v_warnings text[];
  v_action text;
  v_target uuid;
  v_sku_target uuid;
  v_name_target uuid;
  v_sku_count integer;
  v_name_count integer;
  v_provided jsonb;
  v_total_cost numeric;
  v_profit_ars numeric;
  v_profit_usd numeric;
  v_normalized jsonb;
  v_active_locations integer;
  v_supplier text;
  v_supplier_matches integer;
BEGIN
  IF v_actor IS NULL OR NOT public.has_org_role(p_org_id, v_actor, ARRAY['owner','admin'])
     OR NOT public.has_permission(p_org_id, 'products', 'view') THEN
    RAISE EXCEPTION 'Sólo owner o admin puede preparar una importación de catálogo'
      USING ERRCODE = '42501';
  END IF;
  IF p_source_format NOT IN ('xlsx', 'xls', 'csv') THEN
    RAISE EXCEPTION 'Formato de importación no soportado';
  END IF;
  IF p_stock_mode NOT IN ('replace', 'ignore') THEN
    RAISE EXCEPTION 'Modo de stock inválido';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'El archivo no contiene filas';
  END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'El máximo por lote es 5000 filas';
  END IF;
  IF COALESCE(p_exchange_rate, 0) < 0
     OR p_customs_percent < 0 OR p_customs_percent > 500
     OR p_default_margin_percent < -99 OR p_default_margin_percent > 5000 THEN
    RAISE EXCEPTION 'Parámetros de cálculo fuera de rango';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = p_location_id AND l.org_id = p_org_id AND l.active
  ) THEN
    RAISE EXCEPTION 'La sucursal no pertenece a la organización o está inactiva';
  END IF;

  SELECT count(*) INTO v_active_locations
  FROM public.locations l WHERE l.org_id = p_org_id AND l.active;

  v_hash := encode(extensions.digest(convert_to(
    p_org_id::text || '|' || p_stock_mode || '|' || COALESCE(p_location_id::text, '') || '|' ||
    COALESCE(p_exchange_rate::text, '') || '|' || p_customs_percent::text || '|' ||
    p_default_margin_percent::text || '|' || p_auto_fill_sale_price::text || '|' || p_rows::text,
    'UTF8'
  ), 'sha256'::text), 'hex');

  SELECT b.id INTO v_batch_id
  FROM public.product_import_batches b
  WHERE b.org_id = p_org_id AND b.payload_hash = v_hash
    AND b.status IN ('staged', 'applying')
    AND NOT EXISTS (SELECT 1 FROM public.catalog_import_chunks c WHERE c.batch_id = b.id)
  ORDER BY b.created_at DESC LIMIT 1;

  IF v_batch_id IS NOT NULL THEN
    RETURN (
      SELECT jsonb_build_object(
        'ok', true, 'reused', true, 'batch_id', b.id, 'status', b.status,
        'total', b.total_rows, 'valid', b.valid_rows, 'invalid', b.invalid_rows,
        'creates', b.create_rows, 'updates', b.update_rows
      ) FROM public.product_import_batches b WHERE b.id = v_batch_id
    );
  END IF;

  INSERT INTO public.product_import_batches (
    org_id, created_by, filename, source_format, payload_hash, stock_mode,
    location_id, calculation_params, total_rows
  ) VALUES (
    p_org_id, v_actor, left(COALESCE(NULLIF(btrim(p_filename), ''), 'archivo'), 255),
    p_source_format, v_hash, p_stock_mode, p_location_id,
    jsonb_build_object(
      'exchange_rate', p_exchange_rate,
      'customs_percent', p_customs_percent,
      'default_margin_percent', p_default_margin_percent,
      'auto_fill_sale_price', p_auto_fill_sale_price
    ),
    jsonb_array_length(p_rows)
  ) RETURNING id INTO v_batch_id;

  FOR v_row, v_row_number IN
    SELECT value, ordinality::integer
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY
  LOOP
    v_errors := ARRAY[]::text[];
    v_warnings := ARRAY[]::text[];
    v_name := left(btrim(COALESCE(v_row->>'name', '')), 200);
    v_sku := NULLIF(left(btrim(COALESCE(v_row->>'sku', '')), 120), '');
    v_match_key := CASE WHEN v_sku IS NOT NULL
      THEN 'sku:' || lower(v_sku)
      ELSE 'name:' || lower(v_name)
    END;
    v_provided := COALESCE(v_row->'provided', '[]'::jsonb);
    IF jsonb_typeof(v_provided) <> 'array' THEN v_provided := '[]'::jsonb; END IF;

    v_cost := public.product_import_number(v_row->'cost_usd');
    v_cost_ars := public.product_import_number(v_row->'cost_ars');
    v_native_ars := v_provided ? 'cost_ars';
    v_aliases := ARRAY[]::text[];
    IF v_provided ? 'barcode_aliases' THEN
      IF jsonb_typeof(v_row->'barcode_aliases') IS DISTINCT FROM 'array'
        OR jsonb_array_length(v_row->'barcode_aliases') > 10 THEN
        v_errors := array_append(v_errors, 'Códigos de barras adicionales inválidos');
      ELSE
        SELECT COALESCE(array_agg(DISTINCT value), ARRAY[]::text[]) INTO v_aliases
        FROM jsonb_array_elements_text(v_row->'barcode_aliases') WHERE btrim(value) <> '';
        IF EXISTS (SELECT 1 FROM unnest(v_aliases) a WHERE length(a) > 160) THEN
          v_errors := array_append(v_errors, 'Un código de barras supera 160 caracteres');
        END IF;
      END IF;
    END IF;
    IF length(COALESCE(v_row->>'source_record', '')) > 16384 THEN
      v_errors := array_append(v_errors, 'La fila de origen supera 16 KB');
    END IF;
    v_price := public.product_import_number(v_row->'sale_price_ars');
    v_discount := public.product_import_number(v_row->'discount_price_ars');
    v_stock_numeric := public.product_import_number(v_row->'stock');
    v_content := public.product_import_number(v_row->'content_ml');
    v_low_stock := public.product_import_number(v_row->'low_stock_threshold');

    IF v_name = '' THEN v_errors := array_append(v_errors, 'Falta el nombre'); END IF;
    IF v_provided ? 'cost_usd' AND v_cost IS NULL THEN v_errors := array_append(v_errors, 'El costo no es un número válido'); END IF;
    IF v_native_ars AND v_cost_ars IS NULL THEN v_errors := array_append(v_errors, 'El costo ARS no es un número válido'); END IF;
    IF v_native_ars AND v_provided ? 'cost_usd' THEN v_errors := array_append(v_errors, 'Elegí una sola moneda de costo'); END IF;
    IF v_provided ? 'cost_usd' AND COALESCE(p_exchange_rate, 0) <= 0 THEN v_errors := array_append(v_errors, 'Falta una cotización USD válida'); END IF;
    IF v_provided ? 'sale_price_ars' AND v_price IS NULL THEN v_errors := array_append(v_errors, 'El precio no es un número válido'); END IF;
    IF v_provided ? 'discount_price_ars' AND v_discount IS NULL THEN v_errors := array_append(v_errors, 'El precio de oferta no es un número válido'); END IF;
    IF p_stock_mode = 'replace' AND v_provided ? 'stock' AND v_stock_numeric IS NULL THEN v_errors := array_append(v_errors, 'El stock no es un número válido'); END IF;
    IF v_provided ? 'content_ml' AND v_content IS NULL THEN v_errors := array_append(v_errors, 'El contenido no es un número válido'); END IF;
    IF v_provided ? 'low_stock_threshold' AND v_low_stock IS NULL THEN v_errors := array_append(v_errors, 'El umbral no es un número válido'); END IF;
    IF v_cost IS NOT NULL AND v_cost < 0 THEN v_errors := array_append(v_errors, 'El costo no puede ser negativo'); END IF;
    IF v_cost_ars IS NOT NULL AND v_cost_ars < 0 THEN v_errors := array_append(v_errors, 'El costo ARS no puede ser negativo'); END IF;
    IF v_price IS NOT NULL AND v_price < 0 THEN v_errors := array_append(v_errors, 'El precio no puede ser negativo'); END IF;
    IF p_stock_mode = 'replace' AND v_stock_numeric IS NOT NULL AND (v_stock_numeric < 0 OR v_stock_numeric > 2147483647 OR v_stock_numeric <> trunc(v_stock_numeric)) THEN
      v_errors := array_append(v_errors, 'El stock debe ser un entero mayor o igual a cero');
    END IF;
    IF v_content IS NOT NULL AND (v_content < 0 OR v_content > 2147483647 OR v_content <> trunc(v_content)) THEN
      v_errors := array_append(v_errors, 'El contenido debe ser un entero mayor o igual a cero');
    END IF;
    IF v_low_stock IS NOT NULL AND (v_low_stock < 0 OR v_low_stock > 2147483647 OR v_low_stock <> trunc(v_low_stock)) THEN
      v_errors := array_append(v_errors, 'El umbral de stock debe ser un entero mayor o igual a cero');
    END IF;

    IF p_auto_fill_sale_price AND COALESCE(v_price, 0) <= 0 AND COALESCE(CASE WHEN v_native_ars THEN v_cost_ars ELSE v_cost END, 0) > 0 THEN
      IF NOT v_native_ars AND COALESCE(p_exchange_rate, 0) <= 0 THEN
        v_errors := array_append(v_errors, 'Falta una cotización válida para sugerir el precio');
      ELSE
        v_price := round((CASE WHEN v_native_ars THEN v_cost_ars ELSE v_cost * (1 + p_customs_percent / 100) * p_exchange_rate END) * (1 + p_default_margin_percent / 100));
        v_provided := v_provided || jsonb_build_array('sale_price_ars');
      END IF;
    END IF;
    IF COALESCE(v_price, 0) <= 0 THEN v_errors := array_append(v_errors, 'Falta un precio de venta mayor a cero'); END IF;
    IF COALESCE(CASE WHEN v_native_ars THEN v_cost_ars ELSE v_cost END, 0) = 0 THEN v_warnings := array_append(v_warnings, 'Sin costo: el margen quedará incompleto'); END IF;
    IF v_discount IS NOT NULL AND v_discount >= COALESCE(v_price, 0) THEN
      v_warnings := array_append(v_warnings, 'El precio de oferta no es menor al precio de venta');
    END IF;
    IF p_stock_mode = 'replace' AND v_provided ? 'stock' AND v_active_locations > 1 AND p_location_id IS NULL THEN
      v_errors := array_append(v_errors, 'Elegí una sucursal para importar stock');
    END IF;

    -- Proveedor: se asocia por nombre (sin distinguir mayúsculas) o se crea al
    -- aplicar; el trigger `product_import_assign_supplier` es la autoridad.
    v_supplier := NULLIF(left(btrim(COALESCE(v_row->>'supplier', '')), 160), '');
    IF v_provided ? 'supplier' AND v_supplier IS NOT NULL THEN
      SELECT count(*) INTO v_supplier_matches FROM public.suppliers s
      WHERE s.org_id = p_org_id AND lower(btrim(s.name)) = lower(v_supplier);
      IF v_supplier_matches = 0 THEN
        v_warnings := array_append(v_warnings, 'Proveedor nuevo: se creará al aplicar');
      ELSIF v_supplier_matches > 1 THEN
        v_warnings := array_append(v_warnings, 'Hay varios proveedores con ese nombre; se usará el activo más antiguo');
      END IF;
    END IF;

    v_stock := CASE WHEN p_stock_mode = 'replace' AND v_stock_numeric BETWEEN 0 AND 2147483647 AND v_stock_numeric = trunc(v_stock_numeric) THEN v_stock_numeric::integer ELSE NULL END;
    IF p_stock_mode = 'ignore' AND v_provided ? 'stock' THEN
      v_warnings := array_append(v_warnings, 'Stock de origen conservado en auditoría; no modifica inventario');
    END IF;
    v_total_cost := round(COALESCE(v_cost, 0) * (1 + p_customs_percent / 100), 4);
    v_profit_ars := round(COALESCE(v_price, 0) - CASE WHEN v_native_ars THEN COALESCE(v_cost_ars, 0) ELSE v_total_cost * COALESCE(p_exchange_rate, 0) END, 2);
    v_profit_usd := CASE WHEN COALESCE(p_exchange_rate, 0) > 0 THEN round(v_profit_ars / p_exchange_rate, 4) ELSE 0 END;

    SELECT count(*), min(p.id::text)::uuid INTO v_sku_count, v_sku_target
    FROM public.products p
    WHERE p.org_id = p_org_id AND v_sku IS NOT NULL AND lower(COALESCE(p.sku, '')) = lower(v_sku);
    v_name_count := 0; v_name_target := NULL;
    IF v_sku IS NULL THEN
      SELECT count(*), min(p.id::text)::uuid INTO v_name_count, v_name_target
      FROM public.products p WHERE p.org_id = p_org_id AND lower(btrim(p.name)) = lower(v_name);
    END IF;

    IF v_sku_count > 1 THEN v_errors := array_append(v_errors, 'El SKU coincide con más de un producto existente'); END IF;
    IF v_name_count > 1 AND v_sku IS NULL THEN v_errors := array_append(v_errors, 'El nombre coincide con más de un producto existente; agregá el código'); END IF;
    -- A code is authoritative: distinct codes may legitimately share a description.
    v_target := CASE WHEN v_sku IS NOT NULL THEN v_sku_target ELSE v_name_target END;

    IF EXISTS (
      SELECT 1 FROM public.product_import_rows r
      WHERE r.batch_id = v_batch_id AND r.match_key = v_match_key
    ) THEN
      v_errors := array_append(v_errors, 'La clave está repetida dentro del archivo');
      UPDATE public.product_import_rows
      SET action = 'invalid',
          validation_errors = array_append(validation_errors, 'La clave está repetida dentro del archivo')
      WHERE batch_id = v_batch_id AND match_key = v_match_key
        AND NOT ('La clave está repetida dentro del archivo' = ANY(validation_errors));
    END IF;

    v_action := CASE
      WHEN cardinality(v_errors) > 0 THEN 'invalid'
      WHEN v_target IS NOT NULL THEN 'update'
      ELSE 'create'
    END;

    v_normalized := jsonb_build_object(
      'name', v_name,
      'brand', COALESCE(NULLIF(left(btrim(COALESCE(v_row->>'brand', '')), 160), ''), 'Sin marca'),
      'category', COALESCE(NULLIF(left(btrim(COALESCE(v_row->>'category', '')), 120), ''), 'otro'),
      'gender', COALESCE(NULLIF(left(btrim(COALESCE(v_row->>'gender', '')), 40), ''), 'unisex'),
      'sku', v_sku,
      'barcode', NULLIF(left(btrim(COALESCE(v_row->>'barcode', '')), 160), ''),
      'barcode_aliases', to_jsonb(v_aliases),
      'cost_currency', CASE WHEN v_native_ars THEN 'ARS' ELSE 'USD' END,
      'cost_ars', v_cost_ars,
      'source_record', v_row->>'source_record',
      'source_row', v_row->'source_row',
      'source_stock', v_row->'stock',
      'description', NULLIF(left(btrim(COALESCE(v_row->>'description', '')), 10000), ''),
      'supplier', v_supplier,
      'cost_usd', COALESCE(v_cost, 0),
      'customs_fee', round(COALESCE(v_cost, 0) * p_customs_percent / 100, 4),
      'total_cost_usd', v_total_cost,
      'sale_price_ars', v_price,
      'discount_price_ars', v_discount,
      'profit_per_unit_ars', v_profit_ars,
      'profit_per_unit_usd', v_profit_usd,
      'stock', v_stock,
      'content_ml', CASE WHEN v_content BETWEEN 0 AND 2147483647 AND v_content = trunc(v_content) THEN v_content::integer ELSE NULL END,
      'low_stock_threshold', CASE WHEN v_low_stock BETWEEN 0 AND 2147483647 AND v_low_stock = trunc(v_low_stock) THEN v_low_stock::integer ELSE NULL END,
      'provided', v_provided
    );

    INSERT INTO public.product_import_rows (
      batch_id, org_id, row_number, match_key, normalized, action,
      target_product_id, validation_errors, validation_warnings
    ) VALUES (
      v_batch_id, p_org_id, v_row_number, v_match_key, v_normalized, v_action,
      v_target, v_errors, v_warnings
    );
  END LOOP;

  UPDATE public.product_import_batches b
  SET valid_rows = q.valid_rows,
      invalid_rows = q.invalid_rows,
      create_rows = q.create_rows,
      update_rows = q.update_rows
  FROM (
    SELECT
      count(*) FILTER (WHERE action IN ('create', 'update'))::integer AS valid_rows,
      count(*) FILTER (WHERE action = 'invalid')::integer AS invalid_rows,
      count(*) FILTER (WHERE action = 'create')::integer AS create_rows,
      count(*) FILTER (WHERE action = 'update')::integer AS update_rows
    FROM public.product_import_rows WHERE batch_id = v_batch_id
  ) q
  WHERE b.id = v_batch_id;

  RETURN (
    SELECT jsonb_build_object(
      'ok', true, 'reused', false, 'batch_id', b.id, 'status', b.status,
      'total', b.total_rows, 'valid', b.valid_rows, 'invalid', b.invalid_rows,
      'creates', b.create_rows, 'updates', b.update_rows
    ) FROM public.product_import_batches b WHERE b.id = v_batch_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.product_import_assign_supplier()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := NULLIF(left(btrim(COALESCE(NEW.normalized->>'supplier', '')), 160), '');
  v_supplier uuid;
BEGIN
  IF v_name IS NULL OR NEW.result_product_id IS NULL THEN RETURN NEW; END IF;
  -- Dos filas del mismo lote con un proveedor nuevo no crean duplicados.
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier:' || NEW.org_id::text || ':' || lower(v_name), 0));
  SELECT s.id INTO v_supplier
  FROM public.suppliers s
  WHERE s.org_id = NEW.org_id AND lower(btrim(s.name)) = lower(v_name)
  ORDER BY s.active DESC, s.created_at, s.id
  LIMIT 1;
  IF v_supplier IS NULL THEN
    INSERT INTO public.suppliers (org_id, name) VALUES (NEW.org_id, v_name)
    RETURNING id INTO v_supplier;
  END IF;
  UPDATE public.products p SET supplier_id = v_supplier
  WHERE p.id = NEW.result_product_id AND p.org_id = NEW.org_id
    AND p.supplier_id IS DISTINCT FROM v_supplier;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.product_import_assign_supplier() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS product_import_assign_supplier ON public.product_import_rows;
CREATE TRIGGER product_import_assign_supplier
  AFTER UPDATE OF status ON public.product_import_rows
  FOR EACH ROW
  WHEN (NEW.status = 'applied' AND OLD.status IS DISTINCT FROM 'applied'
    AND NEW.normalized->'provided' ? 'supplier')
  EXECUTE FUNCTION public.product_import_assign_supplier();
