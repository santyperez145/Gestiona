-- ═══════════════════════════════════════════════════════════════════════════
-- Importación de catálogo: una fila repetida en el archivo no traba todo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- E1/E3 de docs/TESIS.md. Medido 2026-10-10: Ferretería Famatina intentó 12
-- veces importar su lista (~11.900 artículos) entre el 08 y el 10/10 y
-- ninguna terminó; quedó con 5.500 de ~11.500 productos. La última sesión
-- (543b55b3…) se corta siempre en el lote 5.500: las filas 172 y 173 de ese
-- lote son el mismo artículo («LINGA DE SEGURIDAD CON COMBINACION»), una con
-- código y otra sin código (el código quedó en la columna de barras). La
-- validación no las ve repetidas (una se busca por código y la otra por
-- nombre), pero al aplicar, la segunda encuentra el producto que acaba de
-- crear la primera, `apply_product_import` lo toma como «el catálogo cambió»
-- y revierte el lote entero. Cada reintento falla igual, y
-- `apply_catalog_import_chunk` tapaba el motivo con un mensaje genérico.
--
-- Cambios (sobre las definiciones vigentes en la base):
--   · `apply_product_import`: si una fila «nueva» coincide con un producto que
--     creó ESTA importación (el mismo lote o la misma sesión), se omite y queda
--     avisada en `validation_warnings`; cuenta como omitida y el lote termina
--     «con avisos». Si coincide con un producto que ya existía antes, sigue
--     frenando, ahora diciendo cuál.
--   · `apply_catalog_import_chunk`: el error dice desde qué fila y el motivo.
--
-- Las sesiones trabadas se retoman con «Reanudar» desde el lote pendiente: no
-- se reescribe ningún dato del comercio. Idempotente (CREATE OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

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
  v_duplicates integer := 0;
  v_dup_id uuid;
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
      'reconciled', v_batch.created_count + v_batch.updated_count
        + (v_batch.skipped_count - v_batch.invalid_rows) = v_batch.valid_rows
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
        -- La misma fila repetida en el archivo (p. ej. una con código y otra
        -- sin código, mismo nombre): la primera creó el producto en esta
        -- importación. La repetida se omite y queda avisada, en vez de
        -- revertir el lote entero y trabar la importación para siempre.
        v_dup_id := NULL;
        SELECT p.id INTO v_dup_id FROM public.products p
        WHERE p.org_id = v_batch.org_id
          AND ((v_data->>'sku' IS NOT NULL AND lower(COALESCE(p.sku, '')) = lower(v_data->>'sku'))
          OR (v_data->>'sku' IS NULL AND lower(btrim(p.name)) = lower(v_data->>'name')))
          AND EXISTS (
            SELECT 1 FROM public.product_import_rows prev
            WHERE prev.result_product_id = p.id AND prev.status = 'applied'
              AND (prev.batch_id = v_batch.id OR prev.batch_id IN (
                SELECT c.batch_id FROM public.catalog_import_chunks c
                WHERE c.session_id::text = current_setting('app.catalog_import_session', true))))
        LIMIT 1;
        IF v_dup_id IS NOT NULL THEN
          UPDATE public.product_import_rows
          SET status = 'skipped', result_product_id = v_dup_id, applied_at = now(),
              validation_warnings = array_append(COALESCE(validation_warnings, ARRAY[]::text[]),
                'Repetida en el archivo: este producto ya se creó con otra fila de esta importación; se omitió')
          WHERE id = v_stage.id;
          v_duplicates := v_duplicates + 1;
          CONTINUE;
        END IF;
        IF EXISTS (SELECT 1 FROM public.products p WHERE p.org_id = v_batch.org_id
          AND ((v_data->>'sku' IS NOT NULL AND lower(COALESCE(p.sku, '')) = lower(v_data->>'sku'))
          OR (v_data->>'sku' IS NULL AND lower(btrim(p.name)) = lower(v_data->>'name')))) THEN
          RAISE EXCEPTION 'El catálogo cambió desde la validación: «%» ya existe; revisá nuevamente el archivo',
            COALESCE(v_data->>'sku', v_data->>'name');
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

    IF v_applied + v_duplicates <> v_batch.valid_rows THEN
      RAISE EXCEPTION 'Reconciliación fallida: % aplicadas y % repetidas de % válidas', v_applied, v_duplicates, v_batch.valid_rows;
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
  SET status = CASE WHEN invalid_rows > 0 OR v_duplicates > 0 THEN 'completed_with_errors' ELSE 'completed' END,
      created_count = v_created,
      updated_count = v_updated,
      stock_movements_count = v_movements,
      skipped_count = invalid_rows + v_duplicates,
      applied_at = now(),
      error_message = NULL
  WHERE id = v_batch.id;

  RETURN jsonb_build_object(
    'ok', true, 'reused', false, 'batch_id', v_batch.id,
    'status', CASE WHEN v_batch.invalid_rows > 0 OR v_duplicates > 0 THEN 'completed_with_errors' ELSE 'completed' END,
    'created', v_created, 'updated', v_updated, 'stock_movements', v_movements,
    'skipped', v_batch.invalid_rows + v_duplicates, 'duplicates', v_duplicates,
    'reconciled', v_applied + v_duplicates = v_batch.valid_rows
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_catalog_import_chunk(p_session_id uuid, p_position integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      -- El motivo real viaja al comercio: sin él, el mismo lote fallaba en
      -- cada reintento sin que nadie supiera por qué.
      RAISE EXCEPTION 'No se pudo aplicar el lote que empieza en la fila %; los lotes anteriores se conservan. Motivo: %',
        p_position + 1,
        COALESCE(v_result->>'error', CASE v_result->>'motivo'
          WHEN 'hay_filas_invalidas' THEN 'hay filas con errores sin omitir'
          WHEN 'sin_filas_validas' THEN 'el lote no tiene filas válidas'
          ELSE 'revisá permisos, cupo y datos antes de reintentar' END);
    END IF;
  END IF;
  UPDATE public.catalog_import_sessions SET applied = applied + v_chunk.row_count, updated_at = now(),
    status = CASE WHEN applied + v_chunk.row_count = total THEN 'completed' ELSE 'applying' END WHERE id = p_session_id;
  RETURN public.catalog_import_status(p_session_id);
END;
$function$;

COMMIT;
