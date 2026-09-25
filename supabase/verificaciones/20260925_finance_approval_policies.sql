-- ═══════════════════════════════════════════════════════════════════════════
-- F5.2 — Motor de política de aprobación versionada: verificación reversible.
-- Todo corre dentro de una transacción con ROLLBACK: no deja datos.
-- Escenarios: versionado, escalamiento por rol, USD a owner, presupuesto
-- comprometido del mes, sólo-owner define política y compatibilidad sin política.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $verify$
DECLARE
  v_org       uuid;
  v_org2      uuid;
  v_user      uuid;   -- owner
  v_admin     uuid;   -- admin de la org de prueba
  v_version   int;
  v_politicas int;
  v_denied    boolean;
  v_status    text;
  r_gen       uuid;   -- general 5.000 ARS -> política exige owner
  r_cat       uuid;   -- marketing 10.000 ARS -> política categoría permite admin
  r_over      uuid;   -- marketing 10.000 extra -> excede presupuesto
  r_usd       uuid;   -- 500 USD -> escalamiento a owner
  r_b1        uuid;   -- marketing 12.000 -> dentro del presupuesto
  r_b2        uuid;   -- marketing 10.000 -> dentro del presupuesto
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires existing user';

  RAISE NOTICE '═══ F5.2 política de aprobación versionada — verificación ═══';

  -- ── 0. Precondiciones ────────────────────────────────────────────────────
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'finance_set_approval_policy'
  ), 'no existe finance_set_approval_policy';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'finance_approval_policies'),
    'FALLO: no existe finance_approval_policies';
  RAISE NOTICE 'OK: RPCs y tabla presentes';

  -- ── 1. Ambiente: org efímera con owner + admin ───────────────────────────
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (gen_random_uuid(), 'ZZ Politicas verification', 'zz-pol-' || gen_random_uuid(), v_user)
  RETURNING id INTO v_org;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  SELECT m.user_id INTO v_admin
    FROM public.memberships m
   WHERE m.user_id <> v_user
     AND NOT EXISTS (SELECT 1 FROM public.memberships m2 WHERE m2.org_id = v_org AND m2.user_id = m.user_id)
   ORDER BY m.joined_at LIMIT 1;
  ASSERT v_admin IS NOT NULL, 'requires non-owner user';
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_admin, 'admin');
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ── 2. Owner define dos políticas: general (owner) y categoría marketing (admin) ──
  SELECT public.finance_set_approval_policy(v_org, NULL, NULL, 60000, 'owner') INTO v_version;
  ASSERT v_version = 1, 'la primera version deberia ser 1, es ' || v_version;
  SELECT public.finance_set_approval_policy(v_org, 'marketing', NULL, 50000, 'admin') INTO v_version;
  ASSERT v_version = 2, 'la segunda version deberia ser 2, es ' || v_version;

  -- Administrar políticas es un acto de owner: el admin no puede.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_denied := false;
  BEGIN
    PERFORM public.finance_set_approval_policy(v_org, NULL, NULL, 1000, 'admin');
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  ASSERT v_denied, 'un admin definió política de aprobación';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- Auditoría: dos políticas activas de alcance distinto.
  SELECT count(*) INTO v_politicas FROM public.finance_list_approval_policies(v_org) WHERE active;
  ASSERT v_politicas = 2, 'deberian haber 2 politicas activas, hay ' || v_politicas;
  RAISE NOTICE 'OK: política versionada y sólo el owner la define';

  -- ── 3. Solicitudes de gasto ──────────────────────────────────────────────
  SELECT public.finance_create_expense_request(v_org, 'Compra general', 5000, 'ARS', 'operativo', NULL, NULL) INTO r_gen;
  SELECT public.finance_create_expense_request(v_org, 'Publicidad 1', 12000, 'ARS', 'marketing', NULL, NULL) INTO r_b1;
  SELECT public.finance_create_expense_request(v_org, 'Publicidad 2', 10000, 'ARS', 'marketing', NULL, NULL) INTO r_b2;
  SELECT public.finance_create_expense_request(v_org, 'Contenido campaña', 10000, 'ARS', 'marketing', NULL, NULL) INTO r_cat;
  SELECT public.finance_create_expense_request(v_org, 'Contenido extra', 10000, 'ARS', 'marketing', NULL, NULL) INTO r_over;
  SELECT public.finance_create_expense_request(v_org, 'Herramienta USD', 500, 'USD', 'marketing', NULL, NULL) INTO r_usd;

  -- ── 4. Presupuesto del mes para marketing: 40.000 ARS ────────────────────
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.budget_categories(id, org_id, type, name, source_key, active)
  VALUES (gen_random_uuid(), v_org, 'expense', 'Marketing', 'marketing', true)
  ON CONFLICT (org_id, type, source_key) WHERE source_key IS NOT NULL DO NOTHING;
  INSERT INTO public.budgets(id, org_id, category_id, year, month, amount)
  SELECT gen_random_uuid(), v_org, c.id, EXTRACT(YEAR FROM now())::int, EXTRACT(MONTH FROM now())::int, 40000
  FROM public.budget_categories c
  WHERE c.org_id = v_org AND c.type = 'expense' AND c.source_key = 'marketing'
    AND NOT EXISTS (
      SELECT 1 FROM public.budgets b2
      WHERE b2.org_id = v_org AND b2.category_id = c.id
        AND b2.year = EXTRACT(YEAR FROM now())::int AND b2.month = EXTRACT(MONTH FROM now())::int
    );
  RESET ROLE;

  -- ── 5. Admin: escalamiento y presupuesto ─────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- 5a. General 5.000: la política v1 exige owner -> denegado.
  v_denied := false;
  BEGIN
    PERFORM public.finance_approve_expense_request(r_gen);
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  ASSERT v_denied, 'el admin aprobó una solicitud que la política escala a owner';
  RAISE NOTICE 'OK: escalamiento por monto (general exige owner)';

  -- 5b. Marketing 12.000: categoría permite admin y hay presupuesto -> OK.
  PERFORM public.finance_approve_expense_request(r_b1);

  -- 5c. Otro 10.000: acumulado 22k <= 40k -> OK.
  PERFORM public.finance_approve_expense_request(r_b2);

  -- 5d. Contenido campaña 10k: acumulado 32k <= 40k -> OK.
  PERFORM public.finance_approve_expense_request(r_cat);

  -- 5e. Contenido extra 10k: disponible 8k -> denegado.
  v_denied := false;
  BEGIN
    PERFORM public.finance_approve_expense_request(r_over);
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  ASSERT v_denied, 'la aprobación ignoró el presupuesto disponible de la categoría';
  RAISE NOTICE 'OK: presupuesto comprometido por categoría';

  -- 5f. USD 500: escalamiento a owner -> admin denegado.
  v_denied := false;
  BEGIN
    PERFORM public.finance_approve_expense_request(r_usd);
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  ASSERT v_denied, 'el admin aprobó una solicitud en USD';

  -- ── 6. Owner: aprueba lo escalado ────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  PERFORM public.finance_approve_expense_request(r_gen);
  PERFORM public.finance_approve_expense_request(r_usd);

  SELECT status INTO v_status FROM public.finance_expense_requests WHERE id = r_usd;
  ASSERT v_status = 'approved', 'la solicitud USD deberia estar aprobada';
  RAISE NOTICE 'OK: owner aprueba lo que la política escala';

  -- ── 7. Compatibilidad: org sin políticas sigue aprobando ─────────────────
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (gen_random_uuid(), 'ZZ Politicas sin policy', 'zz-pol2-' || gen_random_uuid(), v_user)
  RETURNING id INTO v_org2;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org2, v_user, 'owner');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  DECLARE
    v_req2 uuid;
  BEGIN
    SELECT public.finance_create_expense_request(v_org2, 'Sin política', 100000, 'ARS', NULL, NULL, NULL) INTO v_req2;
    PERFORM public.finance_approve_expense_request(v_req2);
    SELECT status INTO v_status FROM public.finance_expense_requests WHERE id = v_req2;
    ASSERT v_status = 'approved', 'sin políticas la aprobación deberia funcionar como antes';
  END;
  RAISE NOTICE 'OK: sin políticas, comportamiento previo intacto';

  RAISE NOTICE '═══ Toda la política F5.2 pasó dentro de la transacción ═══';
  RAISE EXCEPTION 'rollback_intencional';
END;
$verify$;

ROLLBACK;
SELECT 'politicas F5.2 verificadas y revertidas' AS resultado;