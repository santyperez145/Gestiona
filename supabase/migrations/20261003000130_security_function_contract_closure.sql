-- Cierra el backlog de SECURITY DEFINER expuestas a roles web.
--
-- El registro no reemplaza la revisión: cada función de este lote fue leída
-- desde la base vinculada con su ACL y su definición efectiva. Las funciones
-- autenticadas derivan la identidad desde auth.uid(), una capacidad del
-- tenant o un helper con la misma autoridad. Las tres públicas exponen sólo
-- información de vitrina o un recurso protegido por token y rate limit.

-- El newsletter era la única escritura pública del lote sin límite propio y
-- además revelaba si un email ya estaba suscripto o dado de baja. La respuesta
-- pasa a ser indistinguible, la inserción es idempotente ante concurrencia y
-- una baja previa continúa sin reactivarse.
CREATE OR REPLACE FUNCTION public.register_store_newsletter(
  p_slug text,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_store public.ecommerce_stores%ROWTYPE;
  v_slug text := lower(btrim(COALESCE(p_slug, '')));
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_now timestamptz := now();
  v_inserted boolean := false;
  v_crm public.customers%ROWTYPE;
BEGIN
  IF length(v_slug) NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tienda_no_encontrada');
  END IF;
  IF length(v_email) NOT BETWEEN 3 AND 254
     OR v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_invalido');
  END IF;
  IF NOT public.rate_limit_publico(
    'store_newsletter', v_slug, 8, interval '15 minutes'
  ) THEN
    RAISE EXCEPTION 'newsletter_rate_limited' USING ERRCODE = '53400';
  END IF;

  SELECT * INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = v_slug
    AND is_active = true
  LIMIT 1;
  IF v_store.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tienda_no_encontrada');
  END IF;

  INSERT INTO public.store_newsletter_subscribers (org_id, store_id, email)
  VALUES (v_store.org_id, v_store.id, v_email)
  ON CONFLICT (store_id, email) DO NOTHING
  RETURNING true INTO v_inserted;

  -- No distinguir alta nueva, existente ni baja previa: el visitante no puede
  -- enumerar el estado de otra persona. Sólo una fila realmente nueva puede
  -- propagar consentimiento al CRM y nunca pisa un opt-out.
  IF NOT COALESCE(v_inserted, false) THEN
    RETURN jsonb_build_object('ok', true, 'estado', 'procesado');
  END IF;

  SELECT * INTO v_crm
  FROM public.customers
  WHERE org_id = v_store.org_id
    AND lower(btrim(COALESCE(email, ''))) = v_email
  FOR UPDATE;

  IF v_crm.id IS NOT NULL
     AND v_crm.marketing_opt_out_at IS NULL
     AND v_crm.marketing_consent_at IS NULL THEN
    UPDATE public.customers
       SET marketing_consent_at = v_now,
           marketing_consent_source = 'store_newsletter',
           updated_at = v_now
     WHERE id = v_crm.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado', 'procesado');
END;
$fn$;

REVOKE ALL ON FUNCTION public.register_store_newsletter(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_store_newsletter(text, text)
  TO anon, authenticated;

WITH contracts(function_name, identity_arguments, audience, rationale) AS (
  VALUES
    ('register_store_newsletter', 'p_slug text, p_email text', 'public_storefront',
      'Alta pública limitada e idempotente; no revela si el email existía o estaba dado de baja.'),
    ('stock_en_vitrina', 'p_slug text, p_items jsonb', 'public_storefront',
      'Disponibilidad limitada al surtido publicado, con cien líneas máximas y rate limit.'),
    ('get_influencer_contract_by_token', 'p_token text', 'public_token',
      'Lectura mínima del contrato identificado por token revocable y rate limit dedicado.'),
    ('creator_owns_influencer', 'p_influencer_id uuid', 'security_helper',
      'Helper de policies que vincula auth.uid con el email confirmado del perfil creador.'),
    ('creator_deliverable_storage_upload_allowed', 'p_path text', 'security_helper',
      'Policy de Storage exige archivo pendiente creado por el usuario y perfil creador propio.'),
    ('creator_deliverable_storage_read_allowed', 'p_path text', 'security_helper',
      'Policy de Storage exige permiso de marca o perfil creador propio para el archivo subido.'),
    ('creator_earnings', '', 'authenticated_delegate',
      'Deriva todos los perfiles desde auth.uid y agrega sólo ventas, pagos y retiros propios.'),
    ('creator_campaigns', '', 'authenticated_delegate',
      'Deriva el creador desde auth.uid y limita campañas a vínculos explícitos de ese perfil.'),
    ('creator_my_social_metric_reports', '', 'authenticated_delegate',
      'Deriva el creador desde auth.uid y devuelve únicamente reportes de sus perfiles enlazados.'),
    ('list_social_metric_reports', 'p_org_id uuid', 'authenticated_delegate',
      'La lectura requiere capacidad influencers.view sobre la misma organización solicitada.'),
    ('review_social_metric_report', 'p_report_id uuid, p_status text, p_review_notes text', 'authenticated_delegate',
      'Deriva la organización del reporte bloqueado y exige capacidad influencers.edit antes de mutar.'),
    ('submit_social_metric_report', 'p_influencer_id uuid, p_platform text, p_evidence_url text, p_period_start date, p_period_end date, p_followers numeric, p_reach numeric, p_impressions numeric, p_engagement_rate numeric, p_metric_kind text, p_notes text', 'authenticated_delegate',
      'Deriva perfil y tenant desde auth.uid, valida métricas y aplica idempotencia y rate limit.'),
    ('influencer_reputation_map', 'p_org_id uuid', 'authenticated_delegate',
      'El agregado queda limitado por capacidad influencers.view sobre la organización solicitada.'),
    ('finance_core_snapshot', 'p_org_id uuid', 'authenticated_delegate',
      'Delega acceso de tenant, producto y rol en product_surface_access antes de agregar Finance.')
)
INSERT INTO public.security_function_contracts(
  function_name,
  identity_arguments,
  audience,
  rationale,
  definition_hash,
  reviewed_on
)
SELECT
  contract.function_name,
  contract.identity_arguments,
  contract.audience,
  contract.rationale,
  md5(pg_get_functiondef(procedure.oid)),
  DATE '2026-10-03'
FROM contracts contract
JOIN pg_proc procedure
  ON procedure.proname = contract.function_name
 AND pg_get_function_identity_arguments(procedure.oid) = contract.identity_arguments
JOIN pg_namespace namespace
  ON namespace.oid = procedure.pronamespace
 AND namespace.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

DO $guard$
DECLARE
  v_missing text;
  v_exposed text;
  v_newsletter text := pg_get_functiondef(
    'public.register_store_newsletter(text,text)'::regprocedure
  );
BEGIN
  IF has_function_privilege(
    'public', 'public.register_store_newsletter(text,text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC conserva ejecución del newsletter';
  END IF;
  IF NOT has_function_privilege(
    'anon', 'public.register_store_newsletter(text,text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anon no puede usar el alta pública del newsletter';
  END IF;
  IF position('rate_limit_publico' IN v_newsletter) = 0
     OR position('ON CONFLICT (store_id, email) DO NOTHING' IN v_newsletter) = 0
     OR v_newsletter LIKE '%dado_de_baja%'
     OR v_newsletter LIKE '%ya_suscrito%' THEN
    RAISE EXCEPTION 'El newsletter no quedó limitado, idempotente y no enumerable';
  END IF;

  SELECT string_agg(contract.function_name || '(' || contract.identity_arguments || ')', ', ')
    INTO v_missing
  FROM public.security_function_contracts contract
  LEFT JOIN pg_proc procedure
    ON procedure.proname = contract.function_name
   AND pg_get_function_identity_arguments(procedure.oid) = contract.identity_arguments
  LEFT JOIN pg_namespace namespace
    ON namespace.oid = procedure.pronamespace
   AND namespace.nspname = 'public'
  WHERE contract.reviewed_on = DATE '2026-10-03'
    AND (
      procedure.oid IS NULL
      OR contract.definition_hash <> md5(pg_get_functiondef(procedure.oid))
    );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Contratos ausentes o desactualizados: %', v_missing;
  END IF;

  SELECT string_agg(funcion || '(' || argumentos || ')', ', ')
    INTO v_exposed
  FROM public.audit_funciones_expuestas;
  IF v_exposed IS NOT NULL THEN
    RAISE EXCEPTION 'Persisten funciones web sin contrato: %', v_exposed;
  END IF;
END;
$guard$;
