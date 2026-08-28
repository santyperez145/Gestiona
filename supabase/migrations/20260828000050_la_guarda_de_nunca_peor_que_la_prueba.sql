-- La guarda: nada queda por debajo de lo que da la prueba gratis
--
-- ── Por qué hace falta una vista y no basta con haberlo arreglado ─────────
--
-- ⚠️ Este defecto apareció **dos veces el mismo día**, escrito en dos lugares
-- distintos:
--
--   1. `20260828000010` — el plan de entrada ($19.900) no tenía IA, backups ni
--      branding, y el trial gratis sí. Pagar sacaba cosas.
--   2. `20260828000040` — el piso de límites al cortar era 1 usuario y 50
--      productos, contra 3 y 100 de la prueba. Un comercio que pagó y se le
--      venció quedaba peor que uno que nunca pagó — y dejó **al administrador
--      de un comercio real sin poder entrar**.
--
-- 📌 Dos formas del mismo error significa que no alcanza con corregir las dos:
-- hay que poder preguntar. Estas vistas son la pregunta, y tienen que estar
-- **vacías**.
--
-- ⚠️ La segunda mira las organizaciones reales, no la tabla de planes: el piso
-- se calcula en `org_entitlements` y no está guardado en ningún lado, así que
-- un cambio en esa función no lo detectaría una vista sobre `plans`.

-- ── 1. Ningún plan pago ofrece menos capacidades que la prueba ────────────
CREATE OR REPLACE VIEW public.audit_plan_peor_que_la_prueba AS
SELECT p.code,
       p.price_ars_monthly,
       CASE WHEN t.ai_enabled      AND NOT p.ai_enabled      THEN 'sin IA'      END AS falta_ia,
       CASE WHEN t.backups_enabled AND NOT p.backups_enabled THEN 'sin backups' END AS falta_backups,
       CASE WHEN t.custom_branding AND NOT p.custom_branding THEN 'sin branding' END AS falta_branding
  FROM public.plans p
 CROSS JOIN public.plans t
 WHERE t.code = 'trial'
   AND p.code <> 'trial'
   AND p.active
   AND ( (t.ai_enabled      AND NOT p.ai_enabled)
      OR (t.backups_enabled AND NOT p.backups_enabled)
      OR (t.custom_branding AND NOT p.custom_branding) );

COMMENT ON VIEW public.audit_plan_peor_que_la_prueba IS
  'Planes pagos que ofrecen menos capacidades que la prueba gratis. Tiene que '
  'estar vacía: cobrar y dar menos que gratis es la peor conversión posible.';

-- ── 2. Ninguna organización queda por debajo del piso de la prueba ────────
CREATE OR REPLACE VIEW public.audit_limite_peor_que_la_prueba AS
SELECT o.id            AS org_id,
       o.name,
       (e.j->>'vigente')::boolean      AS plan_vigente,
       (e.j->>'max_users')::int        AS usuarios,
       (e.j->>'max_products')::int     AS productos,
       t.max_users                     AS usuarios_de_la_prueba,
       t.max_products                  AS productos_de_la_prueba
  FROM public.organizations o
 CROSS JOIN LATERAL (SELECT public.org_entitlements(o.id) AS j) e
 CROSS JOIN public.plans t
 WHERE t.code = 'trial'
   AND ( (e.j->>'max_users')::int    < COALESCE(t.max_users, 3)
      OR (e.j->>'max_products')::int < COALESCE(t.max_products, 100) );

COMMENT ON VIEW public.audit_limite_peor_que_la_prueba IS
  'Organizaciones cuyos límites efectivos quedaron por debajo de lo que da la '
  'prueba gratis. Tiene que estar vacía: ya dejó sin entrar al administrador '
  'de un comercio real. El piso se calcula en org_entitlements, así que una '
  'vista sobre plans no lo vería.';

REVOKE ALL ON public.audit_plan_peor_que_la_prueba   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.audit_limite_peor_que_la_prueba FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — vacías hoy, y que detecten cuando no lo estén
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_n      int;
  v_start  uuid;
  v_restos int;
BEGIN
  -- ── a. Hoy están vacías ─────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.audit_plan_peor_que_la_prueba;
  ASSERT v_n = 0, v_n || ' plan(es) pagos ofrecen menos que la prueba gratis';

  SELECT count(*) INTO v_n FROM public.audit_limite_peor_que_la_prueba;
  ASSERT v_n = 0, v_n || ' organización(es) quedaron por debajo del piso de la prueba';

  -- ── b. ⚠️ Y detectan. Una vista que siempre da 0 no prueba nada ─────────
  -- Se rompe a propósito dentro de un bloque que se deshace enseguida.
  SELECT id INTO v_start FROM public.plans WHERE code = 'starter';

  UPDATE public.plans SET ai_enabled = false WHERE id = v_start;
  SELECT count(*) INTO v_n FROM public.audit_plan_peor_que_la_prueba;
  UPDATE public.plans SET ai_enabled = true  WHERE id = v_start;

  ASSERT v_n = 1,
    'la vista de planes no detectó un plan pago sin IA: devolvió ' || v_n;

  -- Y quedó como estaba.
  SELECT count(*) INTO v_restos FROM public.audit_plan_peor_que_la_prueba;
  ASSERT v_restos = 0, 'el sabotaje de la verificación no se deshizo';

  RAISE NOTICE 'OK: las dos vistas están vacías y la de planes detecta';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000050', 'la_guarda_de_nunca_peor_que_la_prueba')
ON CONFLICT DO NOTHING;
