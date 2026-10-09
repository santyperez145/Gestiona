-- Observaciones de ARCA en comprobantes autorizados. Datos ZZ; ROLLBACK.
BEGIN;
CREATE TEMP TABLE zz_obs_ctx(org_id uuid, owner_id uuid, invoice_id uuid, draft_id uuid);
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_owner uuid; v_inv uuid := gen_random_uuid(); v_draft uuid := gen_random_uuid();
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES (v_org, 'ZZ Observaciones', 'zz-obs-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  INSERT INTO public.invoices(id, org_id, number, customer_name, total, cae) VALUES
    (v_inv, v_org, 'ZZ-1', 'ZZ Cliente', 1000, '70000000000001'),
    (v_draft, v_org, 'ZZ-2', 'ZZ Cliente', 1000, NULL);
  INSERT INTO zz_obs_ctx VALUES (v_org, v_owner, v_inv, v_draft);
END;
$$;

DO $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM zz_obs_ctx;
  PERFORM public.afip_registrar_observaciones(c.invoice_id, '[{"code": 10217, "msg": "ZZ aviso"}, {"code": "x", "msg": "basura"}]'::jsonb);
  ASSERT (SELECT afip_observaciones = '[{"code": 10217, "msg": "ZZ aviso"}]'::jsonb FROM public.invoices WHERE id = c.invoice_id), 'No guardó la observación válida';
  -- Una segunda llamada no pisa lo registrado; un borrador sin CAE no recibe nada.
  PERFORM public.afip_registrar_observaciones(c.invoice_id, '[{"code": 1, "msg": "otra"}]'::jsonb);
  ASSERT (SELECT afip_observaciones->0->>'code' = '10217' FROM public.invoices WHERE id = c.invoice_id), 'Pisó observaciones previas';
  PERFORM public.afip_registrar_observaciones(c.draft_id, '[{"code": 1, "msg": "otra"}]'::jsonb);
  ASSERT (SELECT afip_observaciones IS NULL FROM public.invoices WHERE id = c.draft_id), 'Registró observaciones sin CAE';
END;
$$;

GRANT SELECT ON zz_obs_ctx TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record; v_denied boolean := false;
BEGIN
  SELECT * INTO c FROM zz_obs_ctx;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.owner_id, 'role', 'authenticated')::text, true);
  UPDATE public.invoices SET afip_observaciones = '[]'::jsonb WHERE id = c.invoice_id;
  ASSERT (SELECT jsonb_array_length(afip_observaciones) = 1 FROM public.invoices WHERE id = c.invoice_id), 'El navegador borró observaciones';
  BEGIN PERFORM public.afip_registrar_observaciones(c.draft_id, '[{"code": 1, "msg": "x"}]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Un usuario ejecutó afip_registrar_observaciones';
END;
$$;
RESET ROLE;
SELECT 'observaciones_cae OK' AS resultado;
ROLLBACK;
