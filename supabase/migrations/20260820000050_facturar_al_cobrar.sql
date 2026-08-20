-- ═══════════════════════════════════════════════════════════════════════════
-- C13 — la factura se arma sola cuando se cobra
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Con AFIP emitiendo (sesión 114) el sistema **puede** facturar. Lo que no hace
-- es facturar: hay que crear el comprobante a mano y autorizarlo uno por uno.
-- Eso no escala ni a diez pedidos por día, y peor, es donde se cometen los
-- errores — el tipo de comprobante equivocado, la condición del receptor mal, el
-- IVA que no correspondía.
--
-- ── Por qué va por el outbox y no adentro del cobro ───────────────────────
--
-- Porque facturar **no puede hacer fallar una venta**. Si ARCA está caído o la
-- factura sale mal, la plata ya entró y la orden tiene que quedar pagada igual.
-- El evento `orden.pagada` ya existe desde H2; esto es una suscripción más.
--
-- Es exactamente el caso que justificaba construir el outbox: un consumidor
-- nuevo es una fila, no una edición en el centro.
--
-- ── ⚠️ Lo que hace y lo que NO hace ───────────────────────────────────────
--
-- **Arma la factura completa y correcta.** Tipo de comprobante según quién
-- emite y quién recibe, condición frente al IVA del receptor, importes según la
-- clase, numeración interna, y el vínculo con la orden.
--
-- **No pide el CAE.** Autorizar sigue siendo un clic. Pedirlo desde acá
-- significaría llamar a ARCA desde una función de base adentro de la
-- transacción del outbox, y un timeout de ARCA dejaría el consumidor colgado
-- reintentando contra un organismo que ya autorizó. La autorización automática
-- es su propio problema —necesita idempotencia contra ARCA, no sólo contra
-- nuestra base— y va aparte.
--
-- Lo que se gana igual es lo que importa: **el comprobante ya no se tipea**, y
-- los datos que se equivocaban salen calculados.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El vínculo con la orden ─────────────────────────────────────────────
--
-- `invoices` tenía `sale_id` —la venta de mostrador— y nada para una orden de
-- la tienda. Sin esto no hay forma de saber si una orden ya se facturó, que es
-- justamente la guarda de idempotencia.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS ecommerce_order_id uuid REFERENCES public.ecommerce_orders(id) ON DELETE SET NULL;

-- ⚠️ Una orden, una factura. El outbox garantiza **al menos una vez**: sin este
-- índice un reintento crearía un segundo comprobante para la misma venta, y
-- dos facturas por una venta es un problema fiscal, no un duplicado cosmético.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_una_por_orden
  ON public.invoices (ecommerce_order_id) WHERE ecommerce_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_org_fecha_idx
  ON public.invoices (org_id, issue_date DESC);

-- ── 2. La numeración interna ───────────────────────────────────────────────
--
-- No confundir con el número de AFIP: ése lo asigna ARCA al autorizar y va en
-- `numero_afip`. Éste es el correlativo del sistema, para poder citar una
-- factura antes de que tenga CAE.

CREATE OR REPLACE FUNCTION public.siguiente_numero_factura(p_org uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_n int;
BEGIN
  -- Candado por organización: dos cobros simultáneos no pueden tomar el mismo
  -- número. Es el mismo patrón que el correlativo del ledger.
  PERFORM pg_advisory_xact_lock(hashtextextended('factura:' || p_org::text, 0));

  SELECT COALESCE(MAX(NULLIF(regexp_replace(number, '^FC-\d{6}-', ''), '')::int), 0) + 1
    INTO v_n
    FROM public.invoices
   WHERE org_id = p_org
     AND number ~ ('^FC-' || to_char(CURRENT_DATE, 'YYYYMM') || '-\d+$');

  RETURN 'FC-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' || lpad(v_n::text, 4, '0');
END;
$fn$;

REVOKE ALL ON FUNCTION public.siguiente_numero_factura(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. El consumidor ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.facturar_orden_pagada(p_evento jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_org      uuid;
  v_orden_id uuid;
  v_o        public.ecommerce_orders;
  v_ya       uuid;
  v_emisor   text;
  v_cbte     jsonb;
  v_esC      boolean;
  v_neto     numeric;
  v_iva      numeric;
  v_pct      numeric;
  v_id       uuid;
  v_numero   text;
BEGIN
  v_org      := NULLIF(p_evento->>'org_id', '')::uuid;
  v_orden_id := NULLIF(p_evento#>>'{data,order_id}', '')::uuid;
  IF v_org IS NULL OR v_orden_id IS NULL THEN
    RAISE EXCEPTION 'facturar_orden_pagada: el evento no trae org_id u order_id';
  END IF;

  -- ⚠️ La guarda de idempotencia va PRIMERO y mira la tabla, no una bandera:
  -- el outbox garantiza al menos una vez, y dos facturas por una venta es un
  -- problema fiscal.
  SELECT id INTO v_ya FROM public.invoices WHERE ecommerce_order_id = v_orden_id;
  IF v_ya IS NOT NULL THEN
    RETURN v_ya;
  END IF;

  SELECT * INTO v_o FROM public.ecommerce_orders WHERE id = v_orden_id;
  IF v_o.id IS NULL THEN
    RAISE EXCEPTION 'La orden % no existe', v_orden_id;
  END IF;

  IF COALESCE(v_o.total, 0) <= 0 THEN
    -- Una orden en cero no se factura. No es un error: puede ser un canje o
    -- una corrección.
    RETURN NULL;
  END IF;

  SELECT s.afip_tipo_emisor INTO v_emisor
    FROM public.settings s WHERE s.org_id = v_org LIMIT 1;

  -- Quién emite y quién recibe deciden el comprobante. Es la misma función que
  -- usa el checkout desde el trabajo de identidad fiscal: una sola regla.
  v_cbte := public.tipo_de_comprobante(v_emisor, v_o.buyer_tax_condition);
  v_esC  := (v_cbte->>'letra') = 'C';

  -- ⚠️ En un comprobante clase C el total ES el neto y el IVA es cero — ARCA
  -- rechaza lo contrario (errores 10047 y 10048, verificado emitiendo). Se
  -- calcula acá y no se copia de la orden, que puede traer IVA discriminado si
  -- la organización lo tenía mal configurado.
  IF v_esC THEN
    v_neto := ROUND(v_o.total, 2);
    v_iva  := 0;
    v_pct  := 0;
  ELSE
    v_iva  := ROUND(COALESCE(v_o.tax_amount, 0), 2);
    v_neto := ROUND(v_o.total - v_iva, 2);
    v_pct  := CASE WHEN v_neto > 0 THEN ROUND(v_iva / v_neto * 100, 2) ELSE 0 END;
  END IF;

  v_numero := public.siguiente_numero_factura(v_org);

  INSERT INTO public.invoices (
    org_id, number, ecommerce_order_id,
    customer_name, customer_email, customer_tax_id,
    issue_date, due_date, status, currency,
    subtotal, tax_pct, tax_amount, total,
    tipo_comprobante, condicion_iva_receptor,
    afip_status, notes)
  VALUES (
    v_org, v_numero, v_orden_id,
    COALESCE(NULLIF(btrim(v_o.customer_name), ''), 'Consumidor final'),
    v_o.customer_email,
    NULLIF(v_o.buyer_doc_number, ''),
    CURRENT_DATE, CURRENT_DATE, 'draft', 'ARS',
    v_neto, v_pct, v_iva, ROUND(v_o.total, 2),
    (v_cbte->>'codigo_afip')::int,
    public.condicion_iva_codigo(v_o.buyer_tax_condition),
    'pending',
    'Generada automáticamente por la orden ' || COALESCE(v_o.order_number, '?'))
  RETURNING id INTO v_id;

  PERFORM public.emitir_evento(v_org, 'factura', v_id, 'factura.creada',
    jsonb_build_object(
      'invoice_id', v_id, 'order_id', v_orden_id, 'numero', v_numero,
      'tipo', v_cbte->>'letra', 'total', v_o.total));

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.facturar_orden_pagada(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 4. La suscripción ──────────────────────────────────────────────────────
--
-- Global (`org_id` NULL): facturar es del sistema, no de un comercio en
-- particular, y una fila por organización se olvidaría al dar de alta la
-- siguiente.

INSERT INTO public.event_subscriptions (org_id, nombre, patron, destino, objetivo, max_intentos)
VALUES (NULL, 'facturacion: venta cobrada', 'orden.pagada', 'interno', 'facturar_orden_pagada', 10)
ON CONFLICT (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), nombre)
DO UPDATE SET patron = EXCLUDED.patron, destino = EXCLUDED.destino,
              objetivo = EXCLUDED.objetivo, is_active = true, updated_at = now();

-- ── 5. Qué falta facturar ──────────────────────────────────────────────────
--
-- Una orden cobrada sin factura es plata cobrada sin comprobante. Que se pueda
-- ver en una consulta es la diferencia entre enterarse hoy y enterarse cuando
-- lo pregunta el contador.

CREATE OR REPLACE VIEW public.ordenes_sin_facturar AS
SELECT
  o.org_id,
  o.id AS order_id,
  o.order_number,
  o.customer_name,
  o.total,
  o.created_at,
  EXTRACT(day FROM now() - o.created_at)::int AS dias
FROM public.ecommerce_orders o
WHERE o.payment_status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.ecommerce_order_id = o.id)
  AND public.is_org_member(o.org_id, auth.uid());

COMMENT ON VIEW public.ordenes_sin_facturar IS
  'Ordenes cobradas sin comprobante. Deberia estar vacia: una venta cobrada sin factura es plata cobrada sin respaldo.';

GRANT SELECT ON public.ordenes_sin_facturar TO authenticated;
