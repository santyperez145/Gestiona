-- Productos: lo que tiene historia se archiva; lo que no, se borra.
--
-- Medido el 2026-10-14: borrar un producto conservaba sus ventas y compras
-- (por nombre, product_id SET NULL), pero se llevaba en cascada sus
-- transferencias entre sucursales, lotes con vencimiento y renglones de
-- conteo físico, y dejaba órdenes de compra apuntando a nada. Decisión
-- (líder de producto, 2026-10-15, con «seguí con todo lo que falta»): un
-- producto con operaciones se archiva (deja de verse para vender, conserva su
-- historia y se puede reactivar); uno sin operaciones se borra como antes,
-- así el borrado masivo de un catálogo importado sigue funcionando.
--
-- «Historia» = ventas, compras, renglones de órdenes de compra,
-- transferencias, lotes, conteos, devoluciones, órdenes de servicio y
-- documentos de Finance. El stock inicial de una importación no
-- cuenta: si contara, todo catálogo importado tendría historia.
--
-- `eliminar_productos(org, ids)` decide por producto y devuelve qué se borró y
-- qué se archivó; un guardia en `products` impide borrar por fuera un
-- producto con historia (salvo al borrar el negocio entero).
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.producto_tiene_historia(p_producto uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.sales WHERE product_id = p_producto)
      OR EXISTS (SELECT 1 FROM public.purchases WHERE product_id = p_producto)
      OR EXISTS (SELECT 1 FROM public.purchase_order_items WHERE product_id = p_producto)
      OR EXISTS (SELECT 1 FROM public.stock_transfers WHERE product_id = p_producto)
      OR EXISTS (SELECT 1 FROM public.product_batches WHERE product_id = p_producto)
      OR EXISTS (SELECT 1 FROM public.stock_count_items WHERE product_id = p_producto)
      -- Las mismas que mira unificar_productos (salvo los movimientos de stock).
      OR EXISTS (SELECT 1 FROM public.returns WHERE product_id = p_producto)
      OR EXISTS (SELECT 1 FROM public.service_order_items WHERE product_id = p_producto)
      OR EXISTS (SELECT 1 FROM public.return_requests WHERE product_id = p_producto)
      OR EXISTS (SELECT 1 FROM public.finance_document_line_matches WHERE confirmed_product_id = p_producto OR proposed_product_id = p_producto)
      OR EXISTS (SELECT 1 FROM public.finance_purchase_draft_lines WHERE product_id = p_producto);
$$;
REVOKE ALL ON FUNCTION public.producto_tiene_historia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.producto_tiene_historia(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_borrado_de_producto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('gestiona.organization_deleting', true), '') = 'on' THEN RETURN OLD; END IF;
  IF public.producto_tiene_historia(OLD.id) THEN
    RAISE EXCEPTION '«%» tiene ventas, compras u otras operaciones: se archiva en vez de borrarse', OLD.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_borrado_de_producto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_borrado_de_producto ON public.products;
CREATE TRIGGER trg_guard_borrado_de_producto
BEFORE DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.guard_borrado_de_producto();

CREATE OR REPLACE FUNCTION public.eliminar_productos(p_org uuid, p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_borrar uuid[];
  v_archivar uuid[];
  v_borrados uuid[];
  v_archivados uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de este negocio' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_ids), 0) > 500 THEN
    RAISE EXCEPTION 'Se eliminan hasta 500 productos por vez' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(id) FILTER (WHERE NOT public.producto_tiene_historia(id)),
         array_agg(id) FILTER (WHERE public.producto_tiene_historia(id))
    INTO v_borrar, v_archivar
    FROM public.products WHERE org_id = p_org AND id = ANY (p_ids);

  -- Los permisos son los de quien llama (RLS de products): sin permiso de
  -- borrar o editar, no se toca nada y el error sube.
  WITH b AS (DELETE FROM public.products WHERE org_id = p_org AND id = ANY (coalesce(v_borrar, '{}')) RETURNING id)
  SELECT array_agg(id) INTO v_borrados FROM b;
  WITH a AS (UPDATE public.products SET is_active = false
              WHERE org_id = p_org AND id = ANY (coalesce(v_archivar, '{}')) RETURNING id)
  SELECT array_agg(id) INTO v_archivados FROM a;

  RETURN jsonb_build_object('eliminados', coalesce(to_jsonb(v_borrados), '[]'::jsonb),
                            'archivados', coalesce(to_jsonb(v_archivados), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.eliminar_productos(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_productos(uuid, uuid[]) TO authenticated, service_role;

COMMIT;
