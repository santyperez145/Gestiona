-- Large catalog imports reuse the existing stock and catalog authorities.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE INDEX IF NOT EXISTS products_import_sku_idx ON public.products(org_id, lower(COALESCE(sku, '')));
CREATE INDEX IF NOT EXISTS products_import_name_idx ON public.products(org_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS products_org_catalog_page_idx ON public.products(org_id, id);
CREATE INDEX IF NOT EXISTS product_import_rows_match_idx ON public.product_import_rows(batch_id, match_key);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode_aliases text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.catalog_import_sessions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  filename text NOT NULL,
  source_format text NOT NULL CHECK (source_format IN ('xls','xlsx','csv')),
  source_system text NOT NULL CHECK (source_system IN ('generic','nerqia','shopify','tiendanube','empretienda')),
  total integer NOT NULL CHECK (total BETWEEN 1 AND 50000),
  source_rows integer NOT NULL CHECK (source_rows BETWEEN 1 AND 50000),
  options jsonb NOT NULL,
  status text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','ready','applying','completed','cancelled')),
  prepared integer NOT NULL DEFAULT 0,
  applied integer NOT NULL DEFAULT 0,
  skip_invalid boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  CHECK (applied BETWEEN 0 AND prepared AND prepared <= total)
);
CREATE TABLE IF NOT EXISTS public.catalog_import_chunks (
  session_id uuid NOT NULL,
  org_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  batch_id uuid NOT NULL UNIQUE REFERENCES public.product_import_batches(id),
  payload_hash text NOT NULL,
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 250),
  PRIMARY KEY (session_id, position),
  FOREIGN KEY (session_id, org_id) REFERENCES public.catalog_import_sessions(id, org_id) ON DELETE CASCADE
);
ALTER TABLE public.product_import_rows ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.catalog_import_sessions(id);
ALTER TABLE public.product_import_rows ADD COLUMN IF NOT EXISTS session_position integer;
CREATE INDEX IF NOT EXISTS product_import_rows_session_key_idx ON public.product_import_rows(session_id, match_key);
CREATE INDEX IF NOT EXISTS product_import_rows_session_position_idx ON public.product_import_rows(session_id, session_position);
ALTER TABLE public.catalog_import_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_import_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_import_sessions_read ON public.catalog_import_sessions;
CREATE POLICY catalog_import_sessions_read ON public.catalog_import_sessions FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']) AND public.has_permission(org_id, 'products', 'view'));
DROP POLICY IF EXISTS catalog_import_chunks_read ON public.catalog_import_chunks;
CREATE POLICY catalog_import_chunks_read ON public.catalog_import_chunks FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']) AND public.has_permission(org_id, 'products', 'view'));
REVOKE ALL ON public.catalog_import_sessions, public.catalog_import_chunks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.catalog_import_sessions, public.catalog_import_chunks TO authenticated;
GRANT ALL ON public.catalog_import_sessions, public.catalog_import_chunks TO service_role;
DROP POLICY IF EXISTS "members read product import batches" ON public.product_import_batches;
CREATE POLICY "members read product import batches" ON public.product_import_batches FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']) AND public.has_permission(org_id, 'products', 'view'));
DROP POLICY IF EXISTS "members read product import rows" ON public.product_import_rows;
CREATE POLICY "members read product import rows" ON public.product_import_rows FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']) AND public.has_permission(org_id, 'products', 'view'));

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

CREATE OR REPLACE FUNCTION public.apply_product_import(p_batch_id uuid, p_skip_invalid boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_batch public.product_import_batches%ROWTYPE;
  v_stage public.product_import_rows%ROWTYPE;
  v_data jsonb;
  v_provided jsonb;
  v_product_id uuid;
  v_product_name text;
  v_current public.products%ROWTYPE;
  v_effective_total_cost numeric;
  v_effective_price numeric;
  v_exchange_rate numeric;
  v_effective_cost_ars numeric;
  v_before integer;
  v_after integer;
  v_delta integer;
  v_created integer := 0;
  v_updated integer := 0;
  v_movements integer := 0;
  v_applied integer := 0;
BEGIN
  SELECT * INTO v_batch FROM public.product_import_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente'; END IF;
  IF v_actor IS NULL OR NOT public.has_org_role(v_batch.org_id, v_actor, ARRAY['owner','admin'])
    OR NOT public.has_permission(v_batch.org_id, 'products', 'view')
    OR (v_batch.create_rows > 0 AND NOT public.has_permission(v_batch.org_id, 'products', 'create'))
    OR (v_batch.update_rows > 0 AND NOT public.has_permission(v_batch.org_id, 'products', 'edit')) THEN
    RAISE EXCEPTION 'Sólo owner o admin puede aplicar una importación de catálogo'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catalog_import_chunks c WHERE c.batch_id = p_batch_id
    AND current_setting('app.catalog_import_session', true) IS DISTINCT FROM c.session_id::text) THEN
    RAISE EXCEPTION 'Aplicá este lote desde su sesión de importación aprobada' USING ERRCODE = '42501';
  END IF;
  IF v_batch.status IN ('completed', 'completed_with_errors') THEN
    RETURN jsonb_build_object(
      'ok', true, 'reused', true, 'batch_id', v_batch.id, 'status', v_batch.status,
      'created', v_batch.created_count, 'updated', v_batch.updated_count,
      'stock_movements', v_batch.stock_movements_count, 'skipped', v_batch.skipped_count,
      'reconciled', v_batch.created_count + v_batch.updated_count = v_batch.valid_rows
    );
  END IF;
  IF v_batch.status <> 'staged' THEN RAISE EXCEPTION 'El lote no está listo para aplicar: %', v_batch.status; END IF;
  IF v_batch.invalid_rows > 0 AND NOT p_skip_invalid THEN
    RETURN jsonb_build_object(
      'ok', false, 'motivo', 'hay_filas_invalidas', 'batch_id', v_batch.id,
      'invalid', v_batch.invalid_rows, 'valid', v_batch.valid_rows
    );
  END IF;
  IF v_batch.valid_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sin_filas_validas', 'batch_id', v_batch.id);
  END IF;

  UPDATE public.product_import_batches SET status = 'applying', error_message = NULL WHERE id = v_batch.id;
  v_exchange_rate := (v_batch.calculation_params->>'exchange_rate')::numeric;

  BEGIN
    FOR v_stage IN
      SELECT * FROM public.product_import_rows
      WHERE batch_id = v_batch.id AND action IN ('create', 'update')
      ORDER BY row_number FOR UPDATE
    LOOP
      v_data := v_stage.normalized;
      v_provided := COALESCE(v_data->'provided', '[]'::jsonb);

      IF v_stage.action = 'create' THEN
        IF EXISTS (SELECT 1 FROM public.products p WHERE p.org_id = v_batch.org_id
          AND ((v_data->>'sku' IS NOT NULL AND lower(COALESCE(p.sku, '')) = lower(v_data->>'sku'))
          OR (v_data->>'sku' IS NULL AND lower(btrim(p.name)) = lower(v_data->>'name')))) THEN
          RAISE EXCEPTION 'El catálogo cambió desde la validación; revisá nuevamente el archivo';
        END IF;
        INSERT INTO public.products (
          org_id, user_id, name, brand, category, gender, sku, barcode, description,
          cost_currency, cost_ars, barcode_aliases,
          cost_usd, customs_fee, total_cost_usd, sale_price_ars, discount_price_ars,
          profit_per_unit_ars, profit_per_unit_usd, stock, content_ml, low_stock_threshold,
          is_active
        ) VALUES (
          v_batch.org_id, v_actor, v_data->>'name', v_data->>'brand', v_data->>'category',
          v_data->>'gender', v_data->>'sku', v_data->>'barcode', v_data->>'description',
          COALESCE(v_data->>'cost_currency', 'USD'), (v_data->>'cost_ars')::numeric,
          ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_data->'barcode_aliases', '[]'::jsonb))),
          COALESCE((v_data->>'cost_usd')::numeric, 0),
          COALESCE((v_data->>'customs_fee')::numeric, 0),
          COALESCE((v_data->>'total_cost_usd')::numeric, 0),
          (v_data->>'sale_price_ars')::numeric,
          NULLIF(v_data->>'discount_price_ars', '')::numeric,
          COALESCE((v_data->>'profit_per_unit_ars')::numeric, 0),
          COALESCE((v_data->>'profit_per_unit_usd')::numeric, 0),
          0,
          NULLIF(v_data->>'content_ml', '')::integer,
          COALESCE(NULLIF(v_data->>'low_stock_threshold', '')::integer, 5),
          true
        ) RETURNING id, name, stock INTO v_product_id, v_product_name, v_before;
        v_created := v_created + 1;
      ELSE
        SELECT p.* INTO v_current
        FROM public.products p
        WHERE p.id = v_stage.target_product_id AND p.org_id = v_batch.org_id
        FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'El producto de la fila % ya no existe', v_stage.row_number; END IF;

        v_product_id := v_current.id;
        v_product_name := v_current.name;
        v_effective_total_cost := CASE
          WHEN v_provided ? 'cost_usd' THEN (v_data->>'total_cost_usd')::numeric
          ELSE v_current.total_cost_usd
        END;
        v_effective_price := CASE
          WHEN v_provided ? 'sale_price_ars' THEN (v_data->>'sale_price_ars')::numeric
          ELSE v_current.sale_price_ars
        END;
        v_effective_cost_ars := CASE WHEN v_provided ? 'cost_ars' THEN (v_data->>'cost_ars')::numeric
          WHEN v_provided ? 'cost_usd' THEN v_effective_total_cost * COALESCE(v_exchange_rate, 0)
          WHEN v_current.cost_currency = 'ARS' THEN COALESCE(v_current.cost_ars, 0)
          ELSE v_effective_total_cost * COALESCE(v_exchange_rate, 0) END;

        UPDATE public.products p SET
          name = v_data->>'name',
          brand = CASE WHEN v_provided ? 'brand' THEN v_data->>'brand' ELSE p.brand END,
          category = CASE WHEN v_provided ? 'category' THEN v_data->>'category' ELSE p.category END,
          gender = CASE WHEN v_provided ? 'gender' THEN v_data->>'gender' ELSE p.gender END,
          sku = CASE WHEN v_provided ? 'sku' THEN v_data->>'sku' ELSE p.sku END,
          barcode = CASE WHEN v_provided ? 'barcode' THEN v_data->>'barcode' ELSE p.barcode END,
          barcode_aliases = CASE WHEN v_provided ? 'barcode_aliases' THEN ARRAY(SELECT jsonb_array_elements_text(v_data->'barcode_aliases')) ELSE p.barcode_aliases END,
          cost_currency = CASE WHEN v_provided ? 'cost_ars' THEN 'ARS' WHEN v_provided ? 'cost_usd' THEN 'USD' ELSE p.cost_currency END,
          cost_ars = CASE WHEN v_provided ? 'cost_ars' THEN (v_data->>'cost_ars')::numeric WHEN v_provided ? 'cost_usd' THEN NULL ELSE p.cost_ars END,
          description = CASE WHEN v_provided ? 'description' THEN v_data->>'description' ELSE p.description END,
          cost_usd = CASE WHEN v_provided ? 'cost_ars' THEN 0 WHEN v_provided ? 'cost_usd' THEN (v_data->>'cost_usd')::numeric ELSE p.cost_usd END,
          customs_fee = CASE WHEN v_provided ? 'cost_ars' THEN 0 WHEN v_provided ? 'cost_usd' THEN (v_data->>'customs_fee')::numeric ELSE p.customs_fee END,
          total_cost_usd = CASE WHEN v_provided ? 'cost_ars' THEN 0 WHEN v_provided ? 'cost_usd' THEN (v_data->>'total_cost_usd')::numeric ELSE p.total_cost_usd END,
          sale_price_ars = CASE WHEN v_provided ? 'sale_price_ars' THEN (v_data->>'sale_price_ars')::numeric ELSE p.sale_price_ars END,
          discount_price_ars = CASE WHEN v_provided ? 'discount_price_ars' THEN NULLIF(v_data->>'discount_price_ars', '')::numeric ELSE p.discount_price_ars END,
          profit_per_unit_ars = CASE
            WHEN (v_provided ? 'cost_usd') OR (v_provided ? 'cost_ars') OR (v_provided ? 'sale_price_ars')
              THEN round(v_effective_price - v_effective_cost_ars, 2)
            ELSE p.profit_per_unit_ars
          END,
          profit_per_unit_usd = CASE
            WHEN (v_provided ? 'cost_usd') OR (v_provided ? 'cost_ars') OR (v_provided ? 'sale_price_ars')
              THEN COALESCE(round((v_effective_price - v_effective_cost_ars) / NULLIF(v_exchange_rate, 0), 4), 0)
            ELSE p.profit_per_unit_usd
          END,
          content_ml = CASE WHEN v_provided ? 'content_ml' THEN NULLIF(v_data->>'content_ml', '')::integer ELSE p.content_ml END,
          low_stock_threshold = CASE WHEN v_provided ? 'low_stock_threshold' THEN NULLIF(v_data->>'low_stock_threshold', '')::integer ELSE p.low_stock_threshold END
        WHERE p.id = v_product_id;
        SELECT name INTO v_product_name FROM public.products WHERE id = v_product_id;
        v_updated := v_updated + 1;
      END IF;

      IF v_batch.stock_mode = 'replace' AND v_provided ? 'stock' THEN
        IF v_batch.location_id IS NULL THEN
          SELECT COALESCE(p.stock, 0) INTO v_before FROM public.products p WHERE p.id = v_product_id;
        ELSE
          SELECT COALESCE(ls.stock, 0) INTO v_before
          FROM public.location_stock ls
          WHERE ls.org_id = v_batch.org_id AND ls.location_id = v_batch.location_id
            AND ls.product_id = v_product_id;
          v_before := COALESCE(v_before, 0);
        END IF;
        v_after := COALESCE((v_data->>'stock')::integer, 0);
        v_delta := v_after - v_before;
        IF v_delta <> 0 THEN
          PERFORM public.record_stock_movement(
            v_batch.org_id, v_product_id, NULL, v_product_name, NULL,
            'adjustment', v_delta, 'product_import', v_batch.id,
            NULLIF(v_data->>'cost_usd', '')::numeric,
            NULLIF(v_data->>'sale_price_ars', '')::numeric,
            'Importación aprobada: ' || v_batch.filename, v_actor, v_batch.location_id
          );
          v_movements := v_movements + 1;
        END IF;
      ELSE
        IF v_batch.location_id IS NULL THEN
          SELECT COALESCE(p.stock, 0) INTO v_before FROM public.products p WHERE p.id = v_product_id;
        ELSE
          SELECT COALESCE(ls.stock, 0) INTO v_before
          FROM public.location_stock ls
          WHERE ls.org_id = v_batch.org_id AND ls.location_id = v_batch.location_id
            AND ls.product_id = v_product_id;
          v_before := COALESCE(v_before, 0);
        END IF;
        v_after := v_before;
      END IF;

      UPDATE public.product_import_rows
      SET status = 'applied', result_product_id = v_product_id,
          stock_before = v_before, stock_after = v_after, applied_at = now()
      WHERE id = v_stage.id;
      v_applied := v_applied + 1;
    END LOOP;

    UPDATE public.product_import_rows
    SET status = 'skipped'
    WHERE batch_id = v_batch.id AND action = 'invalid';

    IF v_applied <> v_batch.valid_rows THEN
      RAISE EXCEPTION 'Reconciliación fallida: % aplicadas de % válidas', v_applied, v_batch.valid_rows;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.product_import_batches
    SET status = 'failed', error_message = left(SQLERRM, 1000)
    WHERE id = v_batch.id;
    RETURN jsonb_build_object(
      'ok', false, 'motivo', 'aplicacion_fallida', 'batch_id', v_batch.id,
      'error', left(SQLERRM, 1000), 'reconciled', false
    );
  END;

  UPDATE public.product_import_batches
  SET status = CASE WHEN invalid_rows > 0 THEN 'completed_with_errors' ELSE 'completed' END,
      created_count = v_created,
      updated_count = v_updated,
      stock_movements_count = v_movements,
      skipped_count = invalid_rows,
      applied_at = now(),
      error_message = NULL
  WHERE id = v_batch.id;

  RETURN jsonb_build_object(
    'ok', true, 'reused', false, 'batch_id', v_batch.id,
    'status', CASE WHEN v_batch.invalid_rows > 0 THEN 'completed_with_errors' ELSE 'completed' END,
    'created', v_created, 'updated', v_updated, 'stock_movements', v_movements,
    'skipped', v_batch.invalid_rows, 'reconciled', v_applied = v_batch.valid_rows
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.catalog_import_status(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_session public.catalog_import_sessions%ROWTYPE; v_stats jsonb;
BEGIN
  SELECT * INTO v_session FROM public.catalog_import_sessions WHERE id = p_session_id;
  IF NOT FOUND OR NOT public.has_org_role(v_session.org_id, auth.uid(), ARRAY['owner','admin'])
    OR NOT public.has_permission(v_session.org_id, 'products', 'view') THEN
    RAISE EXCEPTION 'No tenés acceso a esta importación' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object('valid', COALESCE(sum(b.valid_rows),0), 'invalid', COALESCE(sum(b.invalid_rows),0),
    'creates', COALESCE(sum(b.create_rows),0), 'updates', COALESCE(sum(b.update_rows),0),
    'created', COALESCE(sum(b.created_count),0), 'updated', COALESCE(sum(b.updated_count),0),
    'stock_movements', COALESCE(sum(b.stock_movements_count),0), 'skipped', COALESCE(sum(b.skipped_count),0),
    'variants_created', COALESCE(sum(b.variant_created_count),0), 'variants_updated', COALESCE(sum(b.variant_updated_count),0),
    'redirects', COALESCE(sum(b.redirect_count),0), 'images', COALESCE(sum(b.image_rows),0), 'variants', COALESCE(sum(b.variant_rows),0)) INTO v_stats
  FROM public.catalog_import_chunks c JOIN public.product_import_batches b ON b.id = c.batch_id WHERE c.session_id = p_session_id;
  RETURN to_jsonb(v_session) || v_stats || jsonb_build_object('ok', true, 'reconciled', v_session.status = 'completed');
END;
$$;

CREATE OR REPLACE FUNCTION public.start_catalog_import(p_session_id uuid, p_org_id uuid, p_filename text,
  p_source_format text, p_source_system text, p_total integer, p_source_rows integer, p_options jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_existing public.catalog_import_sessions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner','admin'])
    OR NOT public.has_permission(p_org_id, 'products', 'view') THEN
    RAISE EXCEPTION 'No tenés permiso para preparar el catálogo' USING ERRCODE = '42501';
  END IF;
  IF p_session_id IS NULL OR p_total IS NULL OR p_total NOT BETWEEN 1 AND 50000
    OR p_source_rows IS NULL OR p_source_rows NOT BETWEEN 1 AND 50000
    OR jsonb_typeof(p_options) IS DISTINCT FROM 'object' OR octet_length(p_options::text) > 16384
    OR COALESCE(p_options->>'stock_mode','') NOT IN ('replace','ignore') THEN
    RAISE EXCEPTION 'Revisá el archivo y las opciones de importación' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.catalog_import_sessions(id, org_id, created_by, filename, source_format, source_system, total, source_rows, options)
  VALUES (p_session_id, p_org_id, auth.uid(), left(p_filename,255), p_source_format, p_source_system, p_total, p_source_rows, p_options)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_existing FROM public.catalog_import_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_existing.org_id <> p_org_id OR v_existing.options <> p_options OR v_existing.total <> p_total
    OR v_existing.source_rows <> p_source_rows OR v_existing.filename <> left(p_filename,255)
    OR v_existing.source_format <> p_source_format OR v_existing.source_system <> p_source_system THEN
    RAISE EXCEPTION 'La sesión corresponde a otro archivo u opciones' USING ERRCODE = '22023';
  END IF;
  RETURN public.catalog_import_status(p_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_catalog_import_chunk(p_session_id uuid, p_position integer, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_session public.catalog_import_sessions%ROWTYPE;
  v_chunk public.catalog_import_chunks%ROWTYPE;
  v_hash text; v_count integer; v_result jsonb; v_batch uuid;
BEGIN
  PERFORM public.catalog_import_status(p_session_id);
  SELECT * INTO v_session FROM public.catalog_import_sessions WHERE id = p_session_id FOR UPDATE;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lote inválido'; END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count NOT BETWEEN 1 AND 250 OR octet_length(p_rows::text) > 1048576 THEN
    RAISE EXCEPTION 'El lote supera 250 productos o 1 MB';
  END IF;
  v_hash := encode(extensions.digest(convert_to(p_rows::text,'UTF8'),'sha256'::text),'hex');
  SELECT * INTO v_chunk FROM public.catalog_import_chunks WHERE session_id = p_session_id AND position = p_position;
  IF FOUND THEN
    IF v_chunk.payload_hash <> v_hash THEN RAISE EXCEPTION 'El archivo cambió; usá el mismo archivo para reanudar'; END IF;
    RETURN public.catalog_import_status(p_session_id);
  END IF;
  IF v_session.status <> 'preparing' OR p_position IS DISTINCT FROM v_session.prepared OR p_position + v_count > v_session.total THEN
    RAISE EXCEPTION 'El lote no corresponde al siguiente paso de la importación';
  END IF;
  v_result := public.stage_catalog_migration(v_session.org_id, v_session.filename, v_session.source_format,
    v_session.source_system, p_rows, v_count, NULLIF(v_session.options->>'destination_store_id','')::uuid,
    v_session.options->>'stock_mode', NULLIF(v_session.options->>'location_id','')::uuid,
    COALESCE((v_session.options->>'exchange_rate')::numeric,0), 0,
    COALESCE((v_session.options->>'margin_percent')::numeric,0), COALESCE((v_session.options->>'auto_price')::boolean,false));
  IF NOT COALESCE((v_result->>'ok')::boolean,false) THEN RAISE EXCEPTION 'No se pudo validar el lote'; END IF;
  v_batch := (v_result->>'batch_id')::uuid;
  INSERT INTO public.catalog_import_chunks(session_id, org_id, position, batch_id, payload_hash, row_count)
    VALUES (p_session_id, v_session.org_id, p_position, v_batch, v_hash, v_count);
  UPDATE public.product_import_rows SET session_id = p_session_id, session_position = p_position + row_number - 1 WHERE batch_id = v_batch;
  UPDATE public.catalog_import_sessions SET prepared = prepared + v_count, updated_at = now(),
    status = CASE WHEN prepared + v_count = total THEN 'ready' ELSE 'preparing' END WHERE id = p_session_id;
  IF p_position + v_count = v_session.total THEN
    -- Validate the whole file before approval, including conflicts spanning chunks.
    WITH duplicates AS (
      SELECT match_key FROM public.product_import_rows WHERE session_id = p_session_id GROUP BY match_key HAVING count(*) > 1
    ), skus AS (
      SELECT lower(normalized->>'sku') sku FROM public.product_import_rows WHERE session_id = p_session_id AND normalized->>'sku' IS NOT NULL
      GROUP BY lower(normalized->>'sku') HAVING count(*) > 1
    ), targets AS (
      SELECT target_product_id FROM public.product_import_rows WHERE session_id = p_session_id AND target_product_id IS NOT NULL
      GROUP BY target_product_id HAVING count(*) > 1
    ) UPDATE public.product_import_rows r SET action = 'invalid',
      validation_errors = array_append(validation_errors, 'La clave o producto se repite en otro lote del archivo')
    WHERE r.session_id = p_session_id AND (r.match_key IN (SELECT match_key FROM duplicates)
      OR lower(r.normalized->>'sku') IN (SELECT sku FROM skus) OR r.target_product_id IN (SELECT target_product_id FROM targets));
    UPDATE public.product_import_batches b SET valid_rows = q.valid, invalid_rows = q.invalid, create_rows = q.creates, update_rows = q.updates
    FROM (SELECT batch_id, count(*) FILTER(WHERE action <> 'invalid')::int valid, count(*) FILTER(WHERE action = 'invalid')::int invalid,
      count(*) FILTER(WHERE action = 'create')::int creates, count(*) FILTER(WHERE action = 'update')::int updates
      FROM public.product_import_rows WHERE session_id = p_session_id GROUP BY batch_id) q WHERE b.id = q.batch_id;
  END IF;
  RETURN public.catalog_import_status(p_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_catalog_import(p_session_id uuid, p_skip_invalid boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_session public.catalog_import_sessions%ROWTYPE; v_status jsonb; v_max integer; v_current integer;
BEGIN
  v_status := public.catalog_import_status(p_session_id);
  SELECT * INTO v_session FROM public.catalog_import_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.status IN ('applying','completed') THEN RETURN public.catalog_import_status(p_session_id); END IF;
  IF v_session.status <> 'ready' OR v_session.prepared <> v_session.total THEN RAISE EXCEPTION 'Primero completá la validación de todo el archivo'; END IF;
  IF (v_status->>'invalid')::int > 0 AND NOT p_skip_invalid THEN RAISE EXCEPTION 'Confirmá si querés omitir las filas inválidas'; END IF;
  IF (v_status->>'valid')::int = 0 THEN RAISE EXCEPTION 'No hay filas válidas para importar'; END IF;
  IF ((v_status->>'creates')::int > 0 AND NOT public.has_permission(v_session.org_id,'products','create'))
    OR ((v_status->>'updates')::int > 0 AND NOT public.has_permission(v_session.org_id,'products','edit')) THEN
    RAISE EXCEPTION 'No tenés permiso para crear o editar estos productos' USING ERRCODE = '42501';
  END IF;
  SELECT max_products INTO v_max FROM public.organization_plan_limits(v_session.org_id);
  SELECT count(*) INTO v_current FROM public.products WHERE org_id = v_session.org_id;
  IF v_max IS NOT NULL AND v_current + (v_status->>'creates')::int > v_max THEN RAISE EXCEPTION 'El catálogo supera el límite de productos de tu plan'; END IF;
  UPDATE public.catalog_import_sessions SET status = 'applying', skip_invalid = p_skip_invalid, approved_at = now(), updated_at = now() WHERE id = p_session_id;
  RETURN public.catalog_import_status(p_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_catalog_import_chunk(p_session_id uuid, p_position integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_session public.catalog_import_sessions%ROWTYPE; v_chunk public.catalog_import_chunks%ROWTYPE; v_batch public.product_import_batches%ROWTYPE; v_result jsonb;
BEGIN
  PERFORM public.catalog_import_status(p_session_id);
  SELECT * INTO v_session FROM public.catalog_import_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.status NOT IN ('applying','completed') OR v_session.approved_at IS NULL THEN RAISE EXCEPTION 'La importación necesita aprobación'; END IF;
  SELECT * INTO v_chunk FROM public.catalog_import_chunks WHERE session_id = p_session_id AND position = p_position;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente'; END IF;
  IF p_position < v_session.applied THEN RETURN public.catalog_import_status(p_session_id); END IF;
  IF p_position IS DISTINCT FROM v_session.applied OR v_session.status = 'completed' THEN RAISE EXCEPTION 'Reanudá desde el próximo lote pendiente'; END IF;
  SELECT * INTO v_batch FROM public.product_import_batches WHERE id = v_chunk.batch_id FOR UPDATE;
  PERFORM set_config('app.catalog_import_session', p_session_id::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('catalog-import:' || v_session.org_id::text, 0));
  IF v_batch.valid_rows = 0 AND v_session.skip_invalid THEN
    UPDATE public.product_import_rows SET status = 'skipped' WHERE batch_id = v_batch.id;
    UPDATE public.product_import_batches SET status = 'completed_with_errors', skipped_count = invalid_rows,
      applied_at = now(), catalog_applied_at = now() WHERE id = v_batch.id;
  ELSE
    v_result := public.apply_catalog_migration(v_chunk.batch_id, v_session.skip_invalid);
    IF NOT COALESCE((v_result->>'ok')::boolean,false) OR NOT COALESCE((v_result->>'reconciled')::boolean,false) THEN
      RAISE EXCEPTION 'No se pudo aplicar este lote; los lotes anteriores se conservan. Revisá permisos, cupo y datos antes de reintentar.';
    END IF;
  END IF;
  UPDATE public.catalog_import_sessions SET applied = applied + v_chunk.row_count, updated_at = now(),
    status = CASE WHEN applied + v_chunk.row_count = total THEN 'completed' ELSE 'applying' END WHERE id = p_session_id;
  RETURN public.catalog_import_status(p_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_catalog_import(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_session public.catalog_import_sessions%ROWTYPE;
BEGIN
  PERFORM public.catalog_import_status(p_session_id);
  SELECT * INTO v_session FROM public.catalog_import_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.status = 'completed' THEN RAISE EXCEPTION 'La importación ya terminó'; END IF;
  UPDATE public.product_import_batches b SET status = 'cancelled' FROM public.catalog_import_chunks c
    WHERE c.session_id = p_session_id AND b.id = c.batch_id AND b.status = 'staged';
  UPDATE public.catalog_import_sessions SET status = 'cancelled', updated_at = now() WHERE id = p_session_id;
  RETURN public.catalog_import_status(p_session_id);
END;
$$;

REVOKE ALL ON FUNCTION public.catalog_import_status(uuid), public.start_catalog_import(uuid,uuid,text,text,text,integer,integer,jsonb),
  public.stage_catalog_import_chunk(uuid,integer,jsonb), public.approve_catalog_import(uuid,boolean),
  public.apply_catalog_import_chunk(uuid,integer), public.cancel_catalog_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_import_status(uuid), public.start_catalog_import(uuid,uuid,text,text,text,integer,integer,jsonb),
  public.stage_catalog_import_chunk(uuid,integer,jsonb), public.approve_catalog_import(uuid,boolean),
  public.apply_catalog_import_chunk(uuid,integer), public.cancel_catalog_import(uuid) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
  'Deriva tenant de la sesion y exige catalog_import_status: owner/admin y products.view. Escrituras solo por autoridades de catalogo y stock.',
  md5(pg_get_functiondef(p.oid)), DATE '2026-10-03'
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('stage_catalog_import_chunk','apply_catalog_import_chunk','cancel_catalog_import')
ON CONFLICT(function_name, identity_arguments) DO UPDATE SET audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale, definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261003000200','catalog_import_sessions') ON CONFLICT DO NOTHING;
COMMIT;

