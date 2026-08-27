-- Bajar de plan baja los límites de verdad
--
-- ── El agujero ────────────────────────────────────────────────────────────
--
-- Ya había triggers que frenan **agregar** de más: `trg_enforce_product_plan_limit`
-- y `trg_enforce_org_membership_plan_limit`. Faltaban dos cosas:
--
-- ⚠️ **1. Dos autoridades para el mismo límite.** `organization_plan_limits`
-- leía `plans.max_users` crudo, sin pasar por `org_entitlements`. O sea que el
-- piso que se aplica cuando la suscripción está impaga existía **sólo en el
-- navegador**: el servidor seguía usando los límites del plan completo. Es
-- exactamente la divergencia que este repo ya vio en el mapa de permisos y en
-- el reparto de roles.
--
-- ⚠️ **2. Lo que ya estaba adentro se quedaba.** Un comercio con 500 usuarios
-- en un plan grande que vuelve al trial de 3 **conservaba los 500**: el trigger
-- sólo mira los que entran. Bajar de plan no bajaba nada.
--
-- ── Cómo se resuelve, y qué NO se hace ────────────────────────────────────
--
-- 📌 **No se borra a nadie.** Borrar la cuenta de un empleado porque el
-- comercio cambió de plan es destruir datos de un tercero por una decisión
-- comercial de otro. Se **suspende el acceso**, que es reversible al instante
-- volviendo a subir de plan.
--
-- 📌 El orden es determinista y explicable: **el dueño nunca se suspende**, y
-- después quedan los más antiguos. Los últimos en entrar son los que se
-- sumaron mientras el plan era más grande, así que son los que sobran.
--
-- ⚠️ Y se avisa. Un empleado que un lunes no puede entrar y nadie le explica
-- por qué es una llamada al soporte y una mañana perdida.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. La marca
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS suspendido_por_plan boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspendido_at timestamptz;

COMMENT ON COLUMN public.memberships.suspendido_por_plan IS
  'El plan del comercio no alcanza para esta persona. NO es una baja: la fila '
  'queda intacta y el acceso vuelve solo al subir de plan o al liberar un lugar.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Una sola autoridad para los límites
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Los triggers que ya existen llaman a esta función. Al hacerla leer
-- `org_entitlements`, el piso por falta de pago pasa a aplicarse en el servidor
-- sin tocar ni un trigger.

CREATE OR REPLACE FUNCTION public.organization_plan_limits(p_org_id uuid)
RETURNS TABLE(max_products integer, max_users integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (public.org_entitlements(p_org_id)->>'max_products')::int,
         (public.org_entitlements(p_org_id)->>'max_users')::int;
$$;

COMMENT ON FUNCTION public.organization_plan_limits(uuid) IS
  'Los límites vigentes de una organización. Delega en org_entitlements para '
  'que el navegador y el servidor no puedan decir cosas distintas: antes leía '
  'plans.* crudo y el piso por impago quedaba sólo del lado del cliente.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Ser miembro es tener lugar en el plan
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ La tocan 98 policies. Es el lugar correcto —un solo cambio, consistente en
-- todas— y hoy no hay nadie suspendido, así que el comportamiento no cambia
-- hasta que alguien baje de plan. La verificación de abajo prueba los dos
-- lados: que un suspendido pierde el acceso y que uno normal no.

CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.memberships
     WHERE org_id = _org_id AND user_id = _user_id
       AND suspendido_por_plan IS NOT TRUE
  )
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_org_id uuid, _user_id uuid, _roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.memberships
     WHERE org_id = _org_id AND user_id = _user_id
       AND role::text = ANY(_roles)
       AND suspendido_por_plan IS NOT TRUE
  )
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Aplicar el límite a lo que ya está adentro
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.aplicar_limites_del_plan(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_max        int;
  v_suspendidos int := 0;
  v_liberados   int := 0;
BEGIN
  SELECT max_users INTO v_max FROM public.organization_plan_limits(p_org);

  -- Sin límite: se devuelve el acceso a todos. Subir de plan tiene que
  -- resolverlo solo, sin que nadie apriete nada.
  IF v_max IS NULL THEN
    UPDATE public.memberships
       SET suspendido_por_plan = false, suspendido_at = NULL
     WHERE org_id = p_org AND suspendido_por_plan;
    GET DIAGNOSTICS v_liberados = ROW_COUNT;
    RETURN jsonb_build_object('max_users', NULL, 'suspendidos', 0, 'liberados', v_liberados);
  END IF;

  -- Quiénes entran: el dueño primero, después por antigüedad.
  WITH orden AS (
    SELECT m.id,
           row_number() OVER (
             ORDER BY (m.role::text = 'owner') DESC,
                      COALESCE(m.joined_at, m.created_at) ASC,
                      m.id ASC
           ) AS puesto
      FROM public.memberships m
     WHERE m.org_id = p_org
  ),
  cambios AS (
    UPDATE public.memberships m
       SET suspendido_por_plan = (o.puesto > v_max),
           suspendido_at = CASE WHEN o.puesto > v_max
                                THEN COALESCE(m.suspendido_at, now()) ELSE NULL END
      FROM orden o
     WHERE m.id = o.id
       AND m.suspendido_por_plan IS DISTINCT FROM (o.puesto > v_max)
    RETURNING m.user_id, (o.puesto > v_max) AS ahora_suspendido
  )
  SELECT count(*) FILTER (WHERE ahora_suspendido),
         count(*) FILTER (WHERE NOT ahora_suspendido)
    INTO v_suspendidos, v_liberados
    FROM cambios;

  -- ⚠️ Alguien que no puede entrar y no sabe por qué es una mañana perdida.
  IF v_suspendidos > 0 THEN
    PERFORM public.avisar_a_los_que_mandan(
      p_org,
      'Tu plan permite ' || v_max || ' usuario' || CASE WHEN v_max = 1 THEN '' ELSE 's' END,
      'Suspendimos el acceso de ' || v_suspendidos || ' persona'
      || CASE WHEN v_suspendidos = 1 THEN '' ELSE 's' END
      || ' de tu equipo porque el plan actual no alcanza. No se borró nada: '
      || 'vuelven apenas subas de plan, o podés elegir quién ocupa cada lugar '
      || 'desde Equipo.',
      'plan', 'plan_limit', NULL);
  END IF;

  RETURN jsonb_build_object('max_users', v_max,
                            'suspendidos', v_suspendidos, 'liberados', v_liberados);
END $$;

REVOKE ALL ON FUNCTION public.aplicar_limites_del_plan(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_limites_del_plan(uuid) TO service_role;

-- ── Se aplica solo cuando cambia el plan o el estado ──────────────────────

CREATE OR REPLACE FUNCTION public.trg_aplicar_limites_del_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Sólo cuando cambia algo que mueve el límite. Correrlo en cada UPDATE de
  -- `subscriptions` —que el webhook toca seguido— sería recalcular por nada.
  IF TG_OP = 'INSERT'
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.status  IS DISTINCT FROM OLD.status THEN
    PERFORM public.aplicar_limites_del_plan(NEW.org_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aplicar_limites_del_plan ON public.subscriptions;
CREATE TRIGGER trg_aplicar_limites_del_plan
  AFTER INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.trg_aplicar_limites_del_plan();

-- ── Qué le sobra a un comercio, para poder decírselo ──────────────────────

CREATE OR REPLACE VIEW public.mi_exceso_de_plan AS
SELECT m.org_id,
       (SELECT max_users FROM public.organization_plan_limits(m.org_id)) AS max_users,
       count(*)                                        AS usuarios,
       count(*) FILTER (WHERE m.suspendido_por_plan)    AS suspendidos
  FROM public.memberships m
 GROUP BY m.org_id
HAVING EXISTS (SELECT 1 FROM public.memberships x
                WHERE x.org_id = m.org_id AND x.user_id = auth.uid()
                  AND x.role::text IN ('owner','admin'));

GRANT SELECT ON public.mi_exceso_de_plan TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_plan_grande uuid := gen_random_uuid();
  v_plan_chico  uuid := gen_random_uuid();
  v_dueno uuid;
  v_otro  uuid;
  v_r jsonb;
  v_dueno_entra boolean;
  v_otro_entra  boolean;
  v_restos int;
BEGIN
  SELECT user_id INTO v_dueno FROM public.memberships LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_dueno LIMIT 1;
  IF v_otro IS NULL THEN
    RAISE NOTICE 'hay un solo usuario: no se puede probar el exceso';
    RETURN;
  END IF;

  INSERT INTO public.plans (id, code, name, price_ars_monthly, max_users, active, sort_order)
  VALUES (v_plan_grande, 'zz_grande', 'ZZ Grande', 1000, 10, false, 996),
         (v_plan_chico,  'zz_chico',  'ZZ Chico',  100,   1, false, 995);

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ limites', 'zz-lim-'||substr(v_org::text,1,8), v_dueno);
  INSERT INTO public.memberships (org_id, user_id, role, joined_at) VALUES
    (v_org, v_dueno, 'owner',    now() - interval '10 days'),
    (v_org, v_otro,  'vendedor', now() - interval '1 day');

  INSERT INTO public.subscriptions (org_id, plan_id, status, provider, current_period_end)
  VALUES (v_org, v_plan_grande, 'active', 'mercadopago', now() + interval '20 days');

  -- ── a. Con el plan grande, los dos entran ───────────────────────────────
  ASSERT public.is_org_member(v_org, v_dueno), 'el dueño no entra con lugar de sobra';
  ASSERT public.is_org_member(v_org, v_otro),  'el empleado no entra con lugar de sobra';

  -- ── b. Baja de plan: el que sobra pierde el acceso ──────────────────────
  UPDATE public.subscriptions SET plan_id = v_plan_chico WHERE org_id = v_org;

  v_dueno_entra := public.is_org_member(v_org, v_dueno);
  v_otro_entra  := public.is_org_member(v_org, v_otro);

  ASSERT NOT v_otro_entra,
    'se bajó a un plan de 1 usuario y el segundo siguió entrando: el limite no baja';

  -- ── c. ⚠️ Y el DUEÑO nunca se suspende ──────────────────────────────────
  -- Sin esta mitad, un límite aplicado sin orden podría dejar al comercio sin
  -- nadie que pueda volver a subir de plan — o sea sin salida.
  ASSERT v_dueno_entra,
    'se suspendió al dueño: el comercio queda sin nadie que pueda pagar';

  -- ── d. Nada se borró ────────────────────────────────────────────────────
  ASSERT (SELECT count(*) FROM public.memberships WHERE org_id = v_org) = 2,
    'se borró una membresía: el limite no puede destruir datos de un tercero';

  -- ── e. Subir de plan lo devuelve solo ───────────────────────────────────
  UPDATE public.subscriptions SET plan_id = v_plan_grande WHERE org_id = v_org;
  ASSERT public.is_org_member(v_org, v_otro),
    'al volver a subir de plan el acceso no se devolvió solo';

  -- ── f. Y el límite del servidor sigue al plan ───────────────────────────
  SELECT to_jsonb(l) INTO v_r FROM public.organization_plan_limits(v_org) l;
  ASSERT (v_r->>'max_users')::int = 10,
    'el limite del servidor no siguió al plan: dice ' || (v_r->>'max_users');

  -- ── g. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.notifications WHERE org_id = v_org;
  DELETE FROM public.subscriptions WHERE org_id = v_org;
  DELETE FROM public.memberships   WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  DELETE FROM public.plans WHERE id IN (v_plan_grande, v_plan_chico);
  SELECT count(*) INTO v_restos FROM public.plans WHERE code LIKE 'zz\_%';
  ASSERT v_restos = 0, 'quedaron planes ZZ';

  RAISE NOTICE 'OK: baja de plan suspende al que sobra, nunca al dueño, no borra nada y subir lo devuelve';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000220', 'el_plan_manda_sobre_los_limites')
ON CONFLICT DO NOTHING;
