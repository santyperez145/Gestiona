-- ═══════════════════════════════════════════════════════════════════════════
-- El gross profit lo tiene que poder leer el admin de plataforma
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `20260826000090` creó las vistas de gross profit por pago y terminó con
-- `REVOKE ALL ... FROM anon, authenticated`. La intención era cerrarle la puerta
-- a un comprador y a un comercio; el efecto fue cerrársela **también al staff**,
-- que es exactamente para quien se construyeron.
--
-- ⚠️ Un admin de plataforma no tiene un rol de Postgres propio: entra como
-- `authenticated`, igual que cualquier usuario. Lo que lo distingue es su fila
-- en `platform_admins`, y eso lo evalúa la cláusula `WHERE
-- is_platform_admin(auth.uid())` de la propia vista. Revocarle el SELECT al rol
-- `authenticated` no lo protege de nadie: lo deja sin la vista.
--
-- Se encontró al verificarlo como el rol real, no leyendo el código:
--
--     ERROR: 42501: permission denied for view platform_gross_profit_por_pago
--
-- ── El patrón que ya usaban las otras 16 ──────────────────────────────────
--
-- Medido el 2026-08-26 sobre las vistas `platform_*`: `platform_org_health`,
-- `platform_cron_health`, `platform_org_activation`, `platform_operations_queue`
-- y doce más están en `authenticated, service_role`. La barrera es el `WHERE`,
-- no el `GRANT`. Las tres mías eran las únicas en `service_role` solo — junto a
-- `platform_org_health_source`, que sí es deliberado porque es la fuente **sin
-- filtrar** que alimenta a la vista filtrada.
--
-- 📌 Estas vistas van sin `security_invoker` a propósito, como las `*_status` de
-- credenciales: con él correrían con los permisos de quien consulta y, como
-- `payment_transactions` tiene RLS por organización, un admin de plataforma
-- vería **su** organización en vez de todas. El control es el `WHERE`.
--
-- A `anon` se le sigue negando, y ahí sí el REVOKE es la barrera correcta:
-- un comprador anónimo no tiene `auth.uid()` y nunca debería ni poder preguntar.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT SELECT ON public.platform_gross_profit_por_pago  TO authenticated;
GRANT SELECT ON public.platform_gross_profit_resumen   TO authenticated;
GRANT SELECT ON public.audit_planes_cobrables          TO authenticated;

REVOKE ALL ON public.platform_gross_profit_por_pago  FROM anon;
REVOKE ALL ON public.platform_gross_profit_resumen   FROM anon;
REVOKE ALL ON public.audit_planes_cobrables          FROM anon;

-- ── Verificación: contra los roles reales, no como superusuario ────────────
DO $verif$
DECLARE
  v_admin uuid;
  v_otro  uuid;
  v_filas int;
BEGIN
  SELECT user_id INTO v_admin FROM public.platform_admins LIMIT 1;
  SELECT m.user_id INTO v_otro FROM public.memberships m
   WHERE m.user_id NOT IN (SELECT user_id FROM public.platform_admins) LIMIT 1;

  -- 1. El staff la lee.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_filas FROM public.platform_gross_profit_por_pago;
  ASSERT v_filas > 0, 'el admin de plataforma no ve ningun pago: ' || v_filas;
  PERFORM 1 FROM public.platform_gross_profit_resumen;
  PERFORM 1 FROM public.audit_planes_cobrables;
  RESET ROLE;

  -- 2. Un comercio no ve el margen de la plataforma. Acá el permiso alcanza
  --    para consultar, y es el WHERE el que devuelve vacío: eso es lo correcto.
  IF v_otro IS NOT NULL THEN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_filas FROM public.platform_gross_profit_por_pago;
    ASSERT v_filas = 0, 'un comercio ve el gross profit de la plataforma: ' || v_filas;
    RESET ROLE;
  END IF;

  -- 3. anon ni siquiera puede preguntar.
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.platform_gross_profit_por_pago;
    RESET ROLE;
    RAISE EXCEPTION 'anon puede leer el gross profit de la plataforma';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  RAISE NOTICE 'OK: el staff lee las tres vistas, el comercio ve 0 filas y anon no puede preguntar';
END $verif$;
