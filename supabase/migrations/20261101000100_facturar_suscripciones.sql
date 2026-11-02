-- Nerqia factura la suscripción que cobra (RG 4291).
--
-- Mercado Pago cobra el plan del comercio y `suscripcion_registrar_pago` deja
-- el cobro en `saas_invoices`, pero ningún comprobante fiscal salía: toda
-- venta en Argentina lleva factura electrónica y `docs/LEGAL.md` lo marcaba
-- en naranja. Nerqia factura con el CUIT 20-44648443-6 en monotributo
-- (informado por el dueño el 2026-11-01): factura C de servicios.
--
-- Esta migración:
-- · `platform_facturacion`: qué organización de la plataforma emite como
--   Nerqia (su certificado y punto de venta de ARCA), activable desde
--   Plataforma. Se exige que su identidad fiscal sea ese CUIT en monotributo.
-- · `facturas_de_suscripcion`: una por cobro, con su estado (emitida,
--   esperando emisor, error), motivo e intentos.
-- · `facturar_cobro_de_suscripcion(saas_invoice)`: factura C de servicios
--   (concepto 2) con el período del plan, al comercio con su CUIT y condición
--   si los tiene declarados, si no a consumidor final. Usa `crear_factura_manual`
--   en nombre del dueño de la organización emisora (la misma validación,
--   numeración y evento `factura.creada`, que el outbox autoriza en ARCA).
-- · Un disparador en `saas_invoices` factura cada cobro aprobado; una falla
--   al facturar no frena el registro del pago: queda con su error.
-- · `reintentar_facturas_de_suscripcion()` cada día, y las funciones de
--   Plataforma para configurar, ver y reintentar.
-- Idempotente. Reversible: DROP de las funciones, el disparador y las tablas.
BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_facturacion (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  org_emisora_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  cuit_esperado text NOT NULL DEFAULT '20446484436' CHECK (cuit_esperado ~ '^[0-9]{11}$'),
  activa boolean NOT NULL DEFAULT false,
  actualizado_por uuid,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_facturacion (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.platform_facturacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_facturacion FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_facturacion TO service_role;
COMMENT ON TABLE public.platform_facturacion IS
  'Emisor de las facturas de Nerqia a los comercios (suscripción). Se lee y cambia sólo con las funciones de Plataforma.';

CREATE TABLE IF NOT EXISTS public.facturas_de_suscripcion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saas_invoice_id uuid NOT NULL UNIQUE REFERENCES public.saas_invoices(id) ON DELETE CASCADE,
  org_cliente_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  org_emisora_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  estado text NOT NULL CHECK (estado IN ('emitida', 'pendiente_emisor', 'error')),
  motivo text,
  intentos integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facturas_de_suscripcion_estado_idx ON public.facturas_de_suscripcion (estado, updated_at);
ALTER TABLE public.facturas_de_suscripcion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facturas_de_suscripcion FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.facturas_de_suscripcion TO service_role;

-- ───────────────────────── facturar un cobro ─────────────────────────
CREATE OR REPLACE FUNCTION public.facturar_cobro_de_suscripcion(p_saas_invoice uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cobro public.saas_invoices;
  v_conf public.platform_facturacion;
  v_ya public.facturas_de_suscripcion;
  v_emisor_cuit text;
  v_emisor_tipo text;
  v_duenio uuid;
  v_cliente text;
  v_cuit_cliente text;
  v_condicion text;
  v_plan text;
  v_desde date;
  v_hasta date;
  v_claims text;
  v_r jsonb;
  v_motivo text;
BEGIN
  SELECT * INTO v_cobro FROM public.saas_invoices WHERE id = p_saas_invoice;
  IF v_cobro.id IS NULL OR v_cobro.estado <> 'paid' OR coalesce(v_cobro.monto, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'no es un cobro aprobado');
  END IF;
  SELECT * INTO v_ya FROM public.facturas_de_suscripcion WHERE saas_invoice_id = p_saas_invoice FOR UPDATE;
  IF v_ya.estado = 'emitida' THEN
    RETURN jsonb_build_object('ok', true, 'invoice_id', v_ya.invoice_id, 'repetido', true);
  END IF;

  SELECT * INTO v_conf FROM public.platform_facturacion WHERE id;
  IF NOT coalesce(v_conf.activa, false) OR v_conf.org_emisora_id IS NULL THEN
    v_motivo := 'La facturación de Nerqia todavía no está activa (Plataforma › Negocio).';
  ELSE
    SELECT regexp_replace(coalesce(cuit, ''), '\D', '', 'g'), tipo_emisor INTO v_emisor_cuit, v_emisor_tipo
      FROM public.afip_credentials WHERE org_id = v_conf.org_emisora_id;
    IF v_emisor_cuit IS DISTINCT FROM v_conf.cuit_esperado OR v_emisor_tipo NOT IN ('monotributo', 'monotributista') THEN
      v_motivo := 'La organización emisora no tiene la identidad fiscal de Nerqia (CUIT ' || v_conf.cuit_esperado || ', monotributo).';
    END IF;
  END IF;
  IF v_motivo IS NOT NULL THEN
    INSERT INTO public.facturas_de_suscripcion (saas_invoice_id, org_cliente_id, org_emisora_id, estado, motivo)
    VALUES (p_saas_invoice, v_cobro.org_id, v_conf.org_emisora_id, 'pendiente_emisor', v_motivo)
    ON CONFLICT (saas_invoice_id) DO UPDATE
      SET estado = 'pendiente_emisor', motivo = EXCLUDED.motivo, updated_at = now();
    RETURN jsonb_build_object('ok', false, 'motivo', v_motivo);
  END IF;

  -- El comercio: su razón social y, si los declaró, su CUIT y condición.
  SELECT coalesce(nullif(btrim(s.business_name), ''), o.name), regexp_replace(coalesce(a.cuit, s.afip_cuit, ''), '\D', '', 'g'),
         CASE WHEN a.tipo_emisor IN ('monotributo', 'monotributista') THEN 'monotributo'
              WHEN a.tipo_emisor IN ('responsable_inscripto', 'exento') THEN a.tipo_emisor END
    INTO v_cliente, v_cuit_cliente, v_condicion
    FROM public.organizations o
    LEFT JOIN public.settings s ON s.org_id = o.id
    LEFT JOIN public.afip_credentials a ON a.org_id = o.id
   WHERE o.id = v_cobro.org_id;
  IF length(v_cuit_cliente) <> 11 OR NOT public.cuit_valido(v_cuit_cliente) OR v_condicion IS NULL THEN
    v_condicion := 'consumidor_final';
    IF length(v_cuit_cliente) <> 11 OR NOT public.cuit_valido(v_cuit_cliente) THEN v_cuit_cliente := NULL; END IF;
  END IF;
  SELECT p.name INTO v_plan FROM public.subscriptions sub JOIN public.plans p ON p.id = sub.plan_id WHERE sub.id = v_cobro.subscription_id;
  v_desde := (v_cobro.periodo_desde AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_hasta := greatest((v_cobro.periodo_hasta AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, v_desde);

  -- En nombre del dueño de la organización emisora: crear_factura_manual
  -- valida la membresía. Se restituye la sesión que había.
  SELECT owner_user_id INTO v_duenio FROM public.organizations WHERE id = v_conf.org_emisora_id;
  v_claims := current_setting('request.jwt.claims', true);
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_duenio, 'role', 'authenticated')::text, true);
    v_r := public.crear_factura_manual(
      v_conf.org_emisora_id,
      jsonb_build_object('name', left(coalesce(v_cliente, 'Comercio'), 200), 'tax_id', v_cuit_cliente,
                         'due_date', public.hoy_ar(), 'notes', 'Cobro de suscripción ' || coalesce(v_cobro.mp_payment_id, v_cobro.numero)),
      jsonb_build_array(jsonb_build_object(
        'description', 'Suscripción Nerqia' || coalesce(' — plan ' || v_plan, '') || ' — del ' || to_char(v_desde, 'DD/MM/YYYY') || ' al ' || to_char(v_hasta, 'DD/MM/YYYY'),
        'quantity', 1, 'unit_price', round(v_cobro.monto, 2), 'tax_rate', 0)),
      jsonb_build_object('enabled', true, 'receiver_condition', v_condicion, 'tax_pct', 0, 'concepto', '2',
                         'servicio_desde', v_desde, 'servicio_hasta', v_hasta));
    PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    INSERT INTO public.facturas_de_suscripcion (saas_invoice_id, org_cliente_id, org_emisora_id, estado, motivo, intentos)
    VALUES (p_saas_invoice, v_cobro.org_id, v_conf.org_emisora_id, 'error', left(SQLERRM, 500), 1)
    ON CONFLICT (saas_invoice_id) DO UPDATE
      SET estado = 'error', motivo = EXCLUDED.motivo, intentos = facturas_de_suscripcion.intentos + 1, updated_at = now();
    RETURN jsonb_build_object('ok', false, 'motivo', left(SQLERRM, 500));
  END;

  INSERT INTO public.facturas_de_suscripcion (saas_invoice_id, org_cliente_id, org_emisora_id, invoice_id, estado, motivo, intentos)
  VALUES (p_saas_invoice, v_cobro.org_id, v_conf.org_emisora_id, (v_r->>'invoice_id')::uuid, 'emitida', NULL, 1)
  ON CONFLICT (saas_invoice_id) DO UPDATE
    SET estado = 'emitida', invoice_id = EXCLUDED.invoice_id, org_emisora_id = EXCLUDED.org_emisora_id, motivo = NULL,
        intentos = facturas_de_suscripcion.intentos + 1, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'invoice_id', v_r->>'invoice_id', 'numero', v_r->>'number', 'tipo', v_r->>'tipo_comprobante');
END;
$$;
REVOKE ALL ON FUNCTION public.facturar_cobro_de_suscripcion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facturar_cobro_de_suscripcion(uuid) TO service_role;

-- Cada cobro aprobado se factura; una falla no frena el registro del pago.
CREATE OR REPLACE FUNCTION public.trg_facturar_cobro_de_suscripcion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.estado = 'paid' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'paid') THEN
    BEGIN
      PERFORM public.facturar_cobro_de_suscripcion(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'facturar_cobro_de_suscripcion(%): %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_facturar_cobro_de_suscripcion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_facturar_cobro_de_suscripcion ON public.saas_invoices;
CREATE TRIGGER trg_facturar_cobro_de_suscripcion
  AFTER INSERT OR UPDATE OF estado ON public.saas_invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_facturar_cobro_de_suscripcion();

-- Reintento diario de lo que quedó esperando emisor o con error.
CREATE OR REPLACE FUNCTION public.reintentar_facturas_de_suscripcion()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_n integer := 0;
BEGIN
  FOR v_id IN
    SELECT c.id FROM public.saas_invoices c
     WHERE c.estado = 'paid' AND coalesce(c.monto, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.facturas_de_suscripcion f WHERE f.saas_invoice_id = c.id AND f.estado = 'emitida')
       AND NOT EXISTS (SELECT 1 FROM public.facturas_de_suscripcion f WHERE f.saas_invoice_id = c.id AND f.intentos >= 10)
     ORDER BY c.created_at LIMIT 200
  LOOP
    IF (public.facturar_cobro_de_suscripcion(v_id)->>'ok')::boolean THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.reintentar_facturas_de_suscripcion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reintentar_facturas_de_suscripcion() TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reintentar-facturas-de-suscripcion';
    PERFORM cron.schedule('reintentar-facturas-de-suscripcion', '23 9 * * *', 'SELECT public.reintentar_facturas_de_suscripcion()');
  END IF;
END $cron$;

-- ───────────────────────── Plataforma ─────────────────────────
CREATE OR REPLACE FUNCTION public.platform_facturacion_de_nerqia()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conf public.platform_facturacion;
  v_ident record;
BEGIN
  IF NOT public.has_platform_role(ARRAY['superadmin', 'finance']) THEN
    RAISE EXCEPTION 'Sólo administración o finanzas de la plataforma' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_conf FROM public.platform_facturacion WHERE id;
  SELECT a.cuit, a.tipo_emisor, a.punto_venta, a.environment, o.name INTO v_ident
    FROM public.organizations o LEFT JOIN public.afip_credentials a ON a.org_id = o.id
   WHERE o.id = v_conf.org_emisora_id;
  RETURN jsonb_build_object(
    'activa', v_conf.activa,
    'cuit_esperado', v_conf.cuit_esperado,
    'org_emisora_id', v_conf.org_emisora_id,
    'org_emisora', v_ident.name,
    'emisor_cuit', v_ident.cuit,
    'emisor_tipo', v_ident.tipo_emisor,
    'punto_venta', v_ident.punto_venta,
    'ambiente', v_ident.environment,
    'resumen', (SELECT jsonb_object_agg(estado, n) FROM (SELECT estado, count(*) AS n FROM public.facturas_de_suscripcion GROUP BY estado) t),
    -- Las organizaciones que pueden emitir: las que tienen en ARCA el CUIT de Nerqia.
    'candidatas', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.name, 'tipo', a.tipo_emisor,
                     'ambiente', a.environment, 'punto_venta', a.punto_venta) ORDER BY o.name), '[]'::jsonb)
                     FROM public.afip_credentials a JOIN public.organizations o ON o.id = a.org_id
                    WHERE regexp_replace(coalesce(a.cuit, ''), '\D', '', 'g') = v_conf.cuit_esperado),
    'cobros_sin_registro', (SELECT count(*) FROM public.saas_invoices c WHERE c.estado = 'paid' AND coalesce(c.monto, 0) > 0
                             AND NOT EXISTS (SELECT 1 FROM public.facturas_de_suscripcion f WHERE f.saas_invoice_id = c.id)),
    'ultimas', (SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
      SELECT f.id, f.estado, f.motivo, f.intentos, f.created_at, f.invoice_id, c.monto, c.periodo_desde, c.periodo_hasta,
             o.name AS comercio, i.number AS numero, i.afip_status, i.cae
        FROM public.facturas_de_suscripcion f
        JOIN public.saas_invoices c ON c.id = f.saas_invoice_id
        JOIN public.organizations o ON o.id = f.org_cliente_id
        LEFT JOIN public.invoices i ON i.id = f.invoice_id
       ORDER BY f.created_at DESC LIMIT 50) x));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_facturacion_de_nerqia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_facturacion_de_nerqia() TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_configurar_facturacion(p_org_emisora uuid, p_activa boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cuit text;
  v_tipo text;
  v_esperado text;
BEGIN
  IF NOT public.has_platform_role(ARRAY['superadmin', 'finance']) THEN
    RAISE EXCEPTION 'Sólo administración o finanzas de la plataforma' USING ERRCODE = '42501';
  END IF;
  SELECT cuit_esperado INTO v_esperado FROM public.platform_facturacion WHERE id;
  IF p_org_emisora IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_emisora) THEN
      RAISE EXCEPTION 'La organización emisora no existe' USING ERRCODE = '22023';
    END IF;
    SELECT regexp_replace(coalesce(cuit, ''), '\D', '', 'g'), tipo_emisor INTO v_cuit, v_tipo
      FROM public.afip_credentials WHERE org_id = p_org_emisora;
    IF p_activa AND (v_cuit IS DISTINCT FROM v_esperado OR v_tipo NOT IN ('monotributo', 'monotributista')) THEN
      RAISE EXCEPTION 'Para activar, la organización emisora tiene que tener en ARCA el CUIT % en monotributo', v_esperado
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_activa THEN
    RAISE EXCEPTION 'Elegí la organización que emite como Nerqia' USING ERRCODE = '22023';
  END IF;
  UPDATE public.platform_facturacion
     SET org_emisora_id = p_org_emisora, activa = coalesce(p_activa, false), actualizado_por = auth.uid(), actualizado_at = now()
   WHERE id;
  INSERT INTO public.admin_audit_logs (admin_user_id, action, target_org_id, details)
  VALUES (auth.uid(), 'configurarFacturacionNerqia', p_org_emisora,
          jsonb_build_object('activa', p_activa, 'cuit_esperado', v_esperado));
  RETURN public.platform_facturacion_de_nerqia();
END;
$$;
REVOKE ALL ON FUNCTION public.platform_configurar_facturacion(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_configurar_facturacion(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_reintentar_facturas_de_suscripcion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.has_platform_role(ARRAY['superadmin', 'finance']) THEN
    RAISE EXCEPTION 'Sólo administración o finanzas de la plataforma' USING ERRCODE = '42501';
  END IF;
  v_n := public.reintentar_facturas_de_suscripcion();
  RETURN jsonb_build_object('emitidas', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_reintentar_facturas_de_suscripcion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_reintentar_facturas_de_suscripcion() TO authenticated;

COMMIT;
