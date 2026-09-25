-- ============================================================================
-- Cierre de ciclo de solicitud de gasto: "pagar" asienta el gasto real.
--
-- ── El defecto (paridad Mendel: el circuito completo) ─────────────────────
-- `finance_approve_expense_request` marcaba 'approved' y notificaba, pero el
-- dinero nunca entraba al registro contable: no había forma de pasar la
-- solicitud aprobada a un gasto real en `expenses`. La bandeja quedaba con
-- aprobaciones eternas y el P&L mentía (presupuesto comprometido sin gasto).
--
-- ── Qué hace `finance_mark_expense_paid` ──────────────────────────────────
-- 1. Sólo owner/admin (o permiso expenses:edit): autoridad en servidor.
-- 2. Exige status 'approved': una pendiente no se paga, se aprueba antes.
-- 3. Idempotencia: si ya existe el gasto ligado (notes 'expense_request:<id>')
--    no duplica; reintentos no generan doble gasto en el P&L.
-- 4. Asienta en `expenses` con categoría/cost_center/motivo de la solicitud y
--    fecha de hoy; marca la solicitud 'paid' y guarda quién la pagó.
-- ============================================================================

-- Estado 'paid' en el CHECK (la columna se creó con CHECK si existe constraint).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.finance_expense_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
      AND pg_get_constraintdef(oid) NOT LIKE '%paid%'
  ) THEN
    -- No hay forma segura de adivinar el nombre; si el CHECK no permite 'paid',
    -- lo reemplazamos: buscamos constraints CHECK sobre status y las dropeamos
    -- para crear una nueva con el ciclo completo.
    RAISE NOTICE 'Revisando constraints CHECK de status';
  END IF;
END $$;

DO $$
DECLARE
  v_constraint text;
BEGIN
  FOR v_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.finance_expense_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.finance_expense_requests DROP CONSTRAINT %I', v_constraint);
  END LOOP;
END $$;

ALTER TABLE public.finance_expense_requests
  ADD CONSTRAINT finance_expense_requests_status_check
  CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'paid'));

CREATE OR REPLACE FUNCTION public.finance_mark_expense_paid(
  p_request_id uuid,
  p_payment_method text DEFAULT 'transferencia'
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req public.finance_expense_requests;
  v_role text;
  v_expense_id uuid;
  v_exists boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenes sesion activa' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req
  FROM public.finance_expense_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = v_req.org_id AND membership.user_id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    IF NOT public.has_permission(v_req.org_id, 'expenses', 'edit') THEN
      RAISE EXCEPTION 'No tenes permisos para registrar pagos en esta organizacion'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'Solo se pueden pagar solicitudes aprobadas (estado actual: %)', v_req.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotencia por solicitud: reintento no duplica el gasto. El vínculo se
  -- busca por descripción exacta (title — motive) + monto + hoy: expenses no
  -- tiene columna de origen, así que usamos vendor como marcador de trazabilidad.
  SELECT EXISTS (
    SELECT 1 FROM public.expenses
    WHERE org_id = v_req.org_id
      AND vendor = 'expense_request:' || v_req.id::text
  ) INTO v_exists;

  IF v_exists THEN
    -- Sincronizar el estado de la solicitud y terminar.
    UPDATE public.finance_expense_requests
    SET status = 'paid', updated_at = now()
    WHERE id = v_req.id;
    RETURN NULL;
  END IF;

  INSERT INTO public.expenses (
    org_id, user_id, description, amount_ars, category, date, vendor
  ) VALUES (
    v_req.org_id,
    auth.uid(),
    v_req.title || CASE WHEN v_req.motive IS NOT NULL THEN ' — ' || v_req.motive ELSE '' END,
    v_req.amount,
    COALESCE(v_req.category, 'otros'),
    COALESCE(v_req.cost_center, 'Finance'),
    CURRENT_DATE,
    'expense_request:' || v_req.id::text
  )
  RETURNING id INTO v_expense_id;

  UPDATE public.finance_expense_requests
  SET status = 'paid', updated_at = now()
  WHERE id = v_req.id;

  IF v_req.user_id IS NOT NULL AND v_req.user_id <> auth.uid() THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
      VALUES (
        v_req.user_id,
        'Pago registrado',
        v_req.title || ' — el pago quedó registrado como gasto',
        'sistema', 'finance_expense_request', v_req.id::text
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo notificar el pago de %: %', v_req.id, SQLERRM;
    END;
  END IF;

  RETURN v_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_mark_expense_paid(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_mark_expense_paid(uuid, text) TO authenticated;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT
  'finance_mark_expense_paid', 'p_request_id uuid, p_payment_method text', 'authenticated_delegate',
  'Registra el pago de una solicitud aprobada como gasto real, idempotente.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-24'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'finance_mark_expense_paid'
  AND pg_get_function_identity_arguments(procedure.oid) = 'p_request_id uuid, p_payment_method text'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260924000600', 'finance_mark_expense_paid')
ON CONFLICT DO NOTHING;