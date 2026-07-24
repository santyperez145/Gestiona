-- ============================================================================
-- RPC para movimientos de stock manuales (rotura, regalo, reserva, ajuste)
-- ============================================================================
-- adjust_stock queda intacto (flujo "fijar stock total"). Este RPC es
-- delta-based ("quitar 2 unidades, motivo: rotura") y sigue el patrón seguro
-- de adjust_stock: valida rol owner/admin ANTES de delegar en
-- record_stock_movement (que no tiene chequeo de auth propio).

CREATE OR REPLACE FUNCTION public.record_manual_stock_movement(
  p_org_id        UUID,
  p_product_id    UUID,
  p_variant_id    UUID,
  p_movement_type TEXT,     -- breakage | gift | reservation | adjustment_in | adjustment_out
  p_quantity      INTEGER,  -- delta con signo (negativo = salida)
  p_notes         TEXT,
  p_created_by    UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_name TEXT;
  v_variant_name TEXT;
BEGIN
  IF NOT public.has_org_role(p_org_id, p_created_by, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires owner/admin role';
  END IF;

  IF p_movement_type NOT IN ('breakage','gift','reservation','adjustment_in','adjustment_out') THEN
    RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
  END IF;

  SELECT name INTO v_product_name FROM public.products WHERE id = p_product_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Product not found: %', p_product_id;
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = p_variant_id;
  END IF;

  RETURN public.record_stock_movement(
    p_org_id         => p_org_id,
    p_product_id     => p_product_id,
    p_variant_id     => p_variant_id,
    p_product_name   => v_product_name,
    p_variant_name   => v_variant_name,
    p_movement_type  => p_movement_type,
    p_quantity       => p_quantity,
    p_reference_type => 'manual',
    p_reference_id   => NULL,
    p_notes          => p_notes,
    p_created_by     => p_created_by
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_manual_stock_movement(
  UUID, UUID, UUID, TEXT, INTEGER, TEXT, UUID
) TO authenticated;
