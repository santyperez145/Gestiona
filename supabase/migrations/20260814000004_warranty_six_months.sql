-- F11 / Ley 24.240 art. 11: la garantía de un producto nuevo vence seis meses
-- después de la entrega. No se toca el arrepentimiento: tiene otra ventana y
-- sigue siendo de diez días desde la entrega, sin necesidad de expresar causa.
--
-- Si la tienda no registró delivered_at, no se puede hacer vencer la garantía
-- por una omisión propia. El trigger sólo cierra el plazo cuando esa evidencia
-- existe. Se engancha a return_requests y no sólo al RPC público para que el
-- alta desde cualquier superficie cumpla la misma regla.

CREATE OR REPLACE FUNCTION public.validar_plazo_garantia_devolucion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_entregado_at timestamptz;
BEGIN
  IF NEW.tipo <> 'falla' OR NEW.ecommerce_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT delivered_at INTO v_entregado_at
  FROM public.ecommerce_orders
  WHERE id = NEW.ecommerce_order_id;

  -- La FK asegura que la orden existe. Con fecha desconocida, el plazo no se
  -- corta: cargar la entrega es responsabilidad del vendedor, no del cliente.
  IF v_entregado_at IS NOT NULL
     AND now() > v_entregado_at + interval '6 months' THEN
    RAISE EXCEPTION
      'Pasaron los 6 meses de garantía legal desde la entrega. Si necesitás ayuda, contactá al vendedor.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_return_requests_warranty_window ON public.return_requests;
CREATE TRIGGER trg_return_requests_warranty_window
BEFORE INSERT OR UPDATE OF tipo, ecommerce_order_id ON public.return_requests
FOR EACH ROW EXECUTE FUNCTION public.validar_plazo_garantia_devolucion();

COMMENT ON FUNCTION public.validar_plazo_garantia_devolucion() IS
  'Ley 24.240 art. 11: bloquea reclamos por falla de productos nuevos más de seis meses después de delivered_at. No vence si la entrega no fue registrada.';

-- Verificación contra el camino real, con filas ZZ que se borran en el mismo
-- bloque. Comprueba una orden vencida, una vigente y una sin fecha de entrega.
DO $verificar$
DECLARE
  v_store record;
  v_vencida uuid;
  v_vigente uuid;
  v_sin_fecha uuid;
  v_rma text := 'ZZ-GAR-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
BEGIN
  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores
  WHERE is_active
  ORDER BY created_at
  LIMIT 1;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'No hay una tienda activa para verificar la garantía';
  END IF;

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_email, customer_name,
    payment_status, delivered_at
  ) VALUES (
    v_store.org_id, v_store.id, v_rma || '-V', 'zz-garantia@invalid.test',
    'ZZ garantía vencida', 'paid', now() - interval '6 months 1 second'
  ) RETURNING id INTO v_vencida;

  BEGIN
    INSERT INTO public.return_requests (
      org_id, rma_number, ecommerce_order_id, tipo, customer_name, product_name
    ) VALUES (
      v_store.org_id, v_rma || '-V', v_vencida, 'falla',
      'ZZ garantía vencida', 'ZZ producto'
    );
    RAISE EXCEPTION 'La garantía vencida fue aceptada';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Pasaron los 6 meses de garantía legal%' THEN RAISE; END IF;
  END;

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_email, customer_name,
    payment_status, delivered_at
  ) VALUES (
    v_store.org_id, v_store.id, v_rma || '-A', 'zz-garantia@invalid.test',
    'ZZ garantía vigente', 'paid', now() - interval '5 months 15 days'
  ) RETURNING id INTO v_vigente;

  INSERT INTO public.return_requests (
    org_id, rma_number, ecommerce_order_id, tipo, customer_name, product_name
  ) VALUES (
    v_store.org_id, v_rma || '-A', v_vigente, 'falla',
    'ZZ garantía vigente', 'ZZ producto'
  );

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_email, customer_name, payment_status
  ) VALUES (
    v_store.org_id, v_store.id, v_rma || '-S', 'zz-garantia@invalid.test',
    'ZZ garantía sin fecha', 'paid'
  ) RETURNING id INTO v_sin_fecha;

  INSERT INTO public.return_requests (
    org_id, rma_number, ecommerce_order_id, tipo, customer_name, product_name
  ) VALUES (
    v_store.org_id, v_rma || '-S', v_sin_fecha, 'falla',
    'ZZ garantía sin fecha', 'ZZ producto'
  );

  DELETE FROM public.return_requests WHERE ecommerce_order_id IN (v_vencida, v_vigente, v_sin_fecha);
  DELETE FROM public.ecommerce_orders WHERE id IN (v_vencida, v_vigente, v_sin_fecha);

  IF EXISTS (
    SELECT 1 FROM public.ecommerce_orders WHERE order_number LIKE v_rma || '%'
  ) OR EXISTS (
    SELECT 1 FROM public.return_requests WHERE rma_number LIKE v_rma || '%'
  ) THEN
    RAISE EXCEPTION 'Quedaron filas ZZ de la verificación de garantía';
  END IF;
END;
$verificar$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260814000004', 'warranty_six_months') ON CONFLICT DO NOTHING;
