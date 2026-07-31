-- ═══════════════════════════════════════════════════════════════════════════
-- El comprador online entra al CRM
--
-- Una venta de la tienda creaba la fila en `sales` con `customer_name` como
-- texto, y nada más. El comprador nunca aparecía en `customers`, así que quedaba
-- afuera del RFM, de fidelidad, del seguimiento y de las campañas: justo las
-- herramientas para que vuelva a comprar. Una tienda que no te deja volver a
-- hablarle a quien ya te compró es media tienda.
--
-- Ahora, al confirmarse el pago, el comprador se da de alta o se actualiza,
-- matcheando por **email** — que es lo único estable que deja un comprador
-- online. El nombre no sirve como clave: "Juan Perez" y "juan pérez" son la
-- misma persona y dos filas distintas.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_customer_from_order(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order    record;
  v_owner    uuid;
  v_id       uuid;
  v_email    text;
  v_dir      text;
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RETURN NULL; END IF;

  v_email := lower(btrim(COALESCE(v_order.customer_email, '')));
  IF v_email = '' THEN RETURN NULL; END IF;  -- sin email no hay con qué matchear

  SELECT m.user_id INTO v_owner
  FROM public.memberships m
  WHERE m.org_id = v_order.org_id AND m.role = 'owner'
  ORDER BY m.joined_at LIMIT 1;
  IF v_owner IS NULL THEN RETURN NULL; END IF;

  -- Dirección legible a partir del jsonb de envío
  v_dir := NULLIF(btrim(concat_ws(', ',
    NULLIF(v_order.shipping_address->>'calle', ''),
    NULLIF(v_order.shipping_address->>'ciudad', ''),
    NULLIF(v_order.shipping_address->>'provincia', ''),
    NULLIF(v_order.shipping_address->>'cp', '')
  )), '');

  -- ¿Ya existe con ese email en esta organización?
  SELECT id INTO v_id
  FROM public.customers
  WHERE org_id = v_order.org_id AND lower(btrim(COALESCE(email, ''))) = v_email
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Existe: se COMPLETA lo que falte, nunca se pisa lo que el comercio cargó
    -- a mano. Un dato del checkout no vale más que uno que alguien escribió.
    UPDATE public.customers
       SET phone      = COALESCE(NULLIF(btrim(phone), ''), NULLIF(btrim(v_order.customer_phone), '')),
           address    = COALESCE(NULLIF(btrim(address), ''), v_dir),
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.customers (org_id, user_id, name, email, phone, address, tags)
  VALUES (
    v_order.org_id, v_owner,
    COALESCE(NULLIF(btrim(v_order.customer_name), ''), split_part(v_email, '@', 1)),
    v_email,
    NULLIF(btrim(v_order.customer_phone), ''),
    v_dir,
    -- Etiqueta de origen: deja segmentar "los que compraron online"
    ARRAY['tienda-online']
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_customer_from_order(uuid) FROM PUBLIC;

COMMENT ON FUNCTION public.upsert_customer_from_order IS
  'Alta o actualización del comprador en el CRM al confirmarse el pago. Matchea por email; nunca pisa datos cargados a mano.';

-- ── Engancharlo a la confirmación de pago ─────────────────────────────────
--
-- Se hace con un trigger y no editando `mark_store_order_paid` a propósito: esa
-- función ya fue modificada por dos sesiones distintas y reescribirla entera
-- para agregar una línea es pedir un conflicto. El trigger también cubre los
-- pagos marcados a mano desde el panel, que no pasan por esa función.
CREATE OR REPLACE FUNCTION public.trg_order_paid_to_crm()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_status = 'paid' AND COALESCE(OLD.payment_status, '') <> 'paid' THEN
    BEGIN
      PERFORM public.upsert_customer_from_order(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      -- El alta en el CRM nunca puede tumbar la confirmación de un pago.
      RAISE WARNING 'upsert_customer_from_order falló para %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecom_order_paid_crm ON public.ecommerce_orders;
CREATE TRIGGER trg_ecom_order_paid_crm
AFTER UPDATE OF payment_status ON public.ecommerce_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_order_paid_to_crm();

-- ── Backfill de lo ya vendido ─────────────────────────────────────────────
-- Las órdenes pagadas de antes también tienen que estar en el CRM.
DO $backfill$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.ecommerce_orders WHERE payment_status = 'paid' LOOP
    IF public.upsert_customer_from_order(r.id) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RAISE NOTICE 'Compradores incorporados al CRM: %', n;
END
$backfill$;
