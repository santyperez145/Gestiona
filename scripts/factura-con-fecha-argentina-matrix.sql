-- Simulacro de 20261030001600 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Con la sesión en un huso donde hoy no es el día argentino (se elige el
--      que difiere a la hora en que corra), una factura nueva sale con la
--      fecha de Argentina, por el alta real y por un insert directo; el
--      vencimiento que era «hoy» también.
--   2. Una fecha elegida a propósito no se toca.
--   3. Con la sesión en hora argentina no cambia nada.
--   4. hoy_ar() la pueden usar todos; el disparador corre antes de insertar.
DO $$
DECLARE
  v_owner uuid; v_org uuid; v_f uuid; v_g uuid; v_ok text := ''; v_tz text;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Fecha AR', 'zz-fecha-ar-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio, ingresos_brutos, inicio_actividades)
  VALUES (v_org, '20123456786', 3, 'produccion', 'responsable_inscripto', 'ZZ SRL', 'Av. ZZ 123, CABA', '901-123456-7', DATE '2020-01-01')
  ON CONFLICT (org_id) DO UPDATE SET environment = 'produccion', punto_venta = 3, domicilio = 'Av. ZZ 123, CABA',
    ingresos_brutos = '901-123456-7', inicio_actividades = DATE '2020-01-01';

  -- 1: UTC+14 va 17 h adelante de Argentina (otro día desde las 7 h) y UTC-12
  --    va 9 h atrás (otro día antes de las 9 h): a cualquier hora, uno de los
  --    dos difiere.
  v_tz := CASE WHEN (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::time >= TIME '08:00'
               THEN 'Etc/GMT-14' ELSE 'Etc/GMT+12' END;
  PERFORM set_config('timezone', v_tz, true);
  IF CURRENT_DATE = public.hoy_ar() THEN
    RAISE EXCEPTION 'FALLA 1a: con % hoy sigue siendo el día argentino', v_tz;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_f := (public.crear_factura_manual(v_org, jsonb_build_object('name', 'ZZ CF'),
    jsonb_build_array(jsonb_build_object('description', 'ZZ', 'quantity', 1, 'unit_price', 100, 'tax_rate', 21)),
    jsonb_build_object('enabled', true, 'receiver_condition', 'consumidor_final'))->>'invoice_id')::uuid;
  RESET ROLE;
  IF (SELECT issue_date FROM public.invoices WHERE id = v_f) <> public.hoy_ar() THEN
    RAISE EXCEPTION 'FALLA 1b: el alta fechó % y hoy en Argentina es %',
      (SELECT issue_date FROM public.invoices WHERE id = v_f), public.hoy_ar();
  END IF;
  INSERT INTO public.invoices (org_id, number, customer_name, issue_date, due_date, status, subtotal, tax_pct, tax_amount, total)
  VALUES (v_org, 'ZZ-FECHA-1', 'ZZ CF', CURRENT_DATE, CURRENT_DATE, 'draft', 100, 21, 21, 121) RETURNING id INTO v_g;
  IF (SELECT issue_date FROM public.invoices WHERE id = v_g) <> public.hoy_ar()
     OR (SELECT due_date FROM public.invoices WHERE id = v_g) <> public.hoy_ar() THEN
    RAISE EXCEPTION 'FALLA 1c: el insert directo quedó en % / %',
      (SELECT issue_date FROM public.invoices WHERE id = v_g), (SELECT due_date FROM public.invoices WHERE id = v_g);
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  INSERT INTO public.invoices (org_id, number, customer_name, issue_date, due_date, status, subtotal, tax_pct, tax_amount, total)
  VALUES (v_org, 'ZZ-FECHA-2', 'ZZ CF', public.hoy_ar() - 2, public.hoy_ar() + 30, 'draft', 100, 21, 21, 121) RETURNING id INTO v_g;
  IF (SELECT issue_date FROM public.invoices WHERE id = v_g) <> public.hoy_ar() - 2
     OR (SELECT due_date FROM public.invoices WHERE id = v_g) <> public.hoy_ar() + 30 THEN
    RAISE EXCEPTION 'FALLA 2: tocó una fecha elegida';
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  PERFORM set_config('timezone', 'America/Argentina/Buenos_Aires', true);
  INSERT INTO public.invoices (org_id, number, customer_name, issue_date, status, subtotal, tax_pct, tax_amount, total)
  VALUES (v_org, 'ZZ-FECHA-3', 'ZZ CF', CURRENT_DATE, 'draft', 100, 21, 21, 121) RETURNING id INTO v_g;
  IF (SELECT issue_date FROM public.invoices WHERE id = v_g) <> public.hoy_ar() THEN
    RAISE EXCEPTION 'FALLA 3: en hora argentina cambió la fecha';
  END IF;
  v_ok := v_ok || '3 ';

  -- 4
  IF NOT has_function_privilege('anon', 'public.hoy_ar()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.hoy_ar()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLA 4a: hoy_ar() no está disponible para todos';
  END IF;
  IF (SELECT tgtype & 2 FROM pg_trigger WHERE tgname = 'trg_dia_argentino_de_factura' AND tgrelid = 'public.invoices'::regclass) <> 2 THEN
    RAISE EXCEPTION 'FALLA 4b: el disparador no corre antes de insertar';
  END IF;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
