-- Cambiarle el precio a quien ya está suscripto, con aviso
--
-- ── El problema de raíz, que es anterior al aviso ─────────────────────────
--
-- ⚠️ `subscriptions` **no guardaba en ningún lado cuánto acordó pagar cada
-- comercio**. El precio vivía sólo en `plans.price_ars_monthly`, y el monto que
-- MercadoPago cobra de verdad vive en el `preapproval`, que se creó con el
-- precio del día de la contratación y **nadie actualiza después**.
--
-- Consecuencia medida el 2026-08-27: si el dueño editaba el precio en la
-- consola, `MiPlanPage` le mostraba al comercio el precio **nuevo** mientras
-- MercadoPago le seguía cobrando el **viejo**. Sin una columna que diga qué se
-- acordó, no hay forma de notar la divergencia — ni de avisar un cambio, porque
-- no se sabe desde qué precio.
--
-- 📌 Por eso el primer paso no es la notificación: es **dejar constancia de lo
-- acordado**. Un aviso que dice «tu precio pasa de X a Y» con una X inventada
-- es peor que no avisar.
--
-- ── Cómo se reparte el cambio ─────────────────────────────────────────────
--
-- Editar `plans.price_ars_monthly` cambia lo que paga **quien se suscriba de
-- ahí en adelante**, y eso está bien: es el precio de lista. Lo que no puede
-- pasar en silencio es cambiarle el precio a quien ya está adentro. Eso es una
-- decisión aparte, con fecha, con aviso y con constancia — lo que modela
-- `plan_price_changes`.
--
-- 📌 Se sigue el patrón que este repo ya usa para la comisión de plataforma
-- (`platform_commission_rules`): la decisión es una fila con estado y fecha de
-- vigencia, no un UPDATE suelto que nadie puede auditar después.
--
-- ── El preaviso ───────────────────────────────────────────────────────────
--
-- 30 días para un aumento, 0 para una baja: una baja sólo beneficia a quien la
-- recibe, y hacerlo esperar un mes para pagar menos no protege a nadie.
--
-- ⚠️ Los 30 días son un **default prudente elegido acá, no una norma que se
-- haya verificado**. `docs/LEGAL.md` cubre precios al consumidor en la tienda,
-- no la suscripción al SaaS: ese relevamiento falta y es del dueño. El número
-- se cambia en un lugar (`preaviso_minimo_dias`).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Lo que cada comercio acordó pagar
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS precio_ars numeric,
  ADD COLUMN IF NOT EXISTS precio_ars_desde timestamptz;

COMMENT ON COLUMN public.subscriptions.precio_ars IS
  'Monto autorizado en MercadoPago para esta suscripción. NULL = no consta — '
  'no es lo mismo que gratis. Es la única fuente de qué se le cobra a este '
  'comercio; `plans.price_ars_monthly` es el precio de lista para los nuevos.';

-- Backfill sólo donde se puede probar: si el precio del plan no se tocó desde
-- que el comercio se suscribió, el precio de hoy ES el que autorizó.
--
-- ⚠️ Donde no se puede probar queda NULL. Rellenarlo con el precio actual sería
-- inventar el dato que después se usa para decirle «tu precio pasa de X a Y».
UPDATE public.subscriptions s
   SET precio_ars = CASE WHEN s.ciclo = 'anual' THEN p.price_ars_yearly
                         ELSE p.price_ars_monthly END,
       precio_ars_desde = s.created_at
  FROM public.plans p
 WHERE p.id = s.plan_id
   AND s.precio_ars IS NULL
   AND s.mp_preapproval_id IS NOT NULL   -- sin preapproval no hay nada autorizado
   AND (p.price_ars_updated_at IS NULL OR p.price_ars_updated_at <= s.created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. La decisión: un cambio de precio programado
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.plan_price_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  ciclo           text NOT NULL CHECK (ciclo IN ('mensual', 'anual')),
  precio_anterior numeric,
  precio_nuevo    numeric NOT NULL CHECK (precio_nuevo >= 0),
  vigente_desde   date NOT NULL,
  motivo          text,
  estado          text NOT NULL DEFAULT 'programado'
                    CHECK (estado IN ('programado', 'notificado', 'aplicado', 'cancelado')),
  creado_por      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  notificado_at   timestamptz,
  aplicado_at     timestamptz
);

COMMENT ON TABLE public.plan_price_changes IS
  'Cambio de precio para quien YA está suscripto. Editar plans.price_ars_* '
  'cambia el precio de lista para los nuevos; esto es la decisión, aparte y '
  'con constancia, de moverle el precio a los actuales.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. A quién afecta, y cómo le fue a cada uno
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ Va por suscripción y no sólo por plan porque MercadoPago puede aceptar el
-- cambio de una y rechazar el de otra. Un estado agregado taparía justo el caso
-- que hay que mirar: el comercio al que no se le pudo aplicar y le sigue
-- llegando el precio viejo.

CREATE TABLE IF NOT EXISTS public.plan_price_change_targets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cambio_id       uuid NOT NULL REFERENCES public.plan_price_changes(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  precio_anterior numeric,
  precio_nuevo    numeric NOT NULL,
  estado          text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'notificado', 'aplicado',
                                      'requiere_reautorizacion', 'error', 'cancelado')),
  notificado_at   timestamptz,
  aplicado_at     timestamptz,
  error           text,
  mp_respuesta    jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cambio_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS plan_price_change_targets_org
  ON public.plan_price_change_targets (org_id, estado);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- La decisión es del staff. El comercio ve **lo suyo**: tiene derecho a saber
-- que le van a cambiar el precio, y esconderlo sería lo contrario de avisar.

ALTER TABLE public.plan_price_changes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_price_change_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_price_changes_staff ON public.plan_price_changes;
CREATE POLICY plan_price_changes_staff ON public.plan_price_changes
  FOR ALL USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS plan_price_change_targets_staff ON public.plan_price_change_targets;
CREATE POLICY plan_price_change_targets_staff ON public.plan_price_change_targets
  FOR ALL USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS plan_price_change_targets_org_select ON public.plan_price_change_targets;
CREATE POLICY plan_price_change_targets_org_select ON public.plan_price_change_targets
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- El comercio necesita leer la fila del cambio para saber DESDE CUÁNDO rige.
DROP POLICY IF EXISTS plan_price_changes_org_select ON public.plan_price_changes;
CREATE POLICY plan_price_changes_org_select ON public.plan_price_changes
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.plan_price_change_targets t
     WHERE t.cambio_id = plan_price_changes.id
       AND public.is_org_member(t.org_id, auth.uid())
  ));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Programar el cambio
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.preaviso_minimo_dias(p_sube boolean)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  -- Una baja no necesita preaviso: sólo beneficia a quien la recibe.
  SELECT CASE WHEN p_sube THEN 30 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.programar_cambio_de_precio(
  p_plan_id       uuid,
  p_ciclo         text,
  p_precio_nuevo  numeric,
  p_vigente_desde date,
  p_motivo        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cambio  uuid;
  v_actual  numeric;
  v_sube    boolean;
  v_minimo  int;
  v_alcance int;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sólo el staff de plataforma puede cambiar precios'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_ciclo NOT IN ('mensual', 'anual') THEN
    RAISE EXCEPTION 'Ciclo inválido: %', p_ciclo USING ERRCODE = 'check_violation';
  END IF;
  IF p_precio_nuevo IS NULL OR p_precio_nuevo < 0 THEN
    RAISE EXCEPTION 'El precio nuevo tiene que ser un número no negativo'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT CASE WHEN p_ciclo = 'anual' THEN price_ars_yearly ELSE price_ars_monthly END
    INTO v_actual FROM public.plans WHERE id = p_plan_id;

  -- ⚠️ El preaviso se mide contra lo que paga CADA UNO, no contra el precio de
  -- lista: si a alguien se le está cobrando menos, para él esto es un aumento
  -- aunque el precio de lista baje.
  v_sube := EXISTS (
    SELECT 1 FROM public.subscriptions s
     WHERE s.plan_id = p_plan_id AND s.ciclo = p_ciclo
       AND s.status IN ('active', 'past_due', 'trialing')
       AND COALESCE(s.precio_ars, v_actual, 0) < p_precio_nuevo
  );
  v_minimo := public.preaviso_minimo_dias(v_sube);

  IF p_vigente_desde < CURRENT_DATE + v_minimo THEN
    RAISE EXCEPTION
      'Un aumento necesita % días de preaviso: la fecha más temprana es %',
      v_minimo, (CURRENT_DATE + v_minimo)
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.plan_price_changes
    (plan_id, ciclo, precio_anterior, precio_nuevo, vigente_desde, motivo, creado_por)
  VALUES (p_plan_id, p_ciclo, v_actual, p_precio_nuevo, p_vigente_desde, p_motivo, auth.uid())
  RETURNING id INTO v_cambio;

  -- Se congela a quién afecta HOY. Quien se suscriba después ya paga el precio
  -- de lista nuevo y no entra en este cambio.
  INSERT INTO public.plan_price_change_targets
    (cambio_id, subscription_id, org_id, precio_anterior, precio_nuevo)
  SELECT v_cambio, s.id, s.org_id, COALESCE(s.precio_ars, v_actual), p_precio_nuevo
    FROM public.subscriptions s
   WHERE s.plan_id = p_plan_id AND s.ciclo = p_ciclo
     AND s.status IN ('active', 'past_due', 'trialing')
     AND COALESCE(s.precio_ars, v_actual) IS DISTINCT FROM p_precio_nuevo;
  GET DIAGNOSTICS v_alcance = ROW_COUNT;

  RETURN jsonb_build_object(
    'cambio_id', v_cambio,
    'alcance', v_alcance,
    'sube', v_sube,
    'preaviso_dias', v_minimo,
    'vigente_desde', p_vigente_desde
  );
END $$;

GRANT EXECUTE ON FUNCTION public.programar_cambio_de_precio(uuid, text, numeric, date, text)
  TO authenticated;

-- ── Cuánto afectaría, ANTES de programarlo ────────────────────────────────
--
-- La consola tiene que poder decir «esto toca a N comercios» antes de que
-- alguien apriete guardar. Un cambio de precio a ciegas es cómo se pierde una
-- cartera entera sin enterarse.

CREATE OR REPLACE FUNCTION public.impacto_cambio_de_precio(
  p_plan_id uuid, p_ciclo text, p_precio_nuevo numeric
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_actual numeric; v_r jsonb;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sólo el staff de plataforma' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT CASE WHEN p_ciclo = 'anual' THEN price_ars_yearly ELSE price_ars_monthly END
    INTO v_actual FROM public.plans WHERE id = p_plan_id;

  SELECT jsonb_build_object(
    'afectados',   count(*) FILTER (WHERE COALESCE(s.precio_ars, v_actual) IS DISTINCT FROM p_precio_nuevo),
    'suben',       count(*) FILTER (WHERE COALESCE(s.precio_ars, v_actual, 0) < p_precio_nuevo),
    'bajan',       count(*) FILTER (WHERE COALESCE(s.precio_ars, v_actual, 0) > p_precio_nuevo),
    'sin_constancia', count(*) FILTER (WHERE s.precio_ars IS NULL AND s.mp_preapproval_id IS NOT NULL),
    'mrr_actual',  COALESCE(sum(COALESCE(s.precio_ars, v_actual)), 0),
    'mrr_nuevo',   COALESCE(count(*) * p_precio_nuevo, 0),
    'preaviso_dias', public.preaviso_minimo_dias(
        bool_or(COALESCE(s.precio_ars, v_actual, 0) < p_precio_nuevo)),
    'precio_actual_lista', v_actual
  ) INTO v_r
  FROM public.subscriptions s
  WHERE s.plan_id = p_plan_id AND s.ciclo = p_ciclo
    AND s.status IN ('active', 'past_due', 'trialing');

  RETURN v_r;
END $$;

GRANT EXECUTE ON FUNCTION public.impacto_cambio_de_precio(uuid, text, numeric) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Lo que el comercio tiene que poder ver
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.mi_cambio_de_precio AS
SELECT t.org_id,
       t.id              AS target_id,
       c.id              AS cambio_id,
       t.precio_anterior,
       t.precio_nuevo,
       c.vigente_desde,
       c.motivo,
       c.ciclo,
       t.estado,
       t.notificado_at,
       (t.precio_nuevo > COALESCE(t.precio_anterior, 0)) AS sube,
       GREATEST(0, (c.vigente_desde - CURRENT_DATE))     AS dias_para_que_rija
  FROM public.plan_price_change_targets t
  JOIN public.plan_price_changes c ON c.id = t.cambio_id
 WHERE t.estado IN ('pendiente', 'notificado')
   AND c.estado <> 'cancelado'
   AND public.is_org_member(t.org_id, auth.uid());

COMMENT ON VIEW public.mi_cambio_de_precio IS
  'El cambio de precio pendiente de la organización del usuario. Sin '
  'security_invoker: el control es el is_org_member del WHERE, igual que en '
  'las vistas *_status de credenciales.';

GRANT SELECT ON public.mi_cambio_de_precio TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Qué toca aplicar hoy (lo consume el cron)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cambios_de_precio_a_aplicar()
RETURNS TABLE (
  target_id uuid, cambio_id uuid, subscription_id uuid, org_id uuid,
  mp_preapproval_id text, precio_anterior numeric, precio_nuevo numeric, ciclo text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.id, c.id, s.id, t.org_id, s.mp_preapproval_id,
         t.precio_anterior, t.precio_nuevo, c.ciclo
    FROM public.plan_price_change_targets t
    JOIN public.plan_price_changes c ON c.id = t.cambio_id
    JOIN public.subscriptions s ON s.id = t.subscription_id
   WHERE c.estado <> 'cancelado'
     AND t.estado IN ('pendiente', 'notificado')
     AND c.vigente_desde <= CURRENT_DATE
     -- ⚠️ Sin preapproval no hay nada que actualizar en MercadoPago. Se deja
     -- afuera en vez de intentarlo y anotar un error que no es un error.
     AND s.mp_preapproval_id IS NOT NULL
     AND s.status IN ('active', 'past_due');
$$;

REVOKE ALL ON FUNCTION public.cambios_de_precio_a_aplicar() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.cambios_de_precio_a_aplicar() TO service_role;

-- Registrar el resultado de intentar aplicarlo. La escribe la Edge Function.
CREATE OR REPLACE FUNCTION public.registrar_cambio_de_precio(
  p_target_id uuid, p_estado text, p_error text DEFAULT NULL,
  p_respuesta jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_target public.plan_price_change_targets;
BEGIN
  IF p_estado NOT IN ('aplicado', 'requiere_reautorizacion', 'error', 'notificado') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_estado USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.plan_price_change_targets
     SET estado = p_estado,
         error = p_error,
         mp_respuesta = COALESCE(p_respuesta, mp_respuesta),
         aplicado_at   = CASE WHEN p_estado = 'aplicado'  THEN now() ELSE aplicado_at END,
         notificado_at = CASE WHEN p_estado = 'notificado' THEN now() ELSE notificado_at END
   WHERE id = p_target_id
  RETURNING * INTO v_target;

  -- 📌 El precio acordado se mueve SÓLO cuando MercadoPago aceptó. Si se
  -- escribiera al programar, `Mi plan` mostraría un precio que todavía no se
  -- cobra — que es exactamente el bug que esta migración vino a cerrar.
  IF p_estado = 'aplicado' THEN
    UPDATE public.subscriptions
       SET precio_ars = v_target.precio_nuevo, precio_ars_desde = now()
     WHERE id = v_target.subscription_id;
  END IF;

  -- El cambio queda aplicado cuando no le queda ningún objetivo pendiente.
  UPDATE public.plan_price_changes c
     SET estado = 'aplicado', aplicado_at = now()
   WHERE c.id = v_target.cambio_id
     AND c.estado <> 'cancelado'
     AND NOT EXISTS (
       SELECT 1 FROM public.plan_price_change_targets t
        WHERE t.cambio_id = c.id AND t.estado IN ('pendiente', 'notificado'));
END $$;

REVOKE ALL ON FUNCTION public.registrar_cambio_de_precio(uuid, text, text, jsonb)
  FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cambio_de_precio(uuid, text, text, jsonb)
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_plan uuid := gen_random_uuid();
  v_org  uuid := gen_random_uuid();
  v_user  uuid;
  v_staff uuid;
  v_sub  uuid;
  v_r    jsonb;
  v_target uuid;
  v_muy_pronto boolean;
  v_sin_staff  boolean;
  v_ajeno boolean;
  v_precio numeric;
  v_restos int;
BEGIN
  SELECT user_id INTO v_user  FROM public.memberships LIMIT 1;
  SELECT user_id INTO v_staff FROM public.platform_admins LIMIT 1;

  -- ⚠️ Un bloque DO corre como superusuario y `auth.uid()` es NULL, así que
  -- TODA llamada al RPC fallaba por el chequeo de staff. La primera versión de
  -- esta verificación creyó estar probando el preaviso y estaba probando otra
  -- cosa — la misma trampa que ya dio un falso positivo con `abrir_conteo`.
  -- Se fija la identidad del staff para las llamadas de abajo.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);

  INSERT INTO public.plans (id, code, name, price_ars_monthly, active, sort_order)
  VALUES (v_plan, 'zz_precio', 'ZZ Precio', 10000, true, 998);
  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ precio', 'zz-precio-'||substr(v_org::text,1,8), v_user);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  INSERT INTO public.subscriptions (org_id, plan_id, status, provider, ciclo,
                                    mp_preapproval_id, precio_ars, current_period_end)
  VALUES (v_org, v_plan, 'active', 'mercadopago', 'mensual', 'ZZ-PREAPPROVAL',
          10000, now() + interval '20 days')
  RETURNING id INTO v_sub;

  -- ── a. Un aumento sin preaviso se rechaza ───────────────────────────────
  BEGIN
    PERFORM public.programar_cambio_de_precio(v_plan, 'mensual', 15000, CURRENT_DATE + 3);
    v_muy_pronto := true;
  EXCEPTION WHEN check_violation THEN
    v_muy_pronto := false;
  END;
  ASSERT NOT v_muy_pronto,
    'se pudo programar un aumento para dentro de 3 dias: el preaviso no frena nada';

  -- ── b. ⚠️ Pero una BAJA sí puede ser inmediata ──────────────────────────
  -- Sin esta mitad, un preaviso demasiado ancho obligaria a esperar un mes
  -- para cobrarle menos a alguien, que no protege a nadie.
  v_r := public.programar_cambio_de_precio(v_plan, 'mensual', 8000, CURRENT_DATE);
  ASSERT (v_r->>'alcance')::int = 1, 'la baja no alcanzo a la suscripcion activa';
  ASSERT NOT (v_r->>'sube')::boolean, 'una baja quedo marcada como aumento';

  -- ── c. ⚠️ Y alguien que NO es staff no puede tocar precios ──────────────
  -- Esto se descubrió por accidente: la primera verificación chocaba contra
  -- este chequeo creyendo que probaba el preaviso. Ya que es el guardia más
  -- caro de los dos, se prueba a propósito.
  --
  -- ⚠️ La identidad NO puede salir de `memberships`: hoy hay un solo staff de
  -- plataforma y es el mismo dueño, así que el test se probaba contra sí mismo
  -- y reportaba que cualquiera podía cambiar precios. Se usa una identidad que
  -- con certeza no es staff.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role','authenticated')::text, true);
  BEGIN
    PERFORM public.programar_cambio_de_precio(v_plan, 'mensual', 9000, CURRENT_DATE + 60);
    v_sin_staff := true;
  EXCEPTION WHEN insufficient_privilege THEN
    v_sin_staff := false;
  END;
  ASSERT NOT v_sin_staff,
    'un usuario sin ser staff de plataforma pudo cambiarle el precio a un comercio';

  -- ── d. El comercio puede ver lo suyo ────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ASSERT EXISTS (SELECT 1 FROM public.mi_cambio_de_precio WHERE org_id = v_org),
    'el comercio no puede ver el cambio de precio que le van a aplicar';
  RESET ROLE;

  -- ── e. ⚠️ Y NO puede ver el de otro ─────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT EXISTS (SELECT 1 FROM public.mi_cambio_de_precio WHERE org_id = v_org) INTO v_ajeno;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  ASSERT NOT v_ajeno, 'un usuario ajeno vio el cambio de precio de otro comercio';

  -- ── f. Está listo para aplicarse hoy ────────────────────────────────────
  SELECT target_id INTO v_target FROM public.cambios_de_precio_a_aplicar()
   WHERE org_id = v_org;
  ASSERT v_target IS NOT NULL, 'el cambio vigente hoy no aparece para aplicar';

  -- ── g. Un intento fallido NO mueve el precio acordado ───────────────────
  PERFORM public.registrar_cambio_de_precio(v_target, 'error', 'ZZ rechazo simulado');
  SELECT precio_ars INTO v_precio FROM public.subscriptions WHERE id = v_sub;
  ASSERT v_precio = 10000,
    'el precio acordado se movio con un intento fallido: quedo en ' || v_precio;

  -- ── h. Y uno aceptado sí ────────────────────────────────────────────────
  PERFORM public.registrar_cambio_de_precio(v_target, 'aplicado', NULL,
                                            '{"zz":"ok"}'::jsonb);
  SELECT precio_ars INTO v_precio FROM public.subscriptions WHERE id = v_sub;
  ASSERT v_precio = 8000, 'el precio acordado no se actualizo al aplicar: ' || v_precio;
  ASSERT (SELECT estado FROM public.plan_price_changes
           WHERE plan_id = v_plan ORDER BY created_at DESC LIMIT 1) = 'aplicado',
    'el cambio no quedo cerrado cuando ya no le quedan objetivos';

  -- ── i. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.subscriptions WHERE org_id = v_org;
  DELETE FROM public.memberships   WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  DELETE FROM public.plans WHERE id = v_plan;   -- CASCADE se lleva cambio y targets
  SELECT count(*) INTO v_restos FROM public.plans WHERE code = 'zz_precio';
  ASSERT v_restos = 0, 'quedo el plan ZZ';
  SELECT count(*) INTO v_restos FROM public.plan_price_changes WHERE plan_id = v_plan;
  ASSERT v_restos = 0, 'quedaron cambios ZZ huerfanos';

  RAISE NOTICE 'OK: preaviso obligatorio para subir, baja inmediata, el comercio ve lo suyo y no lo ajeno, el precio se mueve solo si MP acepto';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000160', 'el_precio_acordado_y_su_cambio')
ON CONFLICT DO NOTHING;
