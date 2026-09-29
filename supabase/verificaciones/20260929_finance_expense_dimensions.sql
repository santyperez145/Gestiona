-- Verificación reversible: gasto -> ledger -> exportación con centro de costo.
BEGIN;

DO $verify$
DECLARE
  v_org uuid := gen_random_uuid();
  v_user uuid;
  v_expense uuid;
  v_batch uuid;
  v_count integer;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships
  WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires an existing owner';

  INSERT INTO public.organizations(id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ Finance dimensions', 'zz-finance-dim-' || v_org, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  PERFORM public.ledger_plan_default(v_org);

  INSERT INTO public.expenses(
    org_id, user_id, amount_ars, category, description, cost_center,
    payment_method, date, vendor
  ) VALUES (
    v_org, v_user, 1250, 'marketing', 'ZZ gasto dimensionado',
    'Growth AR', 'transferencia', now(), 'ZZ proveedor'
  ) RETURNING id INTO v_expense;

  SELECT count(*) INTO v_count
  FROM public.ledger_lines line
  JOIN public.ledger_entries entry ON entry.id = line.entry_id
  WHERE entry.referencia_tipo = 'gasto'
    AND entry.referencia_id = v_expense
    AND line.metadata->>'centro_costo' = 'Growth AR'
    AND line.metadata->>'payment_method' = 'transferencia';
  ASSERT v_count = 2, 'las dos partidas no conservaron las dimensiones';

  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_batch := public.finance_export_create(v_org, current_date, current_date);
  SELECT count(*) INTO v_count
  FROM public.finance_export_rows
  WHERE batch_id = v_batch AND centro_costo = 'Growth AR';
  RESET ROLE;
  ASSERT v_count = 2, 'la exportación contable perdió el centro de costo';

  RAISE NOTICE 'PASS: gasto, asiento y exportación conservan centro y medio';
END
$verify$;

ROLLBACK;

SELECT count(*) AS remaining_test_organizations
FROM public.organizations WHERE name = 'ZZ Finance dimensions';
