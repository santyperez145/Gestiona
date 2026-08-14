-- F10 / Ley 24.240 art. 34: el proveedor absorbe el costo de la devolución
-- cuando la persona ejerce el arrepentimiento de una compra a distancia.
-- Antes la tienda lo prometía en texto, pero return_requests no podía dejar
-- evidencia de quién lo pagaba ni de cómo se coordinó.

ALTER TABLE public.return_requests
  ADD COLUMN IF NOT EXISTS return_shipping_payer text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS return_shipping_amount numeric,
  ADD COLUMN IF NOT EXISTS return_shipping_method text,
  ADD COLUMN IF NOT EXISTS return_shipping_notes text;

DO $$ BEGIN
  ALTER TABLE public.return_requests
    ADD CONSTRAINT return_requests_return_shipping_payer_chk
    CHECK (return_shipping_payer IN ('seller', 'customer'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.return_requests
    ADD CONSTRAINT return_requests_return_shipping_amount_chk
    CHECK (return_shipping_amount IS NULL OR return_shipping_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.asignar_pago_envio_devolucion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Sólo aplica a la compra a distancia identificada contra una orden. Las
  -- devoluciones manuales de mostrador siguen su circuito propio.
  IF NEW.tipo = 'arrepentimiento' AND NEW.ecommerce_order_id IS NOT NULL THEN
    NEW.return_shipping_payer := 'seller';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_return_requests_return_shipping ON public.return_requests;
CREATE TRIGGER trg_return_requests_return_shipping
BEFORE INSERT OR UPDATE ON public.return_requests
FOR EACH ROW EXECUTE FUNCTION public.asignar_pago_envio_devolucion();

COMMENT ON COLUMN public.return_requests.return_shipping_payer IS
  'Quién absorbe el envío de vuelta. El trigger fija seller para arrepentimiento de una orden online, según Ley 24.240 art. 34.';
COMMENT ON COLUMN public.return_requests.return_shipping_amount IS
  'Costo real del retorno coordinado por el comercio; puede quedar NULL mientras espera cotización o etiqueta.';

-- Verificación contra la tabla real, con datos ZZ limpiados antes de salir.
DO $verificar$
DECLARE
  v_store record;
  v_order uuid;
  v_rma text := 'ZZ-F10-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_payer text;
BEGIN
  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores WHERE is_active ORDER BY created_at LIMIT 1;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'No hay tienda activa para verificar F10'; END IF;

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_email, customer_name, payment_status
  ) VALUES (
    v_store.org_id, v_store.id, v_rma, 'zz-f10@invalid.test', 'ZZ F10', 'paid'
  ) RETURNING id INTO v_order;

  INSERT INTO public.return_requests (
    org_id, rma_number, ecommerce_order_id, tipo, customer_name, product_name,
    return_shipping_payer, return_shipping_amount, return_shipping_method
  ) VALUES (
    v_store.org_id, v_rma, v_order, 'arrepentimiento', 'ZZ F10', 'ZZ producto',
    'customer', 1234, 'prepaid_label'
  );

  SELECT return_shipping_payer INTO v_payer
  FROM public.return_requests WHERE rma_number = v_rma;
  IF v_payer <> 'seller' THEN
    RAISE EXCEPTION 'El arrepentimiento no quedó a cargo del vendedor';
  END IF;

  DELETE FROM public.return_requests WHERE rma_number = v_rma;
  DELETE FROM public.ecommerce_orders WHERE id = v_order;
  IF EXISTS (SELECT 1 FROM public.return_requests WHERE rma_number = v_rma)
     OR EXISTS (SELECT 1 FROM public.ecommerce_orders WHERE order_number = v_rma)
  THEN RAISE EXCEPTION 'Quedaron datos ZZ de F10'; END IF;
END;
$verificar$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260814000005', 'return_shipping_cost') ON CONFLICT DO NOTHING;
