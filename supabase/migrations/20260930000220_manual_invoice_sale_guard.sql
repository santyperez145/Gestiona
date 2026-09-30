-- La factura manual no puede anexarse a una venta con items/precios enviados
-- por el navegador. Las ventas se facturan exclusivamente desde la RPC que
-- toma el total ya persistido. Un borrador no fiscal tampoco discrimina IVA.

ALTER FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid)
  RENAME TO _crear_factura_manual_interna;
REVOKE ALL ON FUNCTION public._crear_factura_manual_interna(uuid, jsonb, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.crear_factura_manual(
  p_org uuid,
  p_customer jsonb,
  p_items jsonb,
  p_fiscal jsonb DEFAULT '{}'::jsonb,
  p_sale_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'Factura la venta desde su flujo de origen';
  END IF;
  IF jsonb_typeof(COALESCE(p_fiscal, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'La configuracion fiscal no es valida';
  END IF;
  IF NOT COALESCE((p_fiscal->>'enabled')::boolean, false) THEN
    p_fiscal := COALESCE(p_fiscal, '{}'::jsonb) || jsonb_build_object('tax_pct', 0);
  END IF;
  RETURN public._crear_factura_manual_interna(p_org, p_customer, p_items, p_fiscal, NULL);
END;
$fn$;

COMMENT ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid) IS
  'Factura manual sin vincular ventas; la venta existente usa facturar_venta_individual para conservar su importe persistido.';
REVOKE ALL ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid)
  TO authenticated, service_role;

DO $guard$
BEGIN
  IF has_function_privilege('authenticated',
       'public._crear_factura_manual_interna(uuid,jsonb,jsonb,jsonb,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.crear_factura_manual(uuid,jsonb,jsonb,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'La RPC de factura manual expone una ruta de venta no autorizada';
  END IF;
END;
$guard$;
