-- Deshacer una importación de catálogo (2026-10-30). Migración desde
-- Tiendanube/Shopify con vuelta atrás.
--
-- El comercio que migra su catálogo necesita poder volver atrás si el archivo
-- vino mal (precios de otra lista, stock viejo, columnas corridas). Hasta hoy
-- el lote guardaba el stock anterior pero no cómo estaba cada producto antes
-- de actualizarlo, así que no había forma honesta de deshacerlo.
--
--   1. Al preparar una fila que actualiza un producto, se guarda una foto de
--      sus datos (`producto_antes`).
--   2. `deshacer_importacion_catalogo(lote)` — owner o admin, una sola vez y
--      dentro de los 30 días:
--      · Productos actualizados: vuelve cada dato importado a su valor
--        anterior, salvo los que alguien cambió después (no pisa trabajo
--        posterior; los cuenta).
--      · Productos creados: se desactivan (no se borran). Si ya vendieron o
--        movieron stock fuera de la importación, se conservan activos.
--      · Stock: se revierte con un movimiento de ajuste sólo si sigue igual
--        a lo que dejó la importación; si se vendió algo desde entonces, se
--        deja como está y se avisa.
--      · Redirects que creó el lote: se eliminan.

BEGIN;

ALTER TABLE public.product_import_rows
  ADD COLUMN IF NOT EXISTS producto_antes jsonb;

ALTER TABLE public.product_import_batches
  ADD COLUMN IF NOT EXISTS deshecho_at timestamptz,
  ADD COLUMN IF NOT EXISTS deshecho_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deshecho_resumen jsonb;

-- ── 1. La foto del producto antes de importarlo ─────────────────────────
CREATE OR REPLACE FUNCTION public.trg_import_foto_producto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.action = 'update' AND NEW.target_product_id IS NOT NULL
     AND COALESCE(NEW.status, 'staged') = 'staged'
     AND (TG_OP = 'INSERT' OR NEW.target_product_id IS DISTINCT FROM OLD.target_product_id OR NEW.producto_antes IS NULL) THEN
    SELECT jsonb_build_object(
      'name', p.name, 'brand', p.brand, 'category', p.category, 'gender', p.gender,
      'sku', p.sku, 'barcode', p.barcode, 'barcode_aliases', to_jsonb(p.barcode_aliases),
      'description', p.description, 'sale_price_ars', p.sale_price_ars,
      'discount_price_ars', p.discount_price_ars, 'cost_currency', p.cost_currency,
      'cost_ars', p.cost_ars, 'cost_usd', p.cost_usd, 'customs_fee', p.customs_fee,
      'total_cost_usd', p.total_cost_usd, 'profit_per_unit_ars', p.profit_per_unit_ars,
      'profit_per_unit_usd', p.profit_per_unit_usd, 'content_ml', p.content_ml,
      'low_stock_threshold', p.low_stock_threshold)
      INTO NEW.producto_antes
      FROM public.products p WHERE p.id = NEW.target_product_id;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.trg_import_foto_producto() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_import_foto_producto ON public.product_import_rows;
CREATE TRIGGER trg_import_foto_producto
  BEFORE INSERT OR UPDATE OF action, target_product_id ON public.product_import_rows
  FOR EACH ROW EXECUTE FUNCTION public.trg_import_foto_producto();

-- ¿El valor actual es el que escribió la importación? Números como números.
CREATE OR REPLACE FUNCTION public.valor_importado_igual(p_actual jsonb, p_importado jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  a text := NULLIF(btrim(COALESCE(p_actual #>> '{}', '')), '');
  b text := NULLIF(btrim(COALESCE(p_importado #>> '{}', '')), '');
BEGIN
  IF a IS NULL OR b IS NULL THEN
    RETURN a IS NULL AND b IS NULL;
  END IF;
  BEGIN
    RETURN a::numeric = b::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN a = b;
  END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.valor_importado_igual(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 2. Deshacer ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deshacer_importacion_catalogo(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_batch public.product_import_batches%ROWTYPE;
  v_row public.product_import_rows%ROWTYPE;
  v_actual jsonb;
  v_campo text;
  v_restaurar text[];
  v_costos text[] := ARRAY['cost_currency', 'cost_ars', 'cost_usd', 'customs_fee', 'total_cost_usd',
                           'profit_per_unit_ars', 'profit_per_unit_usd'];
  v_simples text[] := ARRAY['name', 'brand', 'category', 'gender', 'sku', 'barcode', 'description',
                            'sale_price_ars', 'discount_price_ars', 'content_ml', 'low_stock_threshold'];
  v_provided jsonb;
  v_quedo_cambio boolean;
  v_stock numeric;
  v_nombre text;
  v_restaurados integer := 0;
  v_cambiados_despues integer := 0;
  v_desactivados integer := 0;
  v_conservados integer := 0;
  v_stock_revertido integer := 0;
  v_stock_cambiado integer := 0;
  v_redirects integer := 0;
  v_resumen jsonb;
BEGIN
  SELECT * INTO v_batch FROM public.product_import_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importación inexistente' USING ERRCODE = '22023'; END IF;
  IF v_actor IS NULL OR NOT public.has_org_role(v_batch.org_id, v_actor, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo owner o admin puede deshacer una importación de catálogo' USING ERRCODE = '42501';
  END IF;
  IF v_batch.deshecho_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta importación ya se deshizo el %', to_char(v_batch.deshecho_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
      USING ERRCODE = '22023';
  END IF;
  IF v_batch.status NOT IN ('completed', 'completed_with_errors') THEN
    RAISE EXCEPTION 'Sólo se deshace una importación aplicada' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_batch.applied_at, v_batch.created_at) < now() - interval '30 days' THEN
    RAISE EXCEPTION 'Pasaron más de 30 días: corregí los productos desde el catálogo' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT * FROM public.product_import_rows
     WHERE batch_id = v_batch.id AND status = 'applied' AND result_product_id IS NOT NULL
     ORDER BY row_number DESC
  LOOP
    SELECT to_jsonb(p) INTO v_actual FROM public.products p
     WHERE p.id = v_row.result_product_id AND p.org_id = v_batch.org_id FOR UPDATE;
    CONTINUE WHEN v_actual IS NULL;
    v_nombre := v_actual->>'name';
    v_provided := COALESCE(v_row.normalized->'provided', '[]'::jsonb);

    -- Stock: sólo si sigue como lo dejó la importación.
    IF v_row.stock_after IS NOT NULL AND v_row.stock_before IS NOT NULL AND v_row.stock_after <> v_row.stock_before THEN
      IF v_batch.location_id IS NULL THEN
        v_stock := COALESCE((v_actual->>'stock')::numeric, 0);
      ELSE
        SELECT COALESCE(ls.stock, 0) INTO v_stock FROM public.location_stock ls
         WHERE ls.org_id = v_batch.org_id AND ls.location_id = v_batch.location_id
           AND ls.product_id = v_row.result_product_id;
        v_stock := COALESCE(v_stock, 0);
      END IF;
      IF v_stock = v_row.stock_after THEN
        PERFORM public.record_stock_movement(
          v_batch.org_id, v_row.result_product_id, NULL, v_nombre, NULL,
          'adjustment', (v_row.stock_before - v_row.stock_after)::numeric, 'product_import', v_batch.id,
          NULL, NULL, 'Importación deshecha: ' || v_batch.filename, v_actor, v_batch.location_id);
        v_stock_revertido := v_stock_revertido + 1;
      ELSE
        v_stock_cambiado := v_stock_cambiado + 1;
      END IF;
    END IF;

    IF v_row.action = 'create' THEN
      IF EXISTS (SELECT 1 FROM public.sale_items si WHERE si.product_id = v_row.result_product_id)
         OR EXISTS (SELECT 1 FROM public.stock_movements sm
                     WHERE sm.product_id = v_row.result_product_id
                       AND COALESCE(sm.reference_type, '') <> 'product_import') THEN
        v_conservados := v_conservados + 1;
      ELSE
        UPDATE public.products SET is_active = false WHERE id = v_row.result_product_id;
        v_desactivados := v_desactivados + 1;
      END IF;
    ELSIF v_row.producto_antes IS NOT NULL THEN
      v_restaurar := ARRAY[]::text[];
      v_quedo_cambio := false;
      FOREACH v_campo IN ARRAY v_simples LOOP
        CONTINUE WHEN NOT (v_provided ? v_campo) AND v_campo <> 'name';
        IF public.valor_importado_igual(v_actual->v_campo, v_row.normalized->v_campo) THEN
          v_restaurar := v_restaurar || v_campo;
        ELSE
          v_quedo_cambio := true;
        END IF;
      END LOOP;
      -- Costos y ganancia van juntos: se vuelven sólo si nadie los tocó después.
      IF (v_provided ? 'cost_usd' OR v_provided ? 'cost_ars' OR v_provided ? 'sale_price_ars') THEN
        IF (NOT (v_provided ? 'cost_usd') OR public.valor_importado_igual(v_actual->'cost_usd', v_row.normalized->'cost_usd'))
           AND (NOT (v_provided ? 'cost_ars') OR public.valor_importado_igual(v_actual->'cost_ars', v_row.normalized->'cost_ars'))
           AND (NOT (v_provided ? 'sale_price_ars') OR 'sale_price_ars' = ANY (v_restaurar)) THEN
          v_restaurar := v_restaurar || v_costos;
        ELSE
          v_quedo_cambio := true;
        END IF;
      END IF;
      IF v_provided ? 'barcode_aliases' THEN
        v_restaurar := v_restaurar || 'barcode_aliases'::text;
      END IF;

      IF cardinality(v_restaurar) > 0 THEN
        UPDATE public.products p SET
          name = CASE WHEN 'name' = ANY (v_restaurar) THEN COALESCE(v_row.producto_antes->>'name', p.name) ELSE p.name END,
          brand = CASE WHEN 'brand' = ANY (v_restaurar) THEN v_row.producto_antes->>'brand' ELSE p.brand END,
          category = CASE WHEN 'category' = ANY (v_restaurar) THEN v_row.producto_antes->>'category' ELSE p.category END,
          gender = CASE WHEN 'gender' = ANY (v_restaurar) THEN v_row.producto_antes->>'gender' ELSE p.gender END,
          sku = CASE WHEN 'sku' = ANY (v_restaurar) THEN v_row.producto_antes->>'sku' ELSE p.sku END,
          barcode = CASE WHEN 'barcode' = ANY (v_restaurar) THEN v_row.producto_antes->>'barcode' ELSE p.barcode END,
          barcode_aliases = CASE WHEN 'barcode_aliases' = ANY (v_restaurar)
            THEN ARRAY(SELECT jsonb_array_elements_text(COALESCE(NULLIF(v_row.producto_antes->'barcode_aliases', 'null'::jsonb), '[]'::jsonb)))
            ELSE p.barcode_aliases END,
          description = CASE WHEN 'description' = ANY (v_restaurar) THEN v_row.producto_antes->>'description' ELSE p.description END,
          sale_price_ars = CASE WHEN 'sale_price_ars' = ANY (v_restaurar) THEN (v_row.producto_antes->>'sale_price_ars')::numeric ELSE p.sale_price_ars END,
          discount_price_ars = CASE WHEN 'discount_price_ars' = ANY (v_restaurar) THEN (v_row.producto_antes->>'discount_price_ars')::numeric ELSE p.discount_price_ars END,
          content_ml = CASE WHEN 'content_ml' = ANY (v_restaurar) THEN (v_row.producto_antes->>'content_ml')::integer ELSE p.content_ml END,
          low_stock_threshold = CASE WHEN 'low_stock_threshold' = ANY (v_restaurar) THEN COALESCE((v_row.producto_antes->>'low_stock_threshold')::integer, p.low_stock_threshold) ELSE p.low_stock_threshold END,
          cost_currency = CASE WHEN 'cost_currency' = ANY (v_restaurar) THEN COALESCE(v_row.producto_antes->>'cost_currency', p.cost_currency) ELSE p.cost_currency END,
          cost_ars = CASE WHEN 'cost_ars' = ANY (v_restaurar) THEN (v_row.producto_antes->>'cost_ars')::numeric ELSE p.cost_ars END,
          cost_usd = CASE WHEN 'cost_usd' = ANY (v_restaurar) THEN COALESCE((v_row.producto_antes->>'cost_usd')::numeric, 0) ELSE p.cost_usd END,
          customs_fee = CASE WHEN 'customs_fee' = ANY (v_restaurar) THEN COALESCE((v_row.producto_antes->>'customs_fee')::numeric, 0) ELSE p.customs_fee END,
          total_cost_usd = CASE WHEN 'total_cost_usd' = ANY (v_restaurar) THEN COALESCE((v_row.producto_antes->>'total_cost_usd')::numeric, 0) ELSE p.total_cost_usd END,
          profit_per_unit_ars = CASE WHEN 'profit_per_unit_ars' = ANY (v_restaurar) THEN COALESCE((v_row.producto_antes->>'profit_per_unit_ars')::numeric, 0) ELSE p.profit_per_unit_ars END,
          profit_per_unit_usd = CASE WHEN 'profit_per_unit_usd' = ANY (v_restaurar) THEN COALESCE((v_row.producto_antes->>'profit_per_unit_usd')::numeric, 0) ELSE p.profit_per_unit_usd END
        WHERE p.id = v_row.result_product_id;
        v_restaurados := v_restaurados + 1;
      END IF;
      IF v_quedo_cambio THEN
        v_cambiados_despues := v_cambiados_despues + 1;
      END IF;
    ELSE
      -- Importado antes de esta migración: no hay foto para volver atrás.
      v_cambiados_despues := v_cambiados_despues + 1;
    END IF;
  END LOOP;

  DELETE FROM public.store_url_redirects WHERE import_batch_id = v_batch.id;
  GET DIAGNOSTICS v_redirects = ROW_COUNT;

  v_resumen := jsonb_build_object(
    'restaurados', v_restaurados, 'con_cambios_posteriores', v_cambiados_despues,
    'desactivados', v_desactivados, 'conservados_con_movimientos', v_conservados,
    'stock_revertido', v_stock_revertido, 'stock_cambiado_despues', v_stock_cambiado,
    'redirects_eliminados', v_redirects);
  UPDATE public.product_import_batches
     SET deshecho_at = now(), deshecho_por = v_actor, deshecho_resumen = v_resumen
   WHERE id = v_batch.id;

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (v_actor, v_batch.org_id, 'import_undo', 'product_import_batch', v_batch.id,
          v_resumen || jsonb_build_object('archivo', v_batch.filename));

  RETURN jsonb_build_object('ok', true) || v_resumen;
END;
$fn$;
REVOKE ALL ON FUNCTION public.deshacer_importacion_catalogo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deshacer_importacion_catalogo(uuid) TO authenticated;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated',
       'Deshace una importación de catálogo: owner/admin, una vez, 30 días; no pisa cambios posteriores.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'deshacer_importacion_catalogo'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
