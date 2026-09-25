-- ============================================================================
-- Timeline 360 del cliente: una sola fila de tiempo con todo lo que pasó
--
-- La ficha 360 ya mostraba cada fuente en su tab: compras, deudas,
-- presupuestos, oportunidades, comunicaciones. Pero eran seis lecturas
-- separadas que el comercio tenía que recorrer una por una para responder la
-- única pregunta que importa: "¿qué pasó con este cliente y cuándo?".
--
-- Esta RPC devuelve UNA fila de tiempo con:
--
--   1. ventas (`sales`) — con atribución de creador vía `influencer_sales`
--      y pedido online cuando `ecommerce_order_id` está seteado;
--   2. pedidos de tienda (`ecommerce_orders`) — incluyen los pagados cuya
--      venta aún no se generó, que hoy no aparecen en ninguna ficha;
--   3. notas e interacciones (`customer_communications`) — llamada, email,
--   4. WhatsApp saliente real (`birthday_whatsapp_deliveries`) y el
--      `customer_communications` de tipo whatsapp registrado a mano;
--   5. deudas (`debts`) y seguimientos programados (`crm_followups`).
--
-- El cruce del cliente es el mismo que la UI usa con `belongsToCustomer`:
-- `customer_id` manda; si la fila no está enlazada (gente dada de alta
-- después de comprar), cruza por `normalize_person_name`. Cada fila devuelve
-- `linked_by` ('id' | 'nombre' | 'email') para que la ficha muestre la
-- evidencia del cruce en vez de presuponerlo.
--
-- ⚠️ Lo que NO es: no es una tabla nueva ni un segundo source of truth. Es una
-- lectura unificada server-side sobre las tablas que ya existen. Sin RLS
-- propia porque SECURITY DEFINER autoriza explícitamente: miembro de la org +
-- permiso de lectura de `customers`. El cliente nunca declara al cliente:
-- la RPC valida que la ficha pertenezca a la org pedida.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.customer_timeline_360(
  p_org_id      uuid,
  p_customer_id uuid,
  p_limit       int DEFAULT 40,
  p_offset      int DEFAULT 0
)
RETURNS TABLE (
  kind        text,        -- venta | pedido_online | nota | whatsapp | deuda
  occurred_at timestamptz,
  title       text,
  detail      text,
  amount_ars  numeric,
  source_id   uuid,
  linked_by   text         -- id | nombre | email
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user  uuid := auth.uid();
  v_name  text;
  v_email text;
  v_norm  text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023';
  END IF;
  IF p_offset < 0 OR p_offset > 10000 THEN
    RAISE EXCEPTION 'invalid_offset' USING ERRCODE = '22023';
  END IF;

  -- Autoridad server-side: miembro de la org con permiso de ver clientes.
  IF NOT public.is_org_member(p_org_id, v_user)
     OR NOT public.has_permission(p_org_id, 'customers', 'view') THEN
    RAISE EXCEPTION 'customers_permission_denied' USING ERRCODE = '42501';
  END IF;

  -- El cliente pedido tiene que ser de esta org: un id de otra org es
  -- customer_not_found, no una fuga de datos cruzada.
  SELECT name, lower(btrim(COALESCE(email, ''))) INTO v_name, v_email
    FROM public.customers
   WHERE id = p_customer_id AND org_id = p_org_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = '22023';
  END IF;
  v_norm := public.normalize_person_name(v_name);
  v_email := NULLIF(btrim(v_email), '');

  RETURN QUERY
  SELECT * FROM (

    -- ── Ventas POS / importadas, con atribución de creador si la hay ──────
    (SELECT 'venta'::text, s.date, s.product_name,
           concat_ws(' · ',
             CASE WHEN i.name IS NOT NULL THEN 'creador ' || i.name END,
             CASE WHEN NOT s.paid THEN 'impaga' END,
             CASE WHEN s.ecommerce_order_id IS NOT NULL THEN 'pedido online' END,
             CASE WHEN s.coupon_code IS NOT NULL THEN 'cupón ' || s.coupon_code END),
           s.total_ars,
           s.id,
           CASE WHEN s.customer_id IS NOT NULL THEN 'id' ELSE 'nombre' END
    FROM public.sales s
    LEFT JOIN public.influencer_sales isx ON isx.sale_id = s.id
    LEFT JOIN public.influencers i        ON i.id = isx.influencer_id
    WHERE s.org_id = p_org_id
      AND ( s.customer_id = p_customer_id
            OR (s.customer_id IS NULL AND v_norm IS NOT NULL
                AND public.normalize_person_name(s.customer_name) = v_norm) )
    LIMIT 120)

    UNION ALL

    -- ── Pedidos de la tienda online ────────────────────────────────────────
    (SELECT 'pedido_online', o.created_at,
           'Pedido ' || o.order_number,
           'pago: ' || o.payment_status || ' · envío: ' || o.fulfillment_status,
           o.total,
           o.id,
           CASE WHEN o.customer_id = p_customer_id THEN 'id' ELSE 'email' END
    FROM public.ecommerce_orders o
    WHERE o.org_id = p_org_id
      AND ( o.customer_id = p_customer_id
            OR (o.customer_id IS NULL AND v_email IS NOT NULL
                AND lower(btrim(o.customer_email)) = v_email) )
    LIMIT 120)

    UNION ALL

    -- ── Notas, llamadas, emails y visitas registradas ──────────────────────
    (SELECT CASE WHEN c.type = 'whatsapp' THEN 'whatsapp' ELSE 'nota' END,
           c.created_at,
           c.summary,
           CASE WHEN c.follow_up_date IS NOT NULL
                THEN 'seguimiento ' || to_char(c.follow_up_date, 'YYYY-MM-DD')
                || CASE WHEN c.outcome = 'completed' THEN ' (hecho)' ELSE ' (pendiente)' END
           END,
           NULL::numeric,
           c.id,
           CASE WHEN c.customer_id IS NOT NULL THEN 'id' ELSE 'nombre' END
    FROM public.customer_communications c
    WHERE c.org_id = p_org_id
      AND ( c.customer_id = p_customer_id
            OR (c.customer_id IS NULL AND v_norm IS NOT NULL
                AND public.normalize_person_name(c.customer_name) = v_norm) )
    LIMIT 120)

    UNION ALL

    -- ── WhatsApp saliente server-side (cumpleaños automatizado) ────────────
    (SELECT 'whatsapp', b.created_at,
           'WhatsApp de cumpleaños',
           CASE b.status
             WHEN 'sent' THEN 'enviado'
             WHEN 'failed' THEN 'falló' || coalesce(' — ' || b.error, '')
             ELSE 'procesando'
           END,
           NULL::numeric,
           b.id,
           'id'
    FROM public.birthday_whatsapp_deliveries b
    WHERE b.org_id = p_org_id AND b.customer_id = p_customer_id
    LIMIT 120)

    UNION ALL

    -- ── Deudas del cliente ─────────────────────────────────────────────────
    (SELECT 'deuda', d.date,
           coalesce(nullif(btrim(d.description), ''), 'Deuda registrada'),
           'estado: ' || d.status
             || coalesce(' · vence ' || to_char(d.due_date, 'YYYY-MM-DD'), ''),
           d.remaining_ars,
           d.id,
           CASE WHEN d.customer_id IS NOT NULL THEN 'id' ELSE 'nombre' END
    FROM public.debts d
    WHERE d.org_id = p_org_id
      AND ( d.customer_id = p_customer_id
            OR (d.customer_id IS NULL AND v_norm IS NOT NULL
                AND public.normalize_person_name(d.customer_name) = v_norm) )
    LIMIT 120)

    -- ── Seguimientos programados del CRM (crm_followups) ───────────────────
    UNION ALL
    (SELECT 'nota',
           f.created_at,
           'Seguimiento: ' || f.customer_name,
           CASE f.status
             WHEN 'pending' THEN 'pendiente' || coalesce(' · ' || f.notes, '')
             WHEN 'done' THEN 'hecho' || coalesce(' · ' || f.notes, '')
             ELSE f.status || coalesce(' · ' || f.notes, '')
           END,
           NULL::numeric,
           f.id,
           CASE WHEN f.customer_id IS NOT NULL THEN 'id' ELSE 'nombre' END
    FROM public.crm_followups f
    WHERE f.org_id = p_org_id
      AND ( f.customer_id = p_customer_id
            OR (f.customer_id IS NULL AND v_norm IS NOT NULL
                AND public.normalize_person_name(f.customer_name) = v_norm) )
    LIMIT 120)

  ) AS timeline(kind, occurred_at, title, detail, amount_ars, source_id, linked_by)
  ORDER BY timeline.occurred_at DESC, timeline.source_id
  LIMIT p_limit OFFSET p_offset;
END;
$fn$;

COMMENT ON FUNCTION public.customer_timeline_360(uuid, uuid, int, int) IS
  'Timeline 360 del cliente: ventas, pedidos online, notas, WhatsApp, deudas y touchpoints en una lectura server-side. Autoriza por membresía + permiso customers:view; el cruce por nombre es fallback de filas sin customer_id y se declara en linked_by.';

REVOKE ALL ON FUNCTION public.customer_timeline_360(uuid, uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_timeline_360(uuid, uuid, int, int) TO authenticated;

-- ── Certificación ────────────────────────────────────────────────────────────
DO $cert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'customer_timeline_360'
      AND pg_get_function_result(p.oid) LIKE '%linked_by%'
  ) THEN
    RAISE EXCEPTION 'customer_timeline_360 sin columna linked_by';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ecommerce_orders'
      AND column_name = 'customer_id'
  ) THEN
    RAISE EXCEPTION 'ecommerce_orders sin customer_id: pedidos de tienda no cruzan con la ficha';
  END IF;
END;
$cert$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260925000700', 'customer_timeline_360')
ON CONFLICT DO NOTHING;