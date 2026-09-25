-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación reversible — F5.4 conciliación bancaria
--
-- Todo corre dentro de un BEGIN/ROLLBACK: al terminar, la base queda igual.
-- Mismo patrón que la verificación de F5.3: org efímera + sesión autenticada
-- vía request.jwt.claims. Prueba importe idempotente, match contra asiento de
-- banco, confirmación inmutable y permisos.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $verify$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_user  uuid;
  v_entry uuid;
  v_stmt  uuid;
  v_line  uuid;
  v_count int;
  v_estado text;
  v_resultado jsonb;
  v_denied boolean;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires existing user';

  RAISE NOTICE '═══ F5.4 — conciliación bancaria ═══';

  -- ── 0. Precondiciones: estructura y RPCs ────────────────────────────────
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'finance_bank_statements'),
    'FALLO: no existe finance_bank_statements';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'finance_bank_lines'),
    'FALLO: no existe finance_bank_lines';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'bank_statement_upload'), 'no existe bank_statement_upload';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'bank_lines_match'), 'no existe bank_lines_match';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'bank_line_confirm'), 'no existe bank_line_confirm';
  RAISE NOTICE 'OK: tablas y RPCs presentes';

  -- ── 1. Ambiente: org efímera con plan y dueño ───────────────────────────
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Bank reconciliation verification', 'zz-bankrec-' || v_org, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  DELETE FROM public.role_permissions WHERE org_id = v_org AND module = 'expenses';

  -- Plan mínimo: banco y su contrapartida.
  INSERT INTO public.ledger_accounts (org_id, codigo, nombre, tipo) VALUES
    (v_org, '1.1.02', 'Banco', 'activo'),
    (v_org, '4.1.01', 'Ventas', 'ingreso');

  -- ── 2. Asiento de banco: ingreso de 100.000 hace 2 días ─────────────────
  v_entry := public.ledger_asentar(
    p_org := v_org,
    p_descripcion := 'ZZ: cobranza transferencia',
    p_lineas := '[{"cuenta":"1.1.02","debe":100000},{"cuenta":"4.1.01","haber":100000}]'::jsonb,
    p_fecha := CURRENT_DATE - 2
  );
  ASSERT v_entry IS NOT NULL, 'asiento de banco no creado';
  RAISE NOTICE 'OK: asiento de banco %', v_entry;

  -- ── Sesión autenticada: el dueño ejercita las RPC reales ────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ── 3. Importar extracto con ese movimiento ─────────────────────────────
  v_stmt := public.bank_statement_upload(
    p_org := v_org,
    p_banco := 'Banco ZZ',
    p_fecha_desde := CURRENT_DATE - 5,
    p_fecha_hasta := CURRENT_DATE,
    p_lines := jsonb_build_array(
      jsonb_build_object('fecha', CURRENT_DATE - 2, 'concepto', 'TRANSFERENCIA RECIBIDA', 'monto', 100000),
      jsonb_build_object('fecha', CURRENT_DATE - 1, 'concepto', 'DEBITO SUELDOS', 'monto', -45000)
    )
  );
  ASSERT v_stmt IS NOT NULL, 'extracto no importado';

  -- Idempotencia: mismo contenido devuelve el mismo lote.
  ASSERT public.bank_statement_upload(
    p_org := v_org,
    p_banco := 'Banco ZZ',
    p_fecha_desde := CURRENT_DATE - 5,
    p_fecha_hasta := CURRENT_DATE,
    p_lines := jsonb_build_array(
      jsonb_build_object('fecha', CURRENT_DATE - 2, 'concepto', 'TRANSFERENCIA RECIBIDA', 'monto', 100000),
      jsonb_build_object('fecha', CURRENT_DATE - 1, 'concepto', 'DEBITO SUELDOS', 'monto', -45000)
    )
  ) = v_stmt, 'reimportar el mismo contenido duplico el extracto';
  RAISE NOTICE 'OK: extracto importado e idempotente';

  -- ── 4. Proponer matches ─────────────────────────────────────────────────
  v_count := public.bank_lines_match(v_stmt);
  ASSERT v_count = 1, 'se esperaba 1 match propuesto, hubo %', v_count;

  SELECT id, match_entry_id INTO v_line, v_entry
    FROM public.finance_bank_lines
   WHERE statement_id = v_stmt AND match_status = 'propuesto';
  ASSERT v_line IS NOT NULL, 'la propuesta no quedo marcada';
  ASSERT v_entry IS NOT NULL, 'la propuesta no apunta a un asiento';
  RAISE NOTICE 'OK: 1 match propuesto contra asiento %', v_entry;

  -- El egreso sin asiento queda sin match, visible para revisión.
  ASSERT EXISTS (SELECT 1 FROM public.finance_bank_lines
                 WHERE statement_id = v_stmt AND match_status = 'sin_match'),
    'el movimiento sin candidato deberia quedar sin_match';
  RAISE NOTICE 'OK: movimiento sin candidato marcado sin_match';

  -- ── 5. Confirmar: decisión con traza e inmutabilidad ────────────────────
  v_resultado := public.bank_line_confirm(v_line, true);
  ASSERT (v_resultado->>'match_status') = 'confirmado', 'la confirmacion no quedo en confirmado';

  -- Reconfirmar es un no-op honesto.
  v_resultado := public.bank_line_confirm(v_line, true);
  ASSERT (v_resultado->>'already_confirmed')::boolean, 'reconfirmar deberia devolver already_confirmed';

  SELECT status, matched_count INTO v_estado, v_count
    FROM public.finance_bank_statements WHERE id = v_stmt;
  ASSERT v_estado = 'parcial', 'extracto deberia estar parcial (estado %)', v_estado;
  ASSERT v_count = 1, 'matched_count deberia ser 1 (es %)', v_count;
  RAISE NOTICE 'OK: confirmado e inmutable; extracto parcial';

  -- ── 6. Sin permiso de edición no se confirma ────────────────────────────
  RESET ROLE;
  INSERT INTO public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (v_org, 'admin', 'expenses', true, true, false, true, true)
    ON CONFLICT (org_id, role, module) DO UPDATE SET can_edit = false;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_denied := false;
  BEGIN
    PERFORM public.bank_line_confirm(v_line, false);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'el override de sin can_edit no bloqueo la confirmacion';
  RAISE NOTICE 'OK: sin can_edit no se confirma';

  RAISE NOTICE '═══ Todo F5.4 pasó dentro de la transacción ═══';
  RAISE EXCEPTION 'rollback_intencional';
END;
$verify$;

ROLLBACK;
SELECT 'F5.4 verificado y revertido' AS resultado;
