-- ADR 006, acciones 4 y 5: un auditor de vistas abiertas y la vigilancia diaria.
--
-- Medido 2026-10-14: dos auditores críticos se habían corrido sin que nadie lo
-- viera. SEGURIDAD.md exige `audit_funciones_expuestas` en cero y daba 13,
-- todas funciones públicas a propósito que se agregaron sin contrato
-- (búsquedas, vitales y errores de la tienda, catálogo por id). Y
-- `rls_audit_open_policies` tenía 4 políticas abiertas contra 3 declaradas:
-- `rubro_reglas_categoria` (referencia, sin org_id) nunca se documentó. Un
-- auditor que nadie mira deja de ser una alarma.
--
-- 1. Contratos para las 13 funciones, con su público y el motivo. El hash de
--    la definición hace que el contrato caduque si la función cambia.
-- 2. `audit_vistas_abiertas`: vistas que corren como su dueño, legibles desde
--    el navegador, sin filtro por usuario y sin marca `@publica:`/`@revisada:`.
-- 3. `auditoria_de_seguridad_diaria()`, por cron a las 6:17: si un auditor
--    crítico da filas (o aparece una política abierta no declarada), lo deja
--    en `app_errores`, que se ve en Platform → Errores de la app.
-- Idempotente.
BEGIN;

-- 1. Contratos ------------------------------------------------------------
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT c.function_name, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale,
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-14'
  FROM (VALUES
    ('apply_catalog_import_chunk', 'authenticated_delegate', 'Autoriza en catalog_import_status: owner/admin del negocio de la sesión con permiso de productos.'),
    ('marcas_que_trajo_el_creador', 'authenticated_delegate', 'Deriva el creador desde auth.uid y sólo devuelve las altas que trajo ese creador.'),
    ('marca_nerqia_de_tienda', 'public_storefront', 'Por slug de tienda; devuelve sólo si la tienda muestra la marca Nerqia, sin datos del comercio.'),
    ('get_store_search_synonyms', 'public_storefront', 'Sinónimos de búsqueda de una tienda por slug; datos que la tienda ya usa en público.'),
    ('registrar_busqueda', 'public_storefront', 'Cuenta una búsqueda de la tienda por slug, con tope diario por tienda y por IP; no devuelve nada.'),
    ('registrar_busqueda_sin_resultado', 'public_storefront', 'Anota una búsqueda sin resultados por slug, con topes; no devuelve datos.'),
    ('registrar_clic_de_busqueda', 'public_storefront', 'Anota el clic en un resultado por slug, con topes; no devuelve datos.'),
    ('registrar_pedido_de_busqueda', 'public_storefront', 'Anota qué búsquedas terminaron en compra, por slug y con topes; no devuelve datos.'),
    ('pedir_aviso_de_busqueda', 'public_storefront', 'Alta de aviso por email para un término, con tope diario y por IP; no revela si el email existe.'),
    ('registrar_vitales_tienda', 'public_storefront', 'Métricas de velocidad de la tienda por slug, con topes y sin datos del visitante.'),
    ('registrar_error_app', 'public_storefront', 'Registro de errores sin datos personales, con tope por minuto y por día; no devuelve nada.'),
    ('catalogo_publico', 'public_storefront', 'Catálogo por WhatsApp de un negocio por id, con tope por IP; no permite listar negocios.'),
    ('catalogo_publico_variantes', 'public_storefront', 'Variantes de un producto que ya está en un catálogo público; nada de otros productos.')
  ) AS c(function_name, audience, rationale)
  JOIN pg_proc p ON p.proname = c.function_name
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

-- 2. Auditor de vistas abiertas --------------------------------------------
CREATE OR REPLACE VIEW public.audit_vistas_abiertas AS
SELECT c.relname AS vista,
       has_table_privilege('anon', c.oid, 'SELECT') AS lee_anon,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS lee_authenticated
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
   AND coalesce(array_to_string(c.reloptions, ','), '') NOT LIKE '%security_invoker=true%'
   AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'))
   AND pg_get_viewdef(c.oid) !~* '(auth\.uid|is_org_member|has_org_role|has_permission|is_platform_admin|has_platform_role|current_setting|user_org_ids)'
   AND coalesce(obj_description(c.oid, 'pg_class'), '') !~ '^@(publica|revisada):';
REVOKE ALL ON public.audit_vistas_abiertas FROM anon, authenticated;
GRANT SELECT ON public.audit_vistas_abiertas TO service_role;

-- 3. Vigilancia diaria -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auditoria_de_seguridad_diaria()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Políticas abiertas declaradas en SEGURIDAD.md: catálogos sin datos de negocios.
  c_abiertas_declaradas constant text[] := ARRAY['plans', 'payment_providers', 'payment_provider_fees', 'rubro_reglas_categoria'];
  v_hallazgos jsonb := '{}'::jsonb;
  v_n int;
  v_quienes text;
  v_auditor text;
  v_mensaje text;
BEGIN
  FOREACH v_auditor IN ARRAY ARRAY['audit_funciones_expuestas', 'audit_costo_expuesto',
                                   'audit_policies_sin_tenant', 'audit_rpc_sin_permiso', 'audit_vistas_abiertas']
  LOOP
    EXECUTE format('SELECT count(*), left(string_agg(t::text, '' · ''), 200) FROM public.%I t', v_auditor)
      INTO v_n, v_quienes;
    IF v_n > 0 THEN
      v_hallazgos := v_hallazgos || jsonb_build_object(v_auditor, v_n);
      v_mensaje := format('Auditoría de seguridad: %s tiene %s fila(s): %s', v_auditor, v_n, v_quienes);
      INSERT INTO public.app_errores AS e (dia, huella, origen, mensaje, ruta)
      VALUES (current_date, md5('otro|auditoria|' || v_auditor), 'otro', left(v_mensaje, 300), 'cron:auditoria-de-seguridad')
      ON CONFLICT (dia, huella) DO UPDATE
        SET mensaje = EXCLUDED.mensaje, veces = LEAST(e.veces + 1, 1000000), ultima_vez = now();
    END IF;
  END LOOP;

  SELECT count(*), string_agg(DISTINCT tablename, ', ') INTO v_n, v_quienes
    FROM public.rls_audit_open_policies WHERE NOT (tablename = ANY (c_abiertas_declaradas));
  IF v_n > 0 THEN
    v_hallazgos := v_hallazgos || jsonb_build_object('rls_audit_open_policies', v_n);
    INSERT INTO public.app_errores AS e (dia, huella, origen, mensaje, ruta)
    VALUES (current_date, md5('otro|auditoria|rls_audit_open_policies'), 'otro',
            left(format('Auditoría de seguridad: %s política(s) abierta(s) no declarada(s) en %s', v_n, v_quienes), 300),
            'cron:auditoria-de-seguridad')
    ON CONFLICT (dia, huella) DO UPDATE
      SET mensaje = EXCLUDED.mensaje, veces = LEAST(e.veces + 1, 1000000), ultima_vez = now();
  END IF;

  RETURN jsonb_build_object('revisado_at', now(), 'hallazgos', v_hallazgos);
END;
$$;
REVOKE ALL ON FUNCTION public.auditoria_de_seguridad_diaria() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('auditoria-de-seguridad-diaria')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auditoria-de-seguridad-diaria');
  PERFORM cron.schedule('auditoria-de-seguridad-diaria', '17 6 * * *', 'SELECT public.auditoria_de_seguridad_diaria()');
END $$;

COMMIT;
