-- ═══════════════════════════════════════════════════════════════════════════
-- Quién emite la factura no se adivina
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `settings.afip_tipo_emisor` tenía `DEFAULT 'monotributo'`. Es el mismo caso
-- que `industry_code DEFAULT 'perfumes'`, que se sacó el 2026-08-25 por la
-- misma razón: un default que era cierto cuando esto era la app de un solo
-- negocio y es una adivinanza para cualquier otro.
--
-- ⚠️ Pero éste es fiscal. Un **responsable inscripto** que se registra queda
-- marcado como monotributista, y sus comprobantes salen **Factura C sin IVA
-- discriminado**. No falla nada: falla el comprobante, meses después, cuando lo
-- mira un contador o lo rechaza el organismo.
--
-- Y no se veía porque NULL y 'monotributo' se comportan **idéntico**:
-- `discrimina_iva` es `COALESCE(p_emisor,'') = 'responsable_inscripto'`, así que
-- las dos dan `false` y `tipo_de_comprobante` devuelve C en los dos casos.
-- Sacar el default sin más no cambiaría nada.
--
-- ── Lo que sí cambia ───────────────────────────────────────────────────────
--
-- **Vender sigue funcionando sin configurar AFIP.** Eso está bien: un comercio
-- tiene que poder empezar a operar el primer día.
--
-- **Emitir un comprobante, no.** Facturar bajo una identidad fiscal adivinada
-- es firmar un documento en nombre de alguien sin saber quién es. La orden
-- queda pendiente y visible, con el motivo escrito.
--
-- Se elige este punto y no `tipo_de_comprobante` —que sería el único
-- estrangulamiento— porque esa función también la usa el checkout: hacerla
-- fallar dejaría sin vender a todo comercio que todavía no configuró AFIP.
--
-- ── El otro default que adivina ────────────────────────────────────────────
--
-- `exchange_rate DEFAULT 1695` es una cotización congelada en el día que se
-- escribió. Un comercio que se registre dentro de seis meses calcula **todos**
-- sus costos con ella, y el error va en la dirección que no se nota: el margen
-- sale distinto del real sin que aparezca ningún cero ni ningún error.
--
-- Pasa a NULL. El ledger ya avisa y anota `sin_tipo_de_cambio` en la metadata
-- del asiento desde 20260825000061: un costo ausente y señalado es mejor que
-- uno presente y equivocado.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.settings ALTER COLUMN afip_tipo_emisor DROP DEFAULT;

-- ⚠️ `exchange_rate` es NOT NULL. Sacarle el default SIN sacarle el NOT NULL
-- rompe TODO INSERT que no lo provea — incluido el alta de usuarios, que
-- inserta (org_id, user_id, business_name) y nada más.
--
-- Pasó en esta misma migración: la primera versión sólo dropeaba el default y
-- `handle_new_user_create_org` empezó a fallar con
-- "null value in column exchange_rate violates not-null constraint".
-- Se detectó reproduciendo el alta antes de commitear.
--
-- NULL es el estado correcto: "no cargó cotización". El ledger ya lo contempla
-- y lo anota en la metadata del asiento (20260825000061).
ALTER TABLE public.settings ALTER COLUMN exchange_rate DROP NOT NULL;
ALTER TABLE public.settings ALTER COLUMN exchange_rate DROP DEFAULT;

COMMENT ON COLUMN public.settings.afip_tipo_emisor IS
  'Condicion frente al IVA de QUIEN EMITE. NULL = todavia no lo eligio, y es un estado real: no se factura hasta saberlo. Sin esto un responsable inscripto emitia Factura C sin IVA discriminado.';

COMMENT ON COLUMN public.settings.exchange_rate IS
  'Cotizacion del dolar de esta organizacion. NULL = no cargada. Tenia DEFAULT 1695, una cotizacion congelada que dejaba a todo comercio nuevo calculando costos con el dolar de otro dia.';

-- ── La facturación automática no inventa la identidad fiscal ───────────────

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

  -- La autoridad es `afip_credentials`; `settings` queda de respaldo para
  -- organizaciones viejas que tengan el dato sólo ahí.
  SELECT a.tipo_emisor INTO v_emisor
    FROM public.afip_credentials a WHERE a.org_id = v_org;
  IF v_emisor IS NULL THEN
    SELECT s.afip_tipo_emisor INTO v_emisor
      FROM public.settings s WHERE s.org_id = v_org LIMIT 1;
  END IF;

  -- ⚠️ Sin condición frente al IVA no se factura.
  --
  -- Antes esto no podía pasar: la columna tenía `DEFAULT 'monotributo'`, así
  -- que siempre había un valor — aunque fuera inventado. Un responsable
  -- inscripto emitía Factura C sin IVA discriminado y el error aparecía meses
  -- después.
  --
  -- La orden queda pendiente en `ordenes_sin_facturar`, con el motivo. Vender
  -- sigue funcionando; emitir un comprobante bajo una identidad fiscal
  -- adivinada, no.
  IF v_emisor IS NULL THEN
    RAISE WARNING 'La orden % no se factura: la organizacion no declaro su condicion frente al IVA',
      COALESCE(v_o.order_number, v_orden_id::text);
    RETURN NULL;
  END IF;

  v_cbte := public.tipo_de_comprobante(v_emisor, v_o.buyer_tax_condition);
  v_esC  := (v_cbte->>'letra') = 'C';

  -- ⚠️ En un comprobante clase C el total ES el neto y el IVA es cero — ARCA
  -- rechaza lo contrario (errores 10047 y 10048, verificado emitiendo).
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

-- ── La vista dice por qué quedó sin comprobante ────────────────────────────
--
-- "3 ventas sin factura" manda a adivinar. "3 ventas sin factura porque no
-- declaraste tu condición frente al IVA" se arregla en un minuto.

CREATE OR REPLACE VIEW public.ordenes_sin_facturar AS
SELECT
  o.org_id,
  o.id AS order_id,
  o.order_number,
  o.customer_name,
  o.total,
  o.created_at,
  EXTRACT(day FROM now() - o.created_at)::int AS dias,
  CASE
    WHEN COALESCE(
           (SELECT a.tipo_emisor FROM public.afip_credentials a WHERE a.org_id = o.org_id),
           (SELECT s.afip_tipo_emisor FROM public.settings s WHERE s.org_id = o.org_id)
         ) IS NULL
      THEN 'falta declarar la condicion frente al IVA del emisor'
    WHEN COALESCE(o.total, 0) <= 0 THEN 'la orden es de importe cero'
    ELSE 'pendiente de facturar'
  END AS motivo
FROM public.ecommerce_orders o
WHERE o.payment_status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.ecommerce_order_id = o.id)
  AND public.is_org_member(o.org_id, auth.uid());

COMMENT ON VIEW public.ordenes_sin_facturar IS
  'Ordenes cobradas sin comprobante, con el MOTIVO. Deberia estar vacia: una venta cobrada sin factura es plata cobrada sin respaldo.';

GRANT SELECT ON public.ordenes_sin_facturar TO authenticated;

-- ── La guarda ──────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.audit_settings_adivinados AS
SELECT
  s.org_id,
  (SELECT o.name FROM public.organizations o WHERE o.id = s.org_id) AS organizacion,
  s.afip_tipo_emisor IS NULL AS sin_condicion_iva,
  s.exchange_rate IS NULL    AS sin_cotizacion,
  s.industry_code IS NULL    AS sin_rubro
FROM public.settings s
WHERE s.afip_tipo_emisor IS NULL
   OR s.exchange_rate IS NULL
   OR s.industry_code IS NULL;

COMMENT ON VIEW public.audit_settings_adivinados IS
  'Organizaciones a las que les falta un dato que el sistema NO debe adivinar: condicion frente al IVA, cotizacion o rubro. No es un error: es trabajo de onboarding pendiente, y sin esta vista no se ve.';

REVOKE ALL ON public.audit_settings_adivinados FROM anon, authenticated;
