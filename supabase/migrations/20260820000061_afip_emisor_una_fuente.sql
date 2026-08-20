-- ═══════════════════════════════════════════════════════════════════════════
-- El tipo de emisor tenía dos fuentes y una sola se escribía
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Apareció construyendo C14. El panel guarda la configuración fiscal con
-- `save_afip_config`, que escribe **`afip_credentials`**. Pero hay tres cosas
-- que deciden plata leyendo **`settings.afip_tipo_emisor`**:
--
--   `trg_iva_de_orden`      — si la orden lleva IVA discriminado
--   `create_store_order`    — el comprobante y el pedido de CUIT en el checkout
--   `facturar_orden_pagada` — el tipo de comprobante al facturar (C13)
--
-- Y **nada mantenía esa columna**. Para la única organización configurada hoy
-- coincide, pero por casualidad: se cargó a mano en la sesión 114. Un comercio
-- nuevo que configure AFIP desde el panel queda con `settings.afip_tipo_emisor`
-- en NULL, y entonces un monotributista **emite órdenes con IVA discriminado**.
--
-- Es exactamente el bug que ya pasó y que costó corregir seis órdenes a mano.
-- Se había arreglado del lado del lector —el trigger pasó a leer el campo— sin
-- arreglar que el campo no se llenaba solo. Volvía a pasar con el primer
-- comercio nuevo.
--
-- ── Por qué un trigger y no arreglar `save_afip_config` ────────────────────
--
-- Porque el RPC no es el único que escribe `afip_credentials`: también lo hacen
-- la Edge Function `afip-credentials` y cualquier camino que se agregue
-- después. Arreglar el llamador deja el próximo sin arreglar. El trigger hace
-- que **`afip_credentials` sea la autoridad y `settings` un espejo derivado**,
-- que es lo que la lectura ya suponía.
--
-- No se cambian los tres lectores: reescribir `create_store_order` (369 líneas)
-- para mover un SELECT sería mucho riesgo para ninguna ganancia. El que sí
-- cambia es el de C13, que es nuevo y puede leer la autoridad directamente.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El espejo lo mantiene la base ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_afip_espejo_settings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  UPDATE public.settings SET
    afip_cuit         = NEW.cuit,
    afip_razon_social = NEW.razon_social,
    afip_domicilio    = NEW.domicilio,
    afip_tipo_emisor  = NEW.tipo_emisor,
    afip_punto_venta  = NEW.punto_venta,
    afip_environment  = NEW.environment
  WHERE org_id = NEW.org_id;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_afip_espejo_settings ON public.afip_credentials;
CREATE TRIGGER trg_afip_espejo_settings
AFTER INSERT OR UPDATE OF cuit, razon_social, domicilio, tipo_emisor, punto_venta, environment
ON public.afip_credentials
FOR EACH ROW EXECUTE FUNCTION public.trg_afip_espejo_settings();

COMMENT ON TRIGGER trg_afip_espejo_settings ON public.afip_credentials IS
  'afip_credentials es la autoridad; settings.afip_* es un espejo derivado que leen trg_iva_de_orden y create_store_order. Sin esto un monotributista nuevo emite con IVA discriminado.';

-- Y se corrige lo que ya estaba desalineado. Toca sólo las organizaciones que
-- difieren: un UPDATE a todas movería `updated_at` sin motivo.
UPDATE public.settings s SET
  afip_cuit         = a.cuit,
  afip_razon_social = a.razon_social,
  afip_domicilio    = a.domicilio,
  afip_tipo_emisor  = a.tipo_emisor,
  afip_punto_venta  = a.punto_venta,
  afip_environment  = a.environment
FROM public.afip_credentials a
WHERE s.org_id = a.org_id
  AND (s.afip_cuit         IS DISTINCT FROM a.cuit
    OR s.afip_razon_social IS DISTINCT FROM a.razon_social
    OR s.afip_domicilio    IS DISTINCT FROM a.domicilio
    OR s.afip_tipo_emisor  IS DISTINCT FROM a.tipo_emisor
    OR s.afip_punto_venta  IS DISTINCT FROM a.punto_venta
    OR s.afip_environment  IS DISTINCT FROM a.environment);

-- ── 2. `save_afip_config` acepta 'exento' ──────────────────────────────────
--
-- `tipo_de_comprobante` y `condicion_iva_codigo` ya lo contemplan; el RPC lo
-- rechazaba, así que un exento no podía terminar de configurarse. Se reemplaza
-- sólo el CHECK del tipo de emisor: el resto de la función queda igual.

CREATE OR REPLACE FUNCTION public.save_afip_config(
  p_org_id uuid, p_cuit text, p_punto_venta integer, p_environment text,
  p_tipo_emisor text DEFAULT NULL, p_razon_social text DEFAULT NULL,
  p_domicilio text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF p_org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.memberships AS membership
     WHERE membership.org_id = p_org_id
       AND membership.user_id = auth.uid()
       AND membership.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden configurar AFIP para esta organización';
  END IF;

  IF p_environment NOT IN ('homologacion', 'produccion') THEN
    RAISE EXCEPTION 'Entorno inválido: %', p_environment;
  END IF;

  IF regexp_replace(COALESCE(p_cuit, ''), '\D', '', 'g') !~ '^\d{11}$' THEN
    RAISE EXCEPTION 'El CUIT debe tener 11 dígitos';
  END IF;

  -- ⚠️ El dígito verificador además de la longitud. Un CUIT de 11 dígitos con
  -- el verificador mal pasa este RPC y hace fallar la **factura**, no el alta:
  -- el error aparecería recién con una venta real que facturar.
  IF NOT public.cuit_valido(regexp_replace(p_cuit, '\D', '', 'g')) THEN
    RAISE EXCEPTION 'El CUIT no es válido (dígito verificador)';
  END IF;

  IF p_punto_venta IS NULL OR p_punto_venta NOT BETWEEN 1 AND 9999 THEN
    RAISE EXCEPTION 'El punto de venta debe estar entre 1 y 9999';
  END IF;

  -- 'exento' faltaba, y es una condición válida que el resto del sistema ya
  -- maneja: `tipo_de_comprobante` y `condicion_iva_codigo` la contemplan.
  IF p_tipo_emisor IS NOT NULL
     AND p_tipo_emisor NOT IN ('monotributo', 'responsable_inscripto', 'exento') THEN
    RAISE EXCEPTION 'Tipo de emisor inválido';
  END IF;

  INSERT INTO public.afip_credentials AS credentials (
    org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio
  ) VALUES (
    p_org_id,
    regexp_replace(p_cuit, '\D', '', 'g'),
    p_punto_venta, p_environment, p_tipo_emisor,
    NULLIF(trim(p_razon_social), ''), NULLIF(trim(p_domicilio), '')
  )
  ON CONFLICT (org_id) DO UPDATE SET
    cuit = EXCLUDED.cuit,
    punto_venta = EXCLUDED.punto_venta,
    -- Cambiar de ambiente invalida el ticket: se pidió contra el otro WSAA.
    ta_token      = CASE WHEN credentials.environment <> EXCLUDED.environment THEN NULL ELSE credentials.ta_token END,
    ta_sign       = CASE WHEN credentials.environment <> EXCLUDED.environment THEN NULL ELSE credentials.ta_sign END,
    ta_expires_at = CASE WHEN credentials.environment <> EXCLUDED.environment THEN NULL ELSE credentials.ta_expires_at END,
    environment = EXCLUDED.environment,
    tipo_emisor = EXCLUDED.tipo_emisor,
    razon_social = EXCLUDED.razon_social,
    domicilio = EXCLUDED.domicilio,
    updated_at = now();

  -- El modo no se toca: lo decide subir o borrar un certificado, no editar los
  -- datos fiscales. Una organización nueva entra en 'delegado' por el default
  -- de la columna, que es lo que corresponde — todavía no subió nada.
  RETURN jsonb_build_object(
    'ok', true,
    'modo', (SELECT modo FROM public.afip_credentials WHERE org_id = p_org_id));
END;
$fn$;

-- ── 3. Se va el duplicado ──────────────────────────────────────────────────
--
-- `guardar_identidad_afip` se creó en la migración anterior sin ver que
-- `save_afip_config` ya existía y hacía lo mismo. Dos caminos para guardar lo
-- mismo es exactamente el patrón que produjo este bug; dejarlo habría sido
-- agregar una quinta generación de esquema conviviendo.

DROP FUNCTION IF EXISTS public.guardar_identidad_afip(uuid, text, text, text, text, int, text);

-- ── 4. C13 lee la autoridad, no el espejo ──────────────────────────────────
--
-- El consumidor de facturación es nuevo, así que puede leer `afip_credentials`
-- directamente. El fallback a `settings` queda por si alguna organización
-- vieja tiene el dato sólo ahí.

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
