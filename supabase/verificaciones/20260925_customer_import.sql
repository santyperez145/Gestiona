-- ============================================================================
-- Verificación reversible: importación de clientes (20260925001200).
-- Correr con `npx supabase db query --linked --file <este archivo>`.
-- Todo corre dentro de un bloque con ROLLBACK: no deja datos.
-- ============================================================================

BEGIN;
DO $verify$
DECLARE
  v_org      uuid := gen_random_uuid();
  v_user     uuid;
  v_batch    jsonb;
  v_batch_id uuid;
  v_apply    jsonb;
  v_apply2   jsonb;
  v_count    int;
  v_customer uuid;
  v_denied   boolean;
  v_tags     text[];
  v_notes    text;
  v_optout   timestamptz;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires existing user';

  RAISE NOTICE '═══ Importación de clientes C22.2 — verificación ═══';

  -- ── 0. Precondiciones ────────────────────────────────────────────────────
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'customer_import_batches'),
    'FALLO: no existe customer_import_batches';
  ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'stage_customer_import'),
    'FALLO: no existe stage_customer_import';
  ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'apply_customer_import'),
    'FALLO: no existe apply_customer_import';
  RAISE NOTICE 'OK: tablas y RPC presentes';

  -- ── 1. Ambiente: org efímera + un cliente ya cargado a mano ─────────────
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Import clientes verification', 'zz-custimp-' || v_org, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  -- Recién acá: durante el alta de la organización no hay membresía todavía, y
  -- org_entitlements() rechaza a un auth.uid() sin membresía.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- Cliente existente: matchea por email. Lo cargado a mano NO debe pisarse.
  INSERT INTO public.customers (org_id, user_id, name, email, notes, marketing_opt_out_at)
  VALUES (v_org, v_user, 'Cliente Existente', 'existente@example.invalid', 'Nota escrita a mano', now())
  RETURNING id INTO v_customer;

  -- ── 2. Staging: 4 filas — 2 nuevas, 1 que matchea, 1 inválida ────────────
  v_batch := public.stage_customer_import(
    v_org, 'clientes_shopify.csv', 'csv',
    jsonb_build_array(
      jsonb_build_object('name', 'Ana Nueva', 'email', 'ana@example.invalid', 'phone', '+54 9 11 5555-4444', 'tags', jsonb_build_array('vip')),
      jsonb_build_object('name', 'Bruno Nuevo', 'phone', '011 4444 3333'),
      jsonb_build_object('name', 'Existente Distinto', 'email', 'EXISTENTE@example.invalid', 'notes', 'intento de pisar'),
      jsonb_build_object('name', '')
    ),
    'shopify'
  );
  v_batch_id := (v_batch->>'batch_id')::uuid;
  ASSERT v_batch_id IS NOT NULL, 'no se creó el lote';
  ASSERT (v_batch->>'creates')::int = 2, 'esperaba 2 altas, obtuve ' || (v_batch->>'creates');
  ASSERT (v_batch->>'updates')::int = 1, 'esperaba 1 actualización, obtuve ' || (v_batch->>'updates');
  ASSERT (v_batch->>'invalid')::int = 1, 'esperaba 1 inválida, obtuve ' || (v_batch->>'invalid');
  RAISE NOTICE 'OK: staging clasificó 2 altas, 1 update, 1 inválida';

  -- ── 3. Idempotencia del staging: mismo payload reutiliza el lote ─────────
  ASSERT (public.stage_customer_import(
    v_org, 'clientes_shopify.csv', 'csv',
    jsonb_build_array(
      jsonb_build_object('name', 'Ana Nueva', 'email', 'ana@example.invalid', 'phone', '+54 9 11 5555-4444', 'tags', jsonb_build_array('vip')),
      jsonb_build_object('name', 'Bruno Nuevo', 'phone', '011 4444 3333'),
      jsonb_build_object('name', 'Existente Distinto', 'email', 'EXISTENTE@example.invalid', 'notes', 'intento de pisar'),
      jsonb_build_object('name', '')
    ),
    'shopify'
  )->>'batch_id')::uuid = v_batch_id, 'el mismo payload creó otro lote';
  RAISE NOTICE 'OK: staging idempotente por payload';

  -- ── 4. Sin p_skip_invalid: la aplicación se rechaza explícito ────────────
  v_denied := false;
  BEGIN
    PERFORM public.apply_customer_import(v_batch_id, false);
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  ASSERT v_denied, 'se aplicó un lote con inválidas sin confirmar';
  RAISE NOTICE 'OK: inválidas exigen confirmación';

  -- ── 5. Aplicación: 2 altas + 1 update; inválida omitida ──────────────────
  v_apply := public.apply_customer_import(v_batch_id, true);
  ASSERT (v_apply->>'created')::int = 2, 'esperaba 2 creados, obtuve ' || (v_apply->>'created');
  ASSERT (v_apply->>'updated')::int = 1, 'esperaba 1 actualizado, obtuve ' || (v_apply->>'updated');
  ASSERT (v_apply->>'skipped')::int = 1, 'esperaba 1 omitido, obtuve ' || (v_apply->>'skipped');
  ASSERT (v_apply->>'reconciled')::boolean, 'quedaron filas sin reconciliar';
  RAISE NOTICE 'OK: aplicación reconciliada (2+1+1)';

  SELECT count(*) INTO v_count FROM public.customers WHERE org_id = v_org;
  ASSERT v_count = 3, 'esperaba 3 clientes en total, hay ' || v_count;

  -- ── 6. No pisa datos manuales ni revive el opt-out ───────────────────────
  SELECT notes, marketing_opt_out_at INTO v_notes, v_optout
  FROM public.customers WHERE id = v_customer;
  ASSERT v_notes = 'Nota escrita a mano', 'la importación pisó la nota manual: ' || COALESCE(v_notes, 'NULL');
  ASSERT v_optout IS NOT NULL, 'la importación revivió un opt-out de marketing';
  RAISE NOTICE 'OK: datos a mano intactos y opt-out respetado';

  -- ── 7. Idempotencia de la aplicación: un lote cerrado no re-aplica ───────
  v_apply2 := public.apply_customer_import(v_batch_id, true);
  ASSERT (v_apply2->>'reused')::boolean, 'un lote cerrado volvió a aplicarse';
  SELECT count(*) INTO v_count FROM public.customers WHERE org_id = v_org;
  ASSERT v_count = 3, 're-aplicar duplicó clientes: ' || v_count;
  RAISE NOTICE 'OK: aplicación idempotente';

  -- ── 8. Segundo lote matchea por teléfono normalizado, no por nombre ──────
  v_batch := public.stage_customer_import(
    v_org, 'clientes_tiendanube.csv', 'csv',
    jsonb_build_array(jsonb_build_object('name', 'Bruno Renombrado', 'phone', '+54 11 4444-3333')),
    'tiendanube'
  );
  ASSERT (v_batch->>'updates')::int = 1, 'el teléfono normalizado no matcheó';
  v_apply := public.apply_customer_import((v_batch->>'batch_id')::uuid, false);
  ASSERT (v_apply->>'created')::int = 0, 'el mismo teléfono creó un cliente duplicado';
  SELECT count(*) INTO v_count FROM public.customers WHERE org_id = v_org;
  ASSERT v_count = 3, 'el match por teléfono duplicó: ' || v_count;
  RAISE NOTICE 'OK: match por email y por teléfono normalizado';

  -- ── 9. Rol: un no-owner/admin no puede preparar ni aplicar ───────────────
  IF EXISTS (SELECT 1 FROM public.memberships WHERE user_id <> v_user LIMIT 1) THEN
    DECLARE v_other uuid;
    BEGIN
      SELECT user_id INTO v_other FROM public.memberships WHERE user_id <> v_user ORDER BY joined_at LIMIT 1;
      INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_other, 'vendedor');
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other, 'role', 'authenticated')::text, true);
      v_denied := false;
      BEGIN
        PERFORM public.stage_customer_import(v_org, 'x.csv', 'csv',
          jsonb_build_array(jsonb_build_object('name', 'Intruso')), 'generic');
      EXCEPTION WHEN OTHERS THEN v_denied := true; END;
      ASSERT v_denied, 'un vendedor preparó una importación';
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
      RAISE NOTICE 'OK: owner/admin obligatorio';
    END;
  ELSE
    RAISE NOTICE 'AVISO: sin segundo usuario, test de rol de staging salteado';
  END IF;

  -- ── 10. RLS: anon no lee ni escribe lotes ────────────────────────────────
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'customer_import_rows' AND cmd = 'SELECT'
  ), 'no hay policy de lectura por membresía';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  v_denied := false;
  BEGIN
    PERFORM count(*) FROM public.customer_import_rows WHERE org_id = v_org;
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  RESET ROLE;
  ASSERT v_denied, 'anon leyó filas de importación de clientes';
  RAISE NOTICE 'OK: anon no accede al staging';

  RAISE NOTICE '═══ Importación de clientes pasó dentro de la transacción ═══';
  RAISE EXCEPTION 'rollback_intencional';
END;
$verify$;

ROLLBACK;
SELECT 'import clientes verificado y revertido' AS resultado;
