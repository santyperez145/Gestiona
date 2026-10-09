-- Unificar productos duplicados en una transacción.
--
-- Borrar un duplicado a mano rompe datos: 58 claves foráneas apuntan a
-- products; las ventas, compras y el Kardex quedan con product_id NULL y las
-- variantes, stock por sucursal o publicaciones se borran en cascada.
-- Esta función, por cada duplicado:
--   1. traslada su stock al producto que se conserva con movimientos de Kardex
--      (por sucursal), sin escribir products.stock directo;
--   2. agrega su código de barras, alternativos y SKU como alternativos del
--      que se conserva, para que el escáner lo siga encontrando;
--   3. lo elimina si no tiene historia, o lo archiva (inactivo, sin códigos)
--      si tiene ventas, compras, devoluciones, Kardex o documentos.
-- Un duplicado con variantes se rechaza: se unifica a mano.

CREATE OR REPLACE FUNCTION public.unificar_productos(p_org uuid, p_keep uuid, p_duplicates uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_keep public.products%ROWTYPE;
  v_dup public.products%ROWTYPE;
  v_dup_id uuid;
  v_loc record;
  v_remainder integer;
  v_history boolean;
  v_moved integer := 0;
  v_deleted integer := 0;
  v_archived integer := 0;
  v_codes text[];
BEGIN
  IF v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'products', 'delete', 'unificar productos duplicados');
  IF p_duplicates IS NULL OR cardinality(p_duplicates) = 0 OR cardinality(p_duplicates) > 50 THEN
    RAISE EXCEPTION 'Elegí entre 1 y 50 duplicados por vez';
  END IF;
  IF p_keep = ANY(p_duplicates) OR (SELECT count(DISTINCT d) FROM unnest(p_duplicates) d) <> cardinality(p_duplicates) THEN
    RAISE EXCEPTION 'El producto que se conserva no puede ser también un duplicado';
  END IF;

  SELECT * INTO v_keep FROM public.products WHERE id = p_keep AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El producto a conservar no existe en este comercio'; END IF;
  IF (SELECT count(*) FROM public.products WHERE org_id = p_org AND id = ANY(p_duplicates)) <> cardinality(p_duplicates) THEN
    RAISE EXCEPTION 'Algún duplicado no existe en este comercio';
  END IF;
  PERFORM 1 FROM public.products WHERE org_id = p_org AND id = ANY(p_duplicates) ORDER BY id FOR UPDATE;

  FOREACH v_dup_id IN ARRAY p_duplicates LOOP
    SELECT * INTO v_dup FROM public.products WHERE id = v_dup_id AND org_id = p_org;
    IF EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = v_dup.id) THEN
      RAISE EXCEPTION '«%» tiene variantes: unificalo a mano para no perder talles o colores', v_dup.name;
    END IF;

    -- Historia se mide antes del traslado (que agrega Kardex propio).
    v_history := EXISTS (SELECT 1 FROM public.sales WHERE product_id = v_dup.id)
      OR EXISTS (SELECT 1 FROM public.purchases WHERE product_id = v_dup.id)
      OR EXISTS (SELECT 1 FROM public.returns WHERE product_id = v_dup.id)
      OR EXISTS (SELECT 1 FROM public.stock_movements WHERE product_id = v_dup.id)
      OR EXISTS (SELECT 1 FROM public.purchase_order_items WHERE product_id = v_dup.id)
      OR EXISTS (SELECT 1 FROM public.service_order_items WHERE product_id = v_dup.id)
      OR EXISTS (SELECT 1 FROM public.return_requests WHERE product_id = v_dup.id)
      OR EXISTS (SELECT 1 FROM public.finance_document_line_matches WHERE confirmed_product_id = v_dup.id OR proposed_product_id = v_dup.id)
      OR EXISTS (SELECT 1 FROM public.finance_purchase_draft_lines WHERE product_id = v_dup.id);

    IF v_dup.maneja_stock IS NOT FALSE AND (COALESCE(v_dup.stock, 0) <> 0
        OR EXISTS (SELECT 1 FROM public.location_stock WHERE product_id = v_dup.id AND stock <> 0)) THEN
      IF v_keep.maneja_stock IS FALSE THEN
        RAISE EXCEPTION '«%» tiene stock y «%» no maneja stock: activá el stock del que se conserva primero', v_dup.name, v_keep.name;
      END IF;
      FOR v_loc IN SELECT location_id, stock FROM public.location_stock
        WHERE product_id = v_dup.id AND org_id = p_org AND stock <> 0 ORDER BY location_id
      LOOP
        PERFORM public.record_stock_movement(p_org, v_dup.id, NULL, v_dup.name, NULL, 'adjustment', -v_loc.stock,
          'product_merge', v_keep.id, NULL, NULL, 'Unificado en «' || v_keep.name || '»', v_user, v_loc.location_id);
        PERFORM public.record_stock_movement(p_org, v_keep.id, NULL, v_keep.name, NULL, 'adjustment', v_loc.stock,
          'product_merge', v_dup.id, NULL, NULL, 'Unificación de «' || v_dup.name || '»', v_user, v_loc.location_id);
        v_moved := v_moved + v_loc.stock;
      END LOOP;
      SELECT COALESCE(stock, 0) INTO v_remainder FROM public.products WHERE id = v_dup.id;
      IF v_remainder <> 0 THEN
        PERFORM public.record_stock_movement(p_org, v_dup.id, NULL, v_dup.name, NULL, 'adjustment', -v_remainder,
          'product_merge', v_keep.id, NULL, NULL, 'Unificado en «' || v_keep.name || '»', v_user, NULL);
        PERFORM public.record_stock_movement(p_org, v_keep.id, NULL, v_keep.name, NULL, 'adjustment', v_remainder,
          'product_merge', v_dup.id, NULL, NULL, 'Unificación de «' || v_dup.name || '»', v_user, NULL);
        v_moved := v_moved + v_remainder;
      END IF;
    END IF;

    -- Los códigos del duplicado siguen encontrando el producto conservado.
    v_codes := ARRAY(
      SELECT DISTINCT c FROM unnest(
        COALESCE(v_keep.barcode_aliases, ARRAY[]::text[])
        || ARRAY[v_dup.barcode, v_dup.sku]
        || COALESCE(v_dup.barcode_aliases, ARRAY[]::text[])
      ) c
      WHERE NULLIF(btrim(c), '') IS NOT NULL
        AND btrim(c) IS DISTINCT FROM btrim(COALESCE(v_keep.barcode, ''))
        AND lower(btrim(c)) IS DISTINCT FROM lower(btrim(COALESCE(v_keep.sku, '')))
      ORDER BY c
    );
    UPDATE public.products SET barcode_aliases = v_codes WHERE id = v_keep.id;
    v_keep.barcode_aliases := v_codes;

    IF v_history THEN
      UPDATE public.products
      SET is_active = false, sku = NULL, barcode = NULL, barcode_aliases = ARRAY[]::text[]
      WHERE id = v_dup.id;
      v_archived := v_archived + 1;
    ELSE
      DELETE FROM public.products WHERE id = v_dup.id;
      v_deleted := v_deleted + 1;
    END IF;
  END LOOP;

  PERFORM public.emitir_evento(p_org, 'producto', v_keep.id, 'producto.unificado',
    jsonb_build_object('producto_id', v_keep.id, 'duplicados', to_jsonb(p_duplicates),
      'eliminados', v_deleted, 'archivados', v_archived, 'stock_trasladado', v_moved));

  RETURN jsonb_build_object('ok', true, 'eliminados', v_deleted, 'archivados', v_archived, 'stock_trasladado', v_moved);
END;
$fn$;

REVOKE ALL ON FUNCTION public.unificar_productos(uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unificar_productos(uuid, uuid, uuid[]) TO authenticated, service_role;
