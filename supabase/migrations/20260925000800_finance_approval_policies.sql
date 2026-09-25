-- F5.2: motor de política de aprobación versionada con escalamiento por monto.
-- Idempotente: funciona en base limpia (crea tabla + RLS) y re-corrida (refresca
-- funciones y políticas). Cada org define versiones (v1, v2, ...) por categoría
-- /centro de costo con tope ARS y rol mínimo que aprueba. La RPC de aprobación
-- aplica la versión más específica que cubra el monto; si el aprobador no
-- alcanza el rol, se bloquea (escalamiento a owner). Las solicitudes en USD
-- exigen owner: la política se expresa en ARS y el servidor no tiene tipo de
-- cambio. Si la categoría tiene presupuesto del mes, la aprobación verifica
-- saldo disponible: comprometido = aprobadas/pagadas del mes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.finance_approval_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version INT NOT NULL,
  category TEXT,
  cost_center TEXT,
  max_amount_ars NUMERIC(15, 2) NOT NULL CHECK (max_amount_ars > 0),
  approver_role TEXT NOT NULL CHECK (approver_role IN ('admin', 'owner')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_approval_policies_org_version_unique UNIQUE (org_id, version)
);

CREATE INDEX IF NOT EXISTS idx_finance_approval_policies_active
  ON public.finance_approval_policies(org_id, active, category, cost_center);

ALTER TABLE public.finance_approval_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_approval_policies_read ON public.finance_approval_policies;
CREATE POLICY finance_approval_policies_read
  ON public.finance_approval_policies
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.finance_approval_policies FROM anon, authenticated;

-- Crea una nueva versión de política (la más específica gana al aprobar).
-- Sólo el owner define políticas: es una regla de plata, no de operación.
CREATE OR REPLACE FUNCTION public.finance_set_approval_policy(
  p_org_id UUID,
  p_category TEXT,
  p_cost_center TEXT,
  p_max_amount_ars NUMERIC,
  p_approver_role TEXT
)
RETURNS INT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_next_version INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenés sesión activa' USING ERRCODE = 'invalid_text_representation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.org_id = p_org_id AND m.user_id = auth.uid() AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Sólo el owner define la política versionada'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_max_amount_ars IS NULL OR p_max_amount_ars <= 0 THEN
    RAISE EXCEPTION 'El tope debe ser mayor a cero' USING ERRCODE = 'check_violation';
  END IF;

  IF p_approver_role NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'El rol aprobador debe ser admin u owner' USING ERRCODE = 'check_violation';
  END IF;

  -- Desactiva las versiones anteriores del mismo alcance (categoría + centro).
  UPDATE public.finance_approval_policies
  SET active = false
  WHERE org_id = p_org_id
    AND active
    AND category IS NOT DISTINCT FROM NULLIF(p_category, '')
    AND cost_center IS NOT DISTINCT FROM NULLIF(p_cost_center, '');

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
  FROM public.finance_approval_policies WHERE org_id = p_org_id;

  INSERT INTO public.finance_approval_policies (
    org_id, version, category, cost_center, max_amount_ars, approver_role, active, created_by
  ) VALUES (
    p_org_id, v_next_version, NULLIF(p_category, ''), NULLIF(p_cost_center, ''),
    p_max_amount_ars, p_approver_role, true, auth.uid()
  );

  RETURN v_next_version;
END;
$function$;

-- Lista la política vigente y la historia para auditoría.
CREATE OR REPLACE FUNCTION public.finance_list_approval_policies(
  p_org_id UUID
)
RETURNS TABLE (
  id UUID,
  version INT,
  category TEXT,
  cost_center TEXT,
  max_amount_ars NUMERIC,
  approver_role TEXT,
  active BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT f.id, f.version, f.category, f.cost_center, f.max_amount_ars, f.approver_role, f.active, f.created_at
  FROM public.finance_approval_policies f
  WHERE f.org_id = p_org_id
    AND public.is_org_member(f.org_id, auth.uid())
  ORDER BY f.active DESC, f.version DESC;
$function$;

-- Aprobación con política: resuelve la versión activa más específica que cubre
-- el monto, exige el rol definido y verifica presupuesto disponible del mes.
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
  v_role_rank int;
  v_required_rank int;
  v_policy record;
  v_budget_row record;
  v_committed numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenés sesión activa'
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

  IF v_req.status <> 'pending' AND v_req.status <> 'under_review' THEN
    RAISE EXCEPTION 'Solo se pueden aprobar solicitudes pendientes'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = v_req.org_id AND membership.user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'No perteneces a esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_role_rank := CASE v_role
    WHEN 'owner' THEN 3
    WHEN 'admin' THEN 2
    WHEN 'vendedor' THEN 1
    ELSE 0
  END;

  IF v_role NOT IN ('owner', 'admin')
    AND NOT public.has_permission(v_req.org_id, 'expenses', 'edit') THEN
    RAISE EXCEPTION 'No tenés permisos para aprobar solicitudes en esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Política vigente más específica que cubra el monto: gana la de categoría
  -- concreta sobre la general y, a igualdad, la versión más alta.
  SELECT * INTO v_policy
  FROM public.finance_approval_policies f
  WHERE f.org_id = v_req.org_id
    AND f.active
    AND f.max_amount_ars >= v_req.amount
    AND (f.category IS NULL OR f.category = v_req.category)
    AND (f.cost_center IS NULL OR f.cost_center = v_req.cost_center)
  ORDER BY (f.category IS NOT NULL) DESC, (f.cost_center IS NOT NULL) DESC, f.version DESC
  LIMIT 1;

  -- FOUND, no "IS NOT NULL": para RECORD, PostgreSQL evalúa campo por campo y
  -- una política general (category/cost_center NULL) daría falso negativo.
  IF FOUND THEN
    IF v_req.currency = 'USD' THEN
      v_required_rank := 3;
    ELSE
      v_required_rank := CASE v_policy.approver_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 ELSE 0 END;
    END IF;

    IF v_role_rank < v_required_rank THEN
      RAISE EXCEPTION 'La política v% exige aprobación de % para montos hasta % ARS',
        v_policy.version, v_policy.approver_role, v_policy.max_amount_ars
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Presupuesto del mes para la categoría: la aprobación compromete saldo real.
  SELECT b.amount INTO v_budget_row
  FROM public.budget_categories c
  JOIN public.budgets b
    ON b.org_id = c.org_id AND b.category_id = c.id
   AND b.year = EXTRACT(YEAR FROM now())::int
   AND b.month = EXTRACT(MONTH FROM now())::int
  WHERE c.org_id = v_req.org_id
    AND c.type = 'expense'
    AND c.active
    AND c.source_key IS NOT NULL
    AND lower(c.source_key) = lower(trim(coalesce(v_req.category, '')))
  LIMIT 1;

  IF FOUND THEN
    SELECT COALESCE(SUM(r.amount), 0) INTO v_committed
    FROM public.finance_expense_requests r
    WHERE r.org_id = v_req.org_id
      AND r.id <> v_req.id
      AND r.status IN ('approved', 'paid')
      AND lower(trim(coalesce(r.category, ''))) = lower(trim(coalesce(v_req.category, '')))
      AND date_trunc('month', coalesce(r.approved_at, r.created_at))
          = date_trunc('month', now());

    IF v_req.amount > (v_budget_row.amount - v_committed) THEN
      RAISE EXCEPTION 'Supera el presupuesto disponible de la categoría: comprometido % de % ARS',
        v_committed, v_budget_row.amount
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.finance_expense_requests
  SET status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  WHERE id = p_request_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.finance_set_approval_policy TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_list_approval_policies TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_approve_expense_request TO authenticated;

COMMIT;