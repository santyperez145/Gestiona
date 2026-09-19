-- Migracion P0: stock_disponible con compatibilidad hacia atras
CREATE OR REPLACE FUNCTION public.stock_disponible(
  p_product_id uuid,
  p_variant_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    CASE
      WHEN p_location_id IS NOT NULL AND p_variant_id IS NOT NULL THEN (
        SELECT lvs.stock FROM public.location_variant_stock lvs
        WHERE lvs.location_id = p_location_id AND lvs.product_id = p_product_id AND lvs.variant_id = p_variant_id
      )
      WHEN p_location_id IS NOT NULL THEN (
        SELECT ls.stock FROM public.location_stock ls
        WHERE ls.location_id = p_location_id AND ls.product_id = p_product_id
      )
      WHEN p_variant_id IS NOT NULL THEN (
        SELECT v.stock FROM public.product_variants v WHERE v.id = p_variant_id
      )
      ELSE (SELECT p.stock FROM public.products p WHERE p.id = p_product_id)
    END, 0
  ) - COALESCE((
    SELECT sum(r.quantity) FROM public.stock_reservations r
    WHERE r.status = 'active' AND (r.expires_at IS NULL OR r.expires_at > now())
      AND r.product_id = p_product_id AND r.variant_id IS NOT DISTINCT FROM p_variant_id
      AND (p_location_id IS NULL OR r.location_id IS NULL OR r.location_id = p_location_id)
  ), 0);
$$;
COMMENT ON FUNCTION public.stock_disponible IS 'Disponible global o por sucursal.';
REVOKE ALL ON FUNCTION public.stock_disponible(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stock_disponible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_disponible(uuid, uuid, uuid) TO anon, authenticated;
