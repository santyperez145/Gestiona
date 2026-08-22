-- Importación de catálogo con staging, aprobación y reconciliación.
--
-- Había dos importadores en paralelo. Ambos escribían `products.stock` desde
-- el navegador y uno aplicaba producto por producto, por lo que una falla podía
-- dejar media migración hecha. Este contrato conserva el lote antes de tocar el
-- Core, resuelve create/update/conflict en el servidor y aplica todo dentro de
-- una transacción. El stock sólo se mueve mediante record_stock_movement.

CREATE TABLE IF NOT EXISTS public.product_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  filename text NOT NULL,
  source_format text NOT NULL CHECK (source_format IN ('xlsx', 'xls', 'csv')),
  payload_hash text NOT NULL,
  stock_mode text NOT NULL DEFAULT 'replace' CHECK (stock_mode IN ('replace', 'ignore')),
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  calculation_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'staged' CHECK (
    status IN ('staged', 'applying', 'completed', 'completed_with_errors', 'failed', 'cancelled')
  ),
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  create_rows integer NOT NULL DEFAULT 0,
  update_rows integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  stock_movements_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  cancelled_at timestamptz
);

-- Se reutiliza un retry mientras el lote sigue abierto. Una vez completado se
-- permite volver a importar el mismo archivo de forma intencional (por ejemplo,
-- para actualizar stock un mes después); la idempotencia vive en el batch_id.
DROP INDEX IF EXISTS public.product_import_batches_active_payload_uidx;
CREATE UNIQUE INDEX product_import_batches_active_payload_uidx
  ON public.product_import_batches(org_id, payload_hash)
  WHERE status IN ('staged', 'applying');

CREATE INDEX IF NOT EXISTS product_import_batches_org_created_idx
  ON public.product_import_batches(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.product_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.product_import_batches(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number > 0),
  match_key text NOT NULL,
  normalized jsonb NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'invalid')),
  target_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  validation_errors text[] NOT NULL DEFAULT '{}',
  validation_warnings text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'applied', 'skipped')),
  result_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  stock_before integer,
  stock_after integer,
  applied_at timestamptz,
  UNIQUE (batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS product_import_rows_batch_action_idx
  ON public.product_import_rows(batch_id, action, row_number);

ALTER TABLE public.product_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read product import batches" ON public.product_import_batches;
CREATE POLICY "members read product import batches"
  ON public.product_import_batches FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "members read product import rows" ON public.product_import_rows;
CREATE POLICY "members read product import rows"
  ON public.product_import_rows FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

-- No hay policies de escritura: sólo los RPC auditados crean o mutan lotes.
-- Revocar PUBLIC evita depender de los default privileges del proyecto.
REVOKE ALL ON public.product_import_batches, public.product_import_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_import_batches, public.product_import_rows TO authenticated;

COMMENT ON TABLE public.product_import_batches IS
  'Cabecera auditable de una importación de catálogo. Se prepara antes de tocar productos y conserva la reconciliación final.';
COMMENT ON TABLE public.product_import_rows IS
  'Filas normalizadas de un lote de importación. No contiene clientes ni credenciales; sólo datos de catálogo y validación.';

CREATE OR REPLACE FUNCTION public.product_import_number(p_value jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_text text;
BEGIN
  IF p_value IS NULL OR p_value = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value) = 'number' THEN RETURN (p_value #>> '{}')::numeric; END IF;
  IF jsonb_typeof(p_value) <> 'string' THEN RETURN NULL; END IF;
  v_text := btrim(p_value #>> '{}');
  IF v_text ~ '^-?[0-9]+([.][0-9]+)?$' THEN RETURN v_text::numeric; END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.product_import_number(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.stage_product_import(
  p_org_id uuid,
  p_filename text,
  p_source_format text,
  p_rows jsonb,
  p_stock_mode text DEFAULT 'replace',
  p_location_id uuid DEFAULT NULL,
  p_exchange_rate numeric DEFAULT NULL,
  p_customs_percent numeric DEFAULT 0,
  p_default_margin_percent numeric DEFAULT 0,
  p_auto_fill_sale_price boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF v_actor IS NULL OR NOT public.has_org_role(p_org_id, v_actor, ARRAY['owner','admin']) THEN
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
  IF COALESCE(p_exchange_rate, 0) <= 0
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
    v_price := public.product_import_number(v_row->'sale_price_ars');
    v_discount := public.product_import_number(v_row->'discount_price_ars');
    v_stock_numeric := public.product_import_number(v_row->'stock');
    v_content := public.product_import_number(v_row->'content_ml');
    v_low_stock := public.product_import_number(v_row->'low_stock_threshold');

    IF v_name = '' THEN v_errors := array_append(v_errors, 'Falta el nombre'); END IF;
    IF v_provided ? 'cost_usd' AND v_cost IS NULL THEN v_errors := array_append(v_errors, 'El costo no es un número válido'); END IF;
    IF v_provided ? 'sale_price_ars' AND v_price IS NULL THEN v_errors := array_append(v_errors, 'El precio no es un número válido'); END IF;
    IF v_provided ? 'discount_price_ars' AND v_discount IS NULL THEN v_errors := array_append(v_errors, 'El precio de oferta no es un número válido'); END IF;
    IF v_provided ? 'stock' AND v_stock_numeric IS NULL THEN v_errors := array_append(v_errors, 'El stock no es un número válido'); END IF;
    IF v_provided ? 'content_ml' AND v_content IS NULL THEN v_errors := array_append(v_errors, 'El contenido no es un número válido'); END IF;
    IF v_provided ? 'low_stock_threshold' AND v_low_stock IS NULL THEN v_errors := array_append(v_errors, 'El umbral no es un número válido'); END IF;
    IF v_cost IS NOT NULL AND v_cost < 0 THEN v_errors := array_append(v_errors, 'El costo no puede ser negativo'); END IF;
    IF v_price IS NOT NULL AND v_price < 0 THEN v_errors := array_append(v_errors, 'El precio no puede ser negativo'); END IF;
    IF v_stock_numeric IS NOT NULL AND (v_stock_numeric < 0 OR v_stock_numeric <> trunc(v_stock_numeric)) THEN
      v_errors := array_append(v_errors, 'El stock debe ser un entero mayor o igual a cero');
    END IF;
    IF v_content IS NOT NULL AND (v_content < 0 OR v_content <> trunc(v_content)) THEN
      v_errors := array_append(v_errors, 'El contenido debe ser un entero mayor o igual a cero');
    END IF;
    IF v_low_stock IS NOT NULL AND (v_low_stock < 0 OR v_low_stock <> trunc(v_low_stock)) THEN
      v_errors := array_append(v_errors, 'El umbral de stock debe ser un entero mayor o igual a cero');
    END IF;

    IF p_auto_fill_sale_price AND COALESCE(v_price, 0) <= 0 AND COALESCE(v_cost, 0) > 0 THEN
      IF COALESCE(p_exchange_rate, 0) <= 0 THEN
        v_errors := array_append(v_errors, 'Falta una cotización válida para sugerir el precio');
      ELSE
        v_price := round(v_cost * (1 + p_customs_percent / 100) * p_exchange_rate * (1 + p_default_margin_percent / 100));
        v_provided := v_provided || jsonb_build_array('sale_price_ars');
      END IF;
    END IF;
    IF COALESCE(v_price, 0) <= 0 THEN v_errors := array_append(v_errors, 'Falta un precio de venta mayor a cero'); END IF;
    IF COALESCE(v_cost, 0) = 0 THEN v_warnings := array_append(v_warnings, 'Sin costo: el margen quedará incompleto'); END IF;
    IF v_discount IS NOT NULL AND v_discount >= COALESCE(v_price, 0) THEN
      v_warnings := array_append(v_warnings, 'El precio de oferta no es menor al precio de venta');
    END IF;
    IF p_stock_mode = 'replace' AND v_provided ? 'stock' AND v_active_locations > 1 AND p_location_id IS NULL THEN
      v_errors := array_append(v_errors, 'Elegí una sucursal para importar stock');
    END IF;

    v_stock := CASE WHEN v_stock_numeric IS NULL THEN NULL ELSE v_stock_numeric::integer END;
    v_total_cost := round(COALESCE(v_cost, 0) * (1 + p_customs_percent / 100), 4);
    v_profit_ars := round(COALESCE(v_price, 0) - v_total_cost * COALESCE(p_exchange_rate, 0), 2);
    v_profit_usd := CASE WHEN COALESCE(p_exchange_rate, 0) > 0 THEN round(v_profit_ars / p_exchange_rate, 4) ELSE 0 END;

    SELECT count(*), min(p.id::text)::uuid INTO v_sku_count, v_sku_target
    FROM public.products p
    WHERE p.org_id = p_org_id AND v_sku IS NOT NULL AND lower(COALESCE(p.sku, '')) = lower(v_sku);
    SELECT count(*), min(p.id::text)::uuid INTO v_name_count, v_name_target
    FROM public.products p
    WHERE p.org_id = p_org_id AND lower(btrim(p.name)) = lower(v_name);

    IF v_sku_count > 1 THEN v_errors := array_append(v_errors, 'El SKU coincide con más de un producto existente'); END IF;
    IF v_name_count > 1 AND v_sku_target IS NULL THEN v_errors := array_append(v_errors, 'El nombre coincide con más de un producto existente'); END IF;
    IF v_sku_target IS NOT NULL AND v_name_target IS NOT NULL AND v_sku_target <> v_name_target THEN
      v_errors := array_append(v_errors, 'El SKU y el nombre apuntan a productos distintos');
    END IF;
    v_target := COALESCE(v_sku_target, v_name_target);

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
      'description', NULLIF(left(btrim(COALESCE(v_row->>'description', '')), 10000), ''),
      'cost_usd', COALESCE(v_cost, 0),
      'customs_fee', round(COALESCE(v_cost, 0) * p_customs_percent / 100, 4),
      'total_cost_usd', v_total_cost,
      'sale_price_ars', v_price,
      'discount_price_ars', v_discount,
      'profit_per_unit_ars', v_profit_ars,
      'profit_per_unit_usd', v_profit_usd,
      'stock', v_stock,
      'content_ml', CASE WHEN v_content IS NULL THEN NULL ELSE v_content::integer END,
      'low_stock_threshold', CASE WHEN v_low_stock IS NULL THEN NULL ELSE v_low_stock::integer END,
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
$$;

CREATE OR REPLACE FUNCTION public.apply_product_import(
  p_batch_id uuid,
  p_skip_invalid boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF v_actor IS NULL OR NOT public.has_org_role(v_batch.org_id, v_actor, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Sólo owner o admin puede aplicar una importación de catálogo'
      USING ERRCODE = '42501';
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
        INSERT INTO public.products (
          org_id, user_id, name, brand, category, gender, sku, barcode, description,
          cost_usd, customs_fee, total_cost_usd, sale_price_ars, discount_price_ars,
          profit_per_unit_ars, profit_per_unit_usd, stock, content_ml, low_stock_threshold,
          is_active
        ) VALUES (
          v_batch.org_id, v_actor, v_data->>'name', v_data->>'brand', v_data->>'category',
          v_data->>'gender', v_data->>'sku', v_data->>'barcode', v_data->>'description',
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

        UPDATE public.products p SET
          name = v_data->>'name',
          brand = CASE WHEN v_provided ? 'brand' THEN v_data->>'brand' ELSE p.brand END,
          category = CASE WHEN v_provided ? 'category' THEN v_data->>'category' ELSE p.category END,
          gender = CASE WHEN v_provided ? 'gender' THEN v_data->>'gender' ELSE p.gender END,
          sku = CASE WHEN v_provided ? 'sku' THEN v_data->>'sku' ELSE p.sku END,
          barcode = CASE WHEN v_provided ? 'barcode' THEN v_data->>'barcode' ELSE p.barcode END,
          description = CASE WHEN v_provided ? 'description' THEN v_data->>'description' ELSE p.description END,
          cost_usd = CASE WHEN v_provided ? 'cost_usd' THEN (v_data->>'cost_usd')::numeric ELSE p.cost_usd END,
          customs_fee = CASE WHEN v_provided ? 'cost_usd' THEN (v_data->>'customs_fee')::numeric ELSE p.customs_fee END,
          total_cost_usd = CASE WHEN v_provided ? 'cost_usd' THEN (v_data->>'total_cost_usd')::numeric ELSE p.total_cost_usd END,
          sale_price_ars = CASE WHEN v_provided ? 'sale_price_ars' THEN (v_data->>'sale_price_ars')::numeric ELSE p.sale_price_ars END,
          discount_price_ars = CASE WHEN v_provided ? 'discount_price_ars' THEN NULLIF(v_data->>'discount_price_ars', '')::numeric ELSE p.discount_price_ars END,
          profit_per_unit_ars = CASE
            WHEN (v_provided ? 'cost_usd') OR (v_provided ? 'sale_price_ars')
              THEN round(v_effective_price - v_effective_total_cost * v_exchange_rate, 2)
            ELSE p.profit_per_unit_ars
          END,
          profit_per_unit_usd = CASE
            WHEN (v_provided ? 'cost_usd') OR (v_provided ? 'sale_price_ars')
              THEN round((v_effective_price - v_effective_total_cost * v_exchange_rate) / v_exchange_rate, 4)
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
$$;

CREATE OR REPLACE FUNCTION public.cancel_product_import(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.product_import_batches%ROWTYPE;
BEGIN
  SELECT * INTO v_batch FROM public.product_import_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente'; END IF;
  IF NOT public.has_org_role(v_batch.org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = '42501';
  END IF;
  IF v_batch.status <> 'staged' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'estado_no_cancelable', 'status', v_batch.status);
  END IF;
  UPDATE public.product_import_batches
  SET status = 'cancelled', cancelled_at = now()
  WHERE id = v_batch.id;
  RETURN jsonb_build_object('ok', true, 'batch_id', v_batch.id, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.stage_product_import(uuid,text,text,jsonb,text,uuid,numeric,numeric,numeric,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_product_import(uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_product_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_product_import(uuid,text,text,jsonb,text,uuid,numeric,numeric,numeric,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_product_import(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_product_import(uuid) TO authenticated;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.product_import_batches', 'SELECT')
     OR has_table_privilege('anon', 'public.product_import_rows', 'SELECT') THEN
    RAISE EXCEPTION 'El staging de importación quedó visible para anon';
  END IF;
  IF has_table_privilege('authenticated', 'public.product_import_batches', 'INSERT')
     OR has_table_privilege('authenticated', 'public.product_import_rows', 'UPDATE') THEN
    RAISE EXCEPTION 'El cliente puede saltear los RPC del importador';
  END IF;
  IF has_function_privilege('authenticated', 'public.record_stock_movement(uuid,uuid,uuid,text,text,text,integer,text,uuid,numeric,numeric,text,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'El motor interno de stock volvió a quedar expuesto';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821000060', 'product_import_staging') ON CONFLICT DO NOTHING;
