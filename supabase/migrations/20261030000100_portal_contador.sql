-- Portal del contador (2026-10-30).
--
-- Un estudio contable lleva muchos clientes. Hasta hoy, cada comercio le
-- mandaba los archivos del mes a su contador, o le daba su usuario. Ahora:
--
--   1. El dueño (o un administrador) invita a su contador por email. El enlace
--      vale 14 días y sólo lo acepta quien entra con ese mismo email.
--   2. El contador NO es miembro del negocio: no entra al panel ni ve stock,
--      precios o clientes. Ve sólo lo fiscal, de sólo lectura, desde su portal.
--   3. En el portal ve a todos sus clientes de Nerqia con el estado del mes, y
--      descarga el paquete de cualquiera: lo arma con el mismo código que la
--      pantalla de ARCA del comercio (src/lib/mesFiscal.ts), con los datos que
--      devuelve `estudio_datos_mes`.
--   4. Cada lectura del contador queda en la auditoría del negocio, y el dueño
--      lo puede revocar cuando quiera.
--
-- Reversible: DROP de la tabla y de las funciones.
BEGIN;

CREATE TABLE IF NOT EXISTS public.contadores_de_negocio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invitado_por uuid NOT NULL REFERENCES auth.users(id),
  invitado_at timestamptz NOT NULL DEFAULT now(),
  expira_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  aceptado_at timestamptz,
  revocado_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS contadores_de_negocio_activo_uq
  ON public.contadores_de_negocio(org_id, email) WHERE revocado_at IS NULL;
CREATE INDEX IF NOT EXISTS contadores_de_negocio_usuario_idx
  ON public.contadores_de_negocio(user_id) WHERE revocado_at IS NULL AND user_id IS NOT NULL;
ALTER TABLE public.contadores_de_negocio ENABLE ROW LEVEL SECURITY;
-- Sin lectura directa: el token no puede salir de la base salvo al invitar.
REVOKE ALL ON public.contadores_de_negocio FROM PUBLIC, anon, authenticated;

-- ¿El usuario de la sesión es contador vigente de ese negocio?
CREATE OR REPLACE FUNCTION public.es_contador_de(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.contadores_de_negocio c
     WHERE c.org_id = p_org AND c.user_id = auth.uid()
       AND c.aceptado_at IS NOT NULL AND c.revocado_at IS NULL
  );
$fn$;
REVOKE ALL ON FUNCTION public.es_contador_de(uuid) FROM PUBLIC, anon, authenticated;

-- ── Lado del comercio ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invitar_contador(p_org uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_fila public.contadores_de_negocio;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador invita al contador' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'El email no es válido' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.contadores_de_negocio c WHERE c.org_id = p_org AND c.revocado_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'Ya hay 5 contadores con acceso: revocá alguno antes de invitar otro' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_fila FROM public.contadores_de_negocio c
   WHERE c.org_id = p_org AND c.email = v_email AND c.revocado_at IS NULL FOR UPDATE;
  IF v_fila.id IS NOT NULL AND v_fila.aceptado_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', v_fila.id, 'ya_tiene_acceso', true);
  END IF;
  IF v_fila.id IS NOT NULL THEN
    -- Reenviar: enlace nuevo y otros 14 días.
    UPDATE public.contadores_de_negocio
       SET token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
           expira_at = now() + interval '14 days', invitado_por = auth.uid(), invitado_at = now()
     WHERE id = v_fila.id
    RETURNING * INTO v_fila;
  ELSE
    INSERT INTO public.contadores_de_negocio (org_id, email, invitado_por)
    VALUES (p_org, v_email, auth.uid())
    RETURNING * INTO v_fila;
  END IF;

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), p_org, 'create', 'contador_de_negocio', v_fila.id, jsonb_build_object('email', v_email));
  RETURN jsonb_build_object('ok', true, 'id', v_fila.id, 'token', v_fila.token, 'expira_at', v_fila.expira_at);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.revocar_contador(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fila public.contadores_de_negocio;
BEGIN
  SELECT * INTO v_fila FROM public.contadores_de_negocio WHERE id = p_id FOR UPDATE;
  IF v_fila.id IS NULL THEN
    RAISE EXCEPTION 'Ese acceso no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NULL OR NOT public.has_org_role(v_fila.org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador revoca al contador' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.contadores_de_negocio SET revocado_at = COALESCE(revocado_at, now()) WHERE id = p_id;
  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), v_fila.org_id, 'delete', 'contador_de_negocio', p_id, jsonb_build_object('email', v_fila.email));
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.contadores_del_negocio(p_org uuid)
RETURNS TABLE (id uuid, email text, estado text, invitado_at timestamptz, aceptado_at timestamptz, expira_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador ve a los contadores' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT c.id, c.email,
         CASE WHEN c.aceptado_at IS NOT NULL THEN 'activo' WHEN c.expira_at < now() THEN 'vencido' ELSE 'pendiente' END,
         c.invitado_at, c.aceptado_at, c.expira_at
    FROM public.contadores_de_negocio c
   WHERE c.org_id = p_org AND c.revocado_at IS NULL
   ORDER BY c.invitado_at DESC;
END;
$fn$;

-- ── Lado del contador ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aceptar_invitacion_contador(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fila public.contadores_de_negocio;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Ingresá con tu cuenta para aceptar la invitación' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_fila FROM public.contadores_de_negocio
   WHERE token = btrim(COALESCE(p_token, '')) AND revocado_at IS NULL FOR UPDATE;
  IF v_fila.id IS NULL THEN
    RAISE EXCEPTION 'La invitación no existe o fue revocada' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_fila.aceptado_at IS NOT NULL THEN
    IF v_fila.user_id = auth.uid() THEN
      RETURN jsonb_build_object('ok', true, 'org_id', v_fila.org_id, 'ya_aceptada', true);
    END IF;
    RAISE EXCEPTION 'La invitación ya fue aceptada por otra cuenta' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_fila.expira_at < now() THEN
    RAISE EXCEPTION 'La invitación venció: pedile al negocio que te la reenvíe' USING ERRCODE = '22023';
  END IF;
  -- El enlace reenviado no sirve: tiene que entrar el contador invitado.
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  IF v_email IS DISTINCT FROM v_fila.email THEN
    RAISE EXCEPTION 'La invitación es para %: entrá con ese email', v_fila.email USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.contadores_de_negocio SET user_id = auth.uid(), aceptado_at = now() WHERE id = v_fila.id;
  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), v_fila.org_id, 'update', 'contador_de_negocio', v_fila.id, jsonb_build_object('aceptada', true));
  RETURN jsonb_build_object('ok', true, 'org_id', v_fila.org_id,
                            'negocio', (SELECT o.name FROM public.organizations o WHERE o.id = v_fila.org_id));
END;
$fn$;

-- Los clientes del contador, con el estado del mes de cada uno.
CREATE OR REPLACE FUNCTION public.estudio_clientes(p_periodo text)
RETURNS TABLE (
  org_id uuid, negocio text, razon_social text, cuit text, tipo_emisor text,
  facturas integer, total_facturado numeric, compras integer, cierres_z integer, cierres_z_borrador integer, retenciones integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_desde date;
  v_hasta date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Ingresá con tu cuenta' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'El período tiene que ser AAAA-MM' USING ERRCODE = '22023';
  END IF;
  v_desde := (p_periodo || '-01')::date;
  v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
  RETURN QUERY
  SELECT o.id, o.name, a.razon_social, a.cuit, a.tipo_emisor,
         (SELECT count(*)::integer FROM public.invoices i
           WHERE i.org_id = o.id AND i.afip_status = 'authorized' AND i.cae IS NOT NULL
             AND COALESCE(i.afip_environment, '') <> 'homologacion' AND i.issue_date::date BETWEEN v_desde AND v_hasta),
         (SELECT COALESCE(round(sum(i.total), 2), 0) FROM public.invoices i
           WHERE i.org_id = o.id AND i.afip_status = 'authorized' AND i.cae IS NOT NULL
             AND COALESCE(i.afip_environment, '') <> 'homologacion' AND i.issue_date::date BETWEEN v_desde AND v_hasta),
         (SELECT count(*)::integer FROM public.comprobantes_de_compra cc WHERE cc.org_id = o.id AND cc.periodo = p_periodo),
         (SELECT count(*)::integer FROM public.cierres_z z WHERE z.org_id = o.id AND z.origen <> 'electronico'
             AND z.estado = 'confirmado' AND z.fecha BETWEEN v_desde AND v_hasta),
         (SELECT count(*)::integer FROM public.cierres_z z WHERE z.org_id = o.id AND z.origen <> 'electronico'
             AND z.estado = 'borrador' AND z.fecha BETWEEN v_desde AND v_hasta),
         (SELECT count(*)::integer FROM public.retenciones_sufridas r WHERE r.org_id = o.id AND r.periodo = p_periodo)
    FROM public.contadores_de_negocio c
    JOIN public.organizations o ON o.id = c.org_id
    LEFT JOIN public.afip_credentials a ON a.org_id = o.id
   WHERE c.user_id = auth.uid() AND c.aceptado_at IS NOT NULL AND c.revocado_at IS NULL
   ORDER BY o.name;
END;
$fn$;

-- Todo lo que necesita src/lib/mesFiscal.ts para armar el mes de un cliente.
CREATE OR REPLACE FUNCTION public.estudio_datos_mes(p_org uuid, p_periodo text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_desde date;
  v_hasta date;
  v_cred record;
  v_tasa numeric;
BEGIN
  IF NOT public.es_contador_de(p_org) THEN
    RAISE EXCEPTION 'No tenés acceso como contador a este negocio' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'El período tiene que ser AAAA-MM' USING ERRCODE = '22023';
  END IF;
  v_desde := (p_periodo || '-01')::date;
  v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
  SELECT a.razon_social, a.cuit, a.tipo_emisor INTO v_cred FROM public.afip_credentials a WHERE a.org_id = p_org;
  SELECT COALESCE(s.tax_iva_percent, 21) INTO v_tasa FROM public.settings s WHERE s.org_id = p_org;
  v_tasa := COALESCE(v_tasa, 21);

  RETURN jsonb_build_object(
    'razon_social', v_cred.razon_social,
    'cuit', v_cred.cuit,
    'monotributo', v_cred.tipo_emisor = 'monotributo',
    'comprobantes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'number', i.number, 'issue_date', i.issue_date, 'tipo_comprobante', i.tipo_comprobante,
        'punto_venta', i.punto_venta, 'numero_afip', i.numero_afip, 'customer_tax_id', i.customer_tax_id,
        'customer_name', i.customer_name, 'subtotal', i.subtotal, 'tax_amount', i.tax_amount, 'tax_pct', i.tax_pct,
        'total', i.total, 'currency', i.currency, 'moneda_cotizacion', i.moneda_cotizacion, 'due_date', i.due_date,
        'concepto', i.concepto, 'importe_no_gravado', i.importe_no_gravado, 'importe_exento', i.importe_exento,
        'importe_tributos', i.importe_tributos, 'tributos', i.tributos,
        'invoice_items', COALESCE((SELECT jsonb_agg(jsonb_build_object('total', it.total, 'tax_rate', it.tax_rate,
                                     'tax_amount', it.tax_amount, 'tratamiento', it.tratamiento))
                                   FROM public.invoice_items it WHERE it.invoice_id = i.id), '[]'::jsonb)
      ) ORDER BY i.issue_date, i.id)
        FROM public.invoices i
       WHERE i.org_id = p_org AND i.afip_status = 'authorized' AND i.cae IS NOT NULL
         AND COALESCE(i.afip_environment, '') <> 'homologacion' AND i.issue_date::date BETWEEN v_desde AND v_hasta
    ), '[]'::jsonb),
    'homologacion', (SELECT count(*) FROM public.invoices i
       WHERE i.org_id = p_org AND i.afip_status = 'authorized' AND i.cae IS NOT NULL
         AND i.afip_environment = 'homologacion' AND i.issue_date::date BETWEEN v_desde AND v_hasta),
    'compras', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cc.id, 'fecha', cc.fecha, 'tipo_comprobante', cc.tipo_comprobante, 'punto_venta', cc.punto_venta,
        'numero', cc.numero, 'cuit_emisor', cc.cuit_emisor, 'razon_social_emisor', cc.razon_social_emisor,
        'alicuotas', cc.alicuotas, 'no_gravado', cc.no_gravado, 'exento', cc.exento, 'percepcion_iva', cc.percepcion_iva,
        'percepcion_nacionales', cc.percepcion_nacionales, 'percepcion_iibb', cc.percepcion_iibb,
        'percepcion_municipal', cc.percepcion_municipal, 'impuestos_internos', cc.impuestos_internos,
        'otros_tributos', cc.otros_tributos, 'total', cc.total
      ) ORDER BY cc.fecha, cc.id)
        FROM public.comprobantes_de_compra cc WHERE cc.org_id = p_org AND cc.periodo = p_periodo
    ), '[]'::jsonb),
    'retenciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'fecha', r.fecha, 'impuesto', r.impuesto, 'agente_cuit', r.agente_cuit,
        'agente_nombre', r.agente_nombre, 'numero_certificado', r.numero_certificado, 'jurisdiccion', r.jurisdiccion,
        'importe', r.importe) ORDER BY r.fecha)
        FROM public.retenciones_sufridas r WHERE r.org_id = p_org AND r.periodo = p_periodo
    ), '[]'::jsonb),
    'inscripciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'province', g.province, 'regime', g.regime, 'rate_pct', g.rate_pct,
        'coeficiente', g.coeficiente, 'active', g.active))
        FROM public.iibb_registrations g WHERE g.org_id = p_org
    ), '[]'::jsonb),
    'cierres', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', z.id, 'origen', z.origen, 'punto_venta', z.punto_venta, 'numero', z.numero,
        'fecha', z.fecha, 'estado', z.estado, 'equipo', z.equipo, 'comprobantes', z.comprobantes, 'total', z.total, 'iva', z.iva)
        ORDER BY z.fecha, z.numero)
        FROM public.cierres_z z WHERE z.org_id = p_org AND z.origen <> 'electronico' AND z.estado = 'confirmado'
         AND z.fecha BETWEEN v_desde AND v_hasta
    ), '[]'::jsonb),
    'borradores_z', (SELECT count(*) FROM public.cierres_z z WHERE z.org_id = p_org AND z.origen <> 'electronico'
         AND z.estado = 'borrador' AND z.fecha BETWEEN v_desde AND v_hasta),
    -- Tique-Factura A: con los renglones de su venta, la misma alícuota que se
    -- imprimió (fiscal_tax_rate, la del producto o la general) y el CUIT del cliente.
    'tiques_a', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'numero', d.numero, 'emitido', d.emitted_at, 'total', d.total,
        'lineas', COALESCE((SELECT jsonb_agg(jsonb_build_object('total', s.total_ars,
                     'tasa', COALESCE(s.fiscal_tax_rate, p.tax_rate, v_tasa)))
                   FROM public.sales s LEFT JOIN public.products p ON p.id = s.product_id
                  WHERE s.org_id = p_org AND s.sale_transaction_id = d.sale_transaction_id), '[]'::jsonb),
        'cuit', (SELECT c.tax_id FROM public.sales s JOIN public.customers c ON c.id = s.customer_id
                  WHERE s.org_id = p_org AND s.sale_transaction_id = d.sale_transaction_id LIMIT 1),
        'nombre', (SELECT COALESCE(NULLIF(c.legal_name, ''), c.name) FROM public.sales s JOIN public.customers c ON c.id = s.customer_id
                  WHERE s.org_id = p_org AND s.sale_transaction_id = d.sale_transaction_id LIMIT 1)
      ) ORDER BY d.emitted_at)
        FROM public.fiscal_controller_documents d
       WHERE d.org_id = p_org AND d.estado = 'emitido' AND d.tipo = 'A'
         AND (d.emitted_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN v_desde AND v_hasta
    ), '[]'::jsonb)
  );
END;
$fn$;

-- Cada lectura del contador queda en la auditoría del negocio. Se registra
-- aparte (la lectura es STABLE y no puede escribir).
CREATE OR REPLACE FUNCTION public.estudio_registrar_descarga(p_org uuid, p_periodo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.es_contador_de(p_org) THEN
    RAISE EXCEPTION 'No tenés acceso como contador a este negocio' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), p_org, 'export', 'paquete_contador', NULL, jsonb_build_object('periodo', left(p_periodo, 7)));
END;
$fn$;

REVOKE ALL ON FUNCTION public.invitar_contador(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invitar_contador(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.revocar_contador(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revocar_contador(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.contadores_del_negocio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contadores_del_negocio(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.aceptar_invitacion_contador(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_invitacion_contador(text) TO authenticated;
REVOKE ALL ON FUNCTION public.estudio_clientes(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estudio_clientes(text) TO authenticated;
REVOKE ALL ON FUNCTION public.estudio_datos_mes(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estudio_datos_mes(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.estudio_registrar_descarga(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estudio_registrar_descarga(uuid, text) TO authenticated;

WITH c(function_name, audience, rationale) AS (VALUES
  ('es_contador_de', 'security_helper', 'Dice si la sesión es contador vigente de un negocio; sólo la usan funciones del portal.'),
  ('invitar_contador', 'authenticated_delegate', 'Exige dueño o administrador del negocio; el enlace sólo lo acepta el email invitado.'),
  ('revocar_contador', 'authenticated_delegate', 'Exige dueño o administrador del negocio del acceso.'),
  ('contadores_del_negocio', 'authenticated_delegate', 'Exige dueño o administrador; no devuelve el token.'),
  ('aceptar_invitacion_contador', 'authenticated_delegate', 'Exige sesión con el mismo email invitado; un enlace no se transfiere.'),
  ('estudio_clientes', 'authenticated_delegate', 'Sólo los negocios donde la sesión es contador vigente; sólo conteos fiscales.'),
  ('estudio_datos_mes', 'authenticated_delegate', 'Exige ser contador vigente del negocio; sólo datos fiscales del período.'),
  ('estudio_registrar_descarga', 'authenticated_delegate', 'Exige ser contador vigente; deja la descarga en la auditoría del negocio.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
