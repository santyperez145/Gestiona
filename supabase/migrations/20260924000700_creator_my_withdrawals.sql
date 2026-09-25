-- ============================================================================
-- Historial de retiros del creador autenticado (paridad Go-Marz).
--
-- El creador pedía el retiro desde su portal pero no podía ver qué pasó
-- después: el estado (en revisión/aprobado/pagado/rechazado) y las fechas
-- quedaban sólo del lado de la marca. Esta RPC le devuelve sus solicitudes,
-- ligadas por email a sus perfiles en influencers (mismas reglas que
-- creator_campaigns / creator_earnings).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.creator_my_withdrawals()
RETURNS TABLE (
  id uuid,
  amount_ars numeric,
  status text,
  created_at timestamptz,
  processed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT w.id, w.amount_ars, w.status, w.created_at, w.processed_at
  FROM public.influencer_withdrawal_requests w
  JOIN public.influencers i ON i.id = w.influencer_id
  JOIN public.creator_accounts ca ON ca.user_id = auth.uid()
  WHERE lower(i.email) = lower(ca.email)
  ORDER BY w.created_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.creator_my_withdrawals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_my_withdrawals() TO authenticated;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT
  'creator_my_withdrawals', '', 'authenticated_delegate',
  'Historial de retiros del creador autenticado, ligado por email a sus perfiles.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-24'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'creator_my_withdrawals'
  AND pg_get_function_identity_arguments(procedure.oid) = ''
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260924000700', 'creator_my_withdrawals')
ON CONFLICT DO NOTHING;