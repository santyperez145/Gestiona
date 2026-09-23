-- ============================================================================
-- Endurecimiento de superficie: las funciones de creador dejan de ser anónimas
-- y toda función SECURITY DEFINER expuesta queda con contrato versionado.
--
-- ── El defecto medido ─────────────────────────────────────────────────────
-- `audit_funciones_expuestas` devolvía 17 filas cuando el estándar exige 0.
-- La causa raíz es silenciosa: en Supabase los *default privileges* del esquema
-- `public` conceden EXECUTE a `anon` y `authenticated` en cada función nueva.
-- `REVOKE ALL ... FROM PUBLIC` NO alcanza — hay que revocar de `anon` y
-- `authenticated` explícitamente, como ya hace 20260904000120.
--
-- Consecuencia real: `expire_influencer_invitations()` sin argumentos quedaba
-- invocable por cualquiera y expiraba todas las invitaciones del sistema;
-- `creator_linked_profiles(p_user_id)` permitía leer los perfiles ligados de
-- cualquier creador enumerando uuids.
--
-- ── Qué hace esta migración ──────────────────────────────────────────────
-- 1. Revoca `anon` de toda función de creador/negocio; `authenticated` conserva
--    su acceso en las que operan por sesión.
-- 2. `expire_influencer_invitations` pasa a ser exclusiva de `service_role`.
-- 3. `creator_linked_profiles` se ata a `auth.uid()`: el argumento ya no puede
--    apuntar a otra cuenta.
-- 4. Registra contratos versionados (con el hash vivo) para las funciones
--    legítimamente expuestas por token público o por sesión.
-- ============================================================================

-- ── 1. Revocar anon de las funciones de creador/negocio ─────────────────────
DO $block$
DECLARE
  v_name text;
  v_args text;
  v_oid oid;
  v_auth_only text[] := ARRAY[
    'creator_campaigns',
    'creator_deliverables',
    'creator_earnings',
    'creator_linked_profiles',
    'creator_upsert_own_profile',
    'creator_respond_campaign',
    'creator_submit_deliverable',
    'save_influencer_campaign',
    'transition_influencer_campaign',
    'create_influencer_invitation',
    'finance_core_snapshot'
  ];
BEGIN
  FOR v_name, v_args, v_oid IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid), p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_auth_only)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', v_name, v_args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', v_name, v_args);
  END LOOP;
END;
$block$;

-- ── 2. expire_influencer_invitations: exclusiva de service_role ─────────────
DO $block$
DECLARE
  v_name text := 'expire_influencer_invitations';
  v_args text;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid) INTO v_args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = v_name;

  IF v_args IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', v_name, v_args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', v_name, v_args);
  END IF;
END;
$block$;

-- ── 3. creator_linked_profiles atada a la sesión ────────────────────────────
-- El argumento se conserva por compatibilidad de firma, pero sólo puede valer
-- el uid de la sesión: así deja de ser un enumerador de creadores ajenos.
CREATE OR REPLACE FUNCTION public.creator_linked_profiles(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  org_name text,
  name text,
  instagram text,
  status text,
  commission_percent numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.org_id, o.name, i.name, i.instagram, i.status, i.commission_percent
  FROM public.influencers i
  LEFT JOIN public.organizations o ON o.id = i.org_id
  JOIN public.creator_accounts ca ON ca.user_id = auth.uid()
  WHERE lower(i.email) = lower(ca.email)
    AND (p_user_id IS NULL OR p_user_id = auth.uid())
  ORDER BY i.created_at DESC;
$$;

COMMENT ON FUNCTION public.creator_linked_profiles(uuid) IS
  'Perfiles de marca ligados al creador de la sesión. El argumento no puede apuntar a otra cuenta: se compara contra auth.uid() y un uid ajeno devuelve vacío.';

REVOKE ALL ON FUNCTION public.creator_linked_profiles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_linked_profiles(uuid) TO authenticated;

-- ── 4. Contratos versionados de lo legítimamente expuesto ───────────────────
-- El hash se calcula del cuerpo vivo, así que cambiar una función reabre la
-- auditoría sola. Los argumentos salen de la base, no se transcriben a mano.
WITH contracts(function_name, audience, rationale) AS (
  VALUES
    -- Token público: la posesión del token es la capacidad.
    ('respond_influencer_invitation', 'public_token', 'El creador sin cuenta responde mediante token de alta entropia de la invitacion.'),
    ('get_influencer_invitation', 'public_token', 'Expone solo el estado publico de una invitacion resuelta por token.'),
    ('get_influencer_public_profile', 'public_token', 'Perfil de creador publicado, abierto por token revocable del portal.'),
    ('get_influencer_public_reviews', 'public_token', 'Resenas publicadas de un creador, resueltas por token del portal.'),
    ('get_influencer_public_portfolio', 'public_token', 'Portafolio publicado de un creador, resuelto por token del portal.'),
    -- Sesión autenticada: el tenant y la identidad se derivan de auth.uid().
    ('creator_campaigns', 'authenticated_delegate', 'Bandeja del creador: deriva identidad por auth.uid() y email de la cuenta.'),
    ('creator_deliverables', 'authenticated_delegate', 'Entregables del creador: deriva identidad por auth.uid() y email de la cuenta.'),
    ('creator_earnings', 'authenticated_delegate', 'Ingresos del creador: deriva identidad por auth.uid() y email de la cuenta.'),
    ('creator_linked_profiles', 'authenticated_delegate', 'Perfiles ligados al creador de la sesion; el argumento se ata a auth.uid().'),
    ('creator_upsert_own_profile', 'authenticated_delegate', 'El creador solo escribe su propia fila; la identidad sale de auth.uid().'),
    ('creator_respond_campaign', 'authenticated_delegate', 'Responde una invitacion con la sesion; valida el email del creador.'),
    ('creator_submit_deliverable', 'authenticated_delegate', 'Entrega contenido con la sesion; el servidor resuelve org e influencer.'),
    ('save_influencer_campaign', 'authenticated_delegate', 'Guarda una campana bajo can_manage_influencers y control optimista.'),
    ('transition_influencer_campaign', 'authenticated_delegate', 'Cambia el estado de una campana bajo can_manage_influencers.'),
    ('create_influencer_invitation', 'authenticated_delegate', 'Crea la invitacion bajo can_manage_influencers con token del servidor.'),
    ('finance_core_snapshot', 'authenticated_delegate', 'Resumen Finance: exige product_surface_access antes de agregar datos.')
)
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT
  c.function_name,
  pg_get_function_identity_arguments(p.oid),
  c.audience,
  c.rationale,
  md5(pg_get_functiondef(p.oid)),
  DATE '2026-09-22'
FROM contracts c
JOIN pg_proc p ON p.proname = c.function_name
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

-- ── Certificación: la auditoría queda vacía ─────────────────────────────────
DO $verify$
DECLARE
  v_count integer;
  v_detail text;
BEGIN
  SELECT count(*), COALESCE(string_agg(funcion || '(' || argumentos || ')', ', '), '')
  INTO v_count, v_detail
  FROM public.audit_funciones_expuestas;
  ASSERT v_count = 0, 'funciones SECURITY DEFINER sin contrato: ' || v_detail;

  -- Nadie anónimo puede tocar invitaciones ni perfiles de creador.
  ASSERT NOT has_function_privilege('anon', 'public.expire_influencer_invitations()', 'EXECUTE'),
    'expire_influencer_invitations sigue disponible para anon';
  ASSERT NOT has_function_privilege('anon', 'public.creator_linked_profiles(uuid)', 'EXECUTE'),
    'creator_linked_profiles sigue disponible para anon';
  ASSERT NOT has_function_privilege('anon', 'public.creator_submit_deliverable(uuid, text, text, text)', 'EXECUTE'),
    'creator_submit_deliverable sigue disponible para anon';
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260922000800', 'security_hardening_creator_anon') ON CONFLICT DO NOTHING;
