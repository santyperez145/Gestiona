-- ============================================================================
-- F3 — Notificaciones server-side del ciclo de solicitudes de gasto.
--
-- Antes: el aprobador se enteraba de una nueva solicitud sólo si abría la
-- página. La marca no avisaba al solicitante que su gasto fue aprobado o
-- rechazado. Ahora los RPCs de autoridad escriben en `notifications` —la
-- misma tabla que ya alimenta la campana con realtime—, dentro de la misma
-- transacción que la decisión. Si la decisión falla, no hay notificación
-- huérfana; si la notificación falla, la decisión no se pierde.
--
-- A quién: owner/admin de la organización (los que pueden aprobar). Al
-- solicitante le llega el resultado. El usuario que decide no se notifica a
-- sí mismo.
-- ============================================================================

-- Helper: notificar a los aprobadores de la organización (owner/admin).
-- SECURITY DEFINER: la tabla notifications tiene RLS por user_id y quien
-- solicita un gasto no puede escribir filas ajenas — el servidor sí.
CREATE OR REPLACE FUNCTION public.finance_notify_approvers(
  p_org_id uuid,
  p_title text,
  p_message text,
  p_request_id uuid,
  p_exclude_user uuid
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guardia: sólo se notifica dentro de una org de la que el llamador sea
  -- miembro. Sin esto, cualquiera autenticado podría generar notificaciones
  -- a los aprobadores de otra organización.
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
  SELECT m.user_id, p_title, p_message, 'sistema', 'finance_expense_request', p_request_id::text
  FROM public.memberships m
  WHERE m.org_id = p_org_id
    AND m.role IN ('owner', 'admin')
    AND (p_exclude_user IS NULL OR m.user_id <> p_exclude_user);
END;
$$;

REVOKE ALL ON FUNCTION public.finance_notify_approvers(uuid, text, text, uuid, uuid) FROM PUBLIC;

-- ── Crear solicitud: avisa a los aprobadores ───────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_create_expense_request(
  p_org_id UUID,
  p_title TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_category TEXT DEFAULT NULL,
  p_cost_center TEXT DEFAULT NULL,
  p_motive TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenes sesion activa'
      USING ERRCODE = 'invalid_text_representation';
  END IF;

  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero'
      USING ERRCODE = 'check_violation';
  END IF;

  v_id := gen_random_uuid();

  INSERT INTO public.finance_expense_requests (
    id, org_id, user_id, title, amount, currency, category, cost_center, motive, status, created_at, updated_at
  ) VALUES (
    v_id, p_org_id, auth.uid(), p_title, p_amount, COALESCE(p_currency, 'ARS'), p_category, p_cost_center, p_motive, 'pending', now(), now()
  );

  -- La campana de los aprobadores: sin esto la solicitud muere en la bandeja.
  BEGIN
    PERFORM public.finance_notify_approvers(
      p_org_id,
      'Nueva solicitud de gasto',
      p_title || ' — esperando tu aprobación',
      v_id,
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    -- La notificación no puede bloquear la solicitud: se registra y sigue.
    RAISE WARNING 'No se pudo notificar la solicitud %: %', v_id, SQLERRM;
  END;

  RETURN v_id;
END;
$function$;

-- Alias de compatibilidad
CREATE OR REPLACE FUNCTION public.finance_submit_expense_request(
  p_org_id UUID,
  p_title TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_category TEXT DEFAULT NULL,
  p_cost_center TEXT DEFAULT NULL,
  p_motive TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN public.finance_create_expense_request(p_org_id, p_title, p_amount, p_currency, p_category, p_cost_center, p_motive);
END;
$function$;

-- ── Aprobar: le avisa al solicitante ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_approve_expense_request(
  p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_req public.finance_expense_requests;
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenes sesion activa'
      USING ERRCODE = 'invalid_text_representation';
  END IF;

  SELECT * INTO v_req
  FROM public.finance_expense_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = v_req.org_id AND membership.user_id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    IF NOT public.has_permission(v_req.org_id, 'expenses', 'edit') THEN
      RAISE EXCEPTION 'No tenes permisos para aprobar solicitudes en esta organizacion'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF v_req.status <> 'pending' AND v_req.status <> 'under_review' THEN
    RAISE EXCEPTION 'Solo se pueden aprobar solicitudes pendientes'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.finance_expense_requests
  SET status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  IF v_req.user_id IS NOT NULL AND v_req.user_id <> auth.uid() THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
      VALUES (
        v_req.user_id,
        'Solicitud aprobada',
        v_req.title || ' — el presupuesto quedó comprometido',
        'sistema', 'finance_expense_request', p_request_id::text
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo notificar la aprobación de %: %', p_request_id, SQLERRM;
    END;
  END IF;
END;
$function$;

-- ── Rechazar: le avisa al solicitante con el motivo ────────────────────────
CREATE OR REPLACE FUNCTION public.finance_reject_expense_request(
  p_request_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_req public.finance_expense_requests;
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenes sesion activa'
      USING ERRCODE = 'invalid_text_representation';
  END IF;

  SELECT * INTO v_req
  FROM public.finance_expense_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = v_req.org_id AND membership.user_id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    IF NOT public.has_permission(v_req.org_id, 'expenses', 'edit') THEN
      RAISE EXCEPTION 'No tenes permisos para rechazar solicitudes en esta organizacion'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF v_req.status <> 'pending' AND v_req.status <> 'under_review' THEN
    RAISE EXCEPTION 'Solo se pueden rechazar solicitudes pendientes'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.finance_expense_requests
  SET status = 'rejected',
      rejection_reason = p_reason,
      updated_at = now()
  WHERE id = p_request_id;

  IF v_req.user_id IS NOT NULL AND v_req.user_id <> auth.uid() THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
      VALUES (
        v_req.user_id,
        'Solicitud rechazada',
        v_req.title || COALESCE(' — ' || left(p_reason, 300), ''),
        'sistema', 'finance_expense_request', p_request_id::text
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo notificar el rechazo de %: %', p_request_id, SQLERRM;
    END;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.finance_create_expense_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_submit_expense_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_approve_expense_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_reject_expense_request TO authenticated;

-- ── Certificación ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'finance_notify_approvers') THEN
    RAISE EXCEPTION 'finance_notify_approvers no existe';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260922000700', 'expense_request_notifications') ON CONFLICT DO NOTHING;