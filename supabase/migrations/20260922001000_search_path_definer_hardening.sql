-- ============================================================================
-- Endurecimiento de `search_path` en funciones SECURITY DEFINER.
--
-- ── El riesgo ─────────────────────────────────────────────────────────────
-- Una función SECURITY DEFINER corre con los privilegios de su dueño. Si su
-- `search_path` no está fijado, resuelve los nombres con el del llamador. Un
-- atacante que puede crear objetos en un esquema anterior en el path (por
-- ejemplo `pg_temp`) puede hacer que `SELECT 1 FROM memberships` resuelva a su
-- propia tabla y saltarse la guarda. Es el patrón de escalada clásico en
-- PostgreSQL, y aplica igual a `has_permission`, que decide permisos.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────
-- Fija `search_path = public, pg_temp` en las seis funciones que hoy no lo
-- tienen. `pg_temp` va al final a propósito: queda disponible para tablas
-- temporales legítimas, pero nunca antes de los esquemas de confianza.
-- ============================================================================

DO $block$
DECLARE
  v_name text;
  v_args text;
  v_oid oid;
  v_funciones text[] := ARRAY[
    'has_permission',
    'is_email_suppressed',
    'process_drip_unsubscribe',
    'record_debt_payment_cash_entry',
    'seed_default_alert_rules',
    'seed_demo_data'
  ];
BEGIN
  FOR v_name, v_args, v_oid IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid), p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(v_funciones)
      AND p.prosecdef
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%')
      )
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp', v_name, v_args);
  END LOOP;

  -- El ALTER cambia la definición, así que el hash del contrato queda viejo y
  -- la auditoría vuelve a marcar funciones que sólo ganaron un search_path
  -- seguro. Se refresca el hash de las contratadas, sin tocar su audiencia.
  UPDATE public.security_function_contracts c
  SET definition_hash = md5(pg_get_functiondef(p.oid)),
      reviewed_on = DATE '2026-09-22'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND c.function_name = p.proname
    AND c.identity_arguments = pg_get_function_identity_arguments(p.oid)
    AND p.proname = ANY(v_funciones);
END;
$block$;

-- ── Certificación ────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_sin_path int;
BEGIN
  SELECT count(*) INTO v_sin_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.prorettype <> 'trigger'::regtype
    AND (
      p.proconfig IS NULL
      OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%')
    );

  ASSERT v_sin_path = 0,
    format('quedan %s funciones SECURITY DEFINER sin search_path fijado', v_sin_path);
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260922001000', 'search_path_definer_hardening') ON CONFLICT DO NOTHING;
