-- ============================================================================
-- Solicitud de retiro del CREADOR autenticado (paridad Go-Marz).
--
-- ── El problema ───────────────────────────────────────────────────────────
-- Existía `request_creator_withdrawal(p_token, p_amount_ars)` que sólo
-- funcionaba por token público del influencer. Un creador con cuenta propia en
-- `/portal-creador` veía su saldo disponible pero no tenía cómo solicitar el
-- cobro sin pedirle el link a la marca.
--
-- ── Qué hace ──────────────────────────────────────────────────────────────
-- 1. `creator_request_withdrawal(p_amount_ars, p_notes)` usa `auth.uid()`
--    para encontrar el perfil del creador en `influencers` mediante el email
--    de su cuenta en `creator_accounts`.
-- 2. Valida que el monto solicitado no supere el saldo disponible
--    (comisiones generadas - pagadas - retiros pendientes).
-- 3. Crea la fila en `influencer_withdrawal_requests` con el token del
--    influencer para que la marca lo vea en su panel de pagos.
-- 4. Exclusiva de usuarios con sesión (authenticated).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.creator_request_withdrawal(
  p_amount_ars numeric,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_inf record;
  v_sales numeric := 0;
  v_paid numeric := 0;
  v_pending numeric := 0;
  v_available numeric := 0;
  v_req_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  IF p_amount_ars IS NULL OR p_amount_ars <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero' USING ERRCODE = '22023';
  END IF;

  -- Resolver email de la cuenta creadora
  SELECT email INTO v_email
  FROM public.creator_accounts
  WHERE user_id = v_user_id;

  IF v_email IS NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  END IF;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Perfil de creador no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Encontrar el influencer asociado (usar el primero activo si colabora con varias marcas)
  SELECT i.* INTO v_inf
  FROM public.influencers i
  WHERE lower(i.email) = lower(v_email)
  ORDER BY i.created_at DESC
  LIMIT 1;

  IF v_inf.id IS NULL THEN
    RAISE EXCEPTION 'No estás registrado como creador en ninguna marca todavía'
      USING ERRCODE = 'P0002';
  END IF;

  -- Calcular comisiones reales
  SELECT COALESCE(SUM(s.commission_ars), 0) INTO v_sales
  FROM public.influencer_sales s
  WHERE s.influencer_id = v_inf.id;

  SELECT COALESCE(SUM(p.amount_ars), 0) INTO v_paid
  FROM public.influencer_payouts p
  WHERE p.influencer_id = v_inf.id;

  SELECT COALESCE(SUM(w.amount_ars), 0) INTO v_pending
  FROM public.influencer_withdrawal_requests w
  WHERE w.influencer_id = v_inf.id AND w.status IN ('pending', 'approved');

  v_available := GREATEST(v_sales - v_paid - v_pending, 0);

  IF p_amount_ars > v_available THEN
    RAISE EXCEPTION 'El monto solicitado ($%) supera tu saldo disponible ($%)',
      round(p_amount_ars, 2), round(v_available, 2)
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.influencer_withdrawal_requests (
    org_id,
    influencer_id,
    token,
    amount_ars,
    status,
    notes
  ) VALUES (
    v_inf.org_id,
    v_inf.id,
    COALESCE(v_inf.referral_code, v_inf.id::text),
    p_amount_ars,
    'pending',
    NULLIF(btrim(COALESCE(p_notes, '')), '')
  ) RETURNING id INTO v_req_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_req_id,
    'amount_ars', p_amount_ars,
    'status', 'pending',
    'available_after_ars', v_available - p_amount_ars
  );
END;
$$;

REVOKE ALL ON FUNCTION public.creator_request_withdrawal(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_request_withdrawal(numeric, text) TO authenticated;

-- Contrato versionado en seguridad
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale,
  definition_hash, reviewed_on
)
SELECT
  'creator_request_withdrawal', 'p_amount_ars numeric, p_notes text', 'authenticated_delegate',
  'Permite al creador autenticado solicitar retiro de comisiones disponibles.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-24'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'creator_request_withdrawal'
  AND pg_get_function_identity_arguments(procedure.oid) = 'p_amount_ars numeric, p_notes text'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260924000200', 'creator_authenticated_withdrawal')
ON CONFLICT DO NOTHING;
