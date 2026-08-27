-- Los avisos importantes llegan por correo, no sólo a la campanita
--
-- ── Por qué un solo camino y no una función por aviso ─────────────────────
--
-- El sistema ya sabe avisar: `notifications` tiene 132 filas y la campanita
-- funciona. Lo que falta es que **algunos** de esos avisos salgan también por
-- correo, porque hay hechos que no se pueden esperar a que el comercio entre al
-- panel: que se le termina la prueba, que le cambia el precio, que alguien de
-- afuera pidió ver sus datos.
--
-- 📌 Se resuelve marcando el aviso, no escribiendo una función de correo por
-- cada caso. Así el próximo aviso que tenga que salir por mail es un booleano,
-- no otra Edge Function con su propio remitente y su propia forma de fallar —
-- que es exactamente cómo terminaron existiendo nueve remitentes distintos.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS enviar_por_correo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_enviado_at  timestamptz,
  ADD COLUMN IF NOT EXISTS email_error       text;

COMMENT ON COLUMN public.notifications.enviar_por_correo IS
  'Este aviso además sale por mail. Se marca al crearlo; un cron lo manda y '
  'anota el resultado real en email_enviado_at / email_error.';

CREATE INDEX IF NOT EXISTS notifications_pendientes_de_correo
  ON public.notifications (created_at)
  WHERE enviar_por_correo AND email_enviado_at IS NULL;

-- ── Avisar, opcionalmente también por correo ──────────────────────────────

CREATE OR REPLACE FUNCTION public.avisar_a_los_que_mandan(
  p_org uuid, p_titulo text, p_mensaje text, p_tipo text,
  p_entidad text DEFAULT NULL, p_entidad_id uuid DEFAULT NULL,
  p_por_correo boolean DEFAULT false
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO public.notifications (user_id, org_id, title, message, type,
                                    entity_type, entity_id, enviar_por_correo)
  SELECT m.user_id, p_org, p_titulo, p_mensaje, p_tipo, p_entidad, p_entidad_id, p_por_correo
    FROM public.memberships m
   WHERE m.org_id = p_org
     AND m.role::text IN ('owner', 'admin')
     -- Un suspendido por plan no recibe: no puede entrar a hacer nada con eso.
     AND m.suspendido_por_plan IS NOT TRUE;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.avisar_a_los_que_mandan(uuid, text, text, text, text, uuid, boolean)
  FROM public, anon;

-- ── Los tres avisos que sí van por correo ─────────────────────────────────
--
-- ⚠️ Sólo tres. Mandar por mail todo lo que entra a la campanita es la forma
-- más rápida de que el comercio ponga la casilla en «no molestar», y entonces
-- tampoco lea el que importa.

CREATE OR REPLACE FUNCTION public.trg_avisar_acceso_de_soporte()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.avisar_a_los_que_mandan(
      NEW.org_id,
      'El soporte de Gestiona pidió acceso a tu diagnóstico',
      'Un integrante del equipo de soporte solicitó ver el estado técnico de tu '
      || 'negocio para ayudarte. No incluye tus contraseñas ni tus medios de cobro. '
      || 'Podés ver el detalle y el historial en Ajustes.',
      'soporte', 'support_access', NEW.id, true);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.approved_at IS NOT NULL AND OLD.approved_at IS NULL THEN
    PERFORM public.avisar_a_los_que_mandan(
      NEW.org_id,
      'El soporte ya puede ver tu diagnóstico',
      'El acceso quedó habilitado'
      || COALESCE(' hasta el ' || to_char(NEW.expires_at, 'DD/MM/YYYY'), '')
      || '. Podés revocarlo cuando quieras desde Ajustes.',
      'soporte', 'support_access', NEW.id, true);
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_avisar_cambio_de_precio()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_desde date; v_sube boolean;
BEGIN
  SELECT c.vigente_desde INTO v_desde
    FROM public.plan_price_changes c WHERE c.id = NEW.cambio_id;
  v_sube := NEW.precio_nuevo > COALESCE(NEW.precio_anterior, 0);

  -- 📌 Sin correo: este aviso ya tiene el suyo, más completo, que manda
  -- `precio-suscripcion`. Duplicarlo sería mandar dos mails por lo mismo.
  PERFORM public.avisar_a_los_que_mandan(
    NEW.org_id,
    CASE WHEN v_sube THEN 'Tu suscripción cambia de precio'
         ELSE 'Tu suscripción baja de precio' END,
    'Desde el ' || to_char(v_desde, 'DD/MM/YYYY') || ' vas a pagar $'
    || trim(to_char(NEW.precio_nuevo, 'FM999G999G999'))
    || '. Podés ver el detalle, cambiar de plan o darte de baja en Mi plan.',
    'suscripcion', 'price_change', NEW.id, false);

  RETURN NEW;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- El aviso de que se termina la prueba
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ La página de precios prometía «te avisamos 3 días antes del vencimiento»
-- y **ninguna función mandaba ese aviso**. Ahora existe.
--
-- 📌 Se avisa a los 3 días y otra vez el último día. Un solo aviso tres días
-- antes se pierde: cae un domingo, o el dueño lo ve entre veinte mails y se
-- olvida. El del último día es el que evita que se entere cuando ya no puede
-- vender.

CREATE OR REPLACE FUNCTION public.avisar_trial_por_vencer()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org record;
  v_dias int;
  v_marca text;
  v_avisados int := 0;
BEGIN
  FOR v_org IN
    SELECT o.id, o.name, o.trial_ends_at
      FROM public.organizations o
      LEFT JOIN public.subscriptions s ON s.org_id = o.id
     WHERE o.trial_ends_at IS NOT NULL
       AND o.trial_ends_at > now()
       AND o.trial_ends_at <= now() + interval '3 days'
       -- Quien ya contrató no necesita que le avisen que se le termina la prueba.
       AND (s.id IS NULL OR s.status IN ('trialing'))
  LOOP
    v_dias := GREATEST(0, EXTRACT(day FROM v_org.trial_ends_at - now())::int);
    -- Una marca por tramo: así el aviso de 3 días y el del último día son dos
    -- hechos distintos y ninguno se repite todos los días.
    v_marca := CASE WHEN v_dias >= 1 THEN 'trial_3d' ELSE 'trial_ultimo_dia' END;

    IF EXISTS (SELECT 1 FROM public.notifications n
                WHERE n.org_id = v_org.id AND n.entity_type = v_marca) THEN
      CONTINUE;
    END IF;

    PERFORM public.avisar_a_los_que_mandan(
      v_org.id,
      CASE WHEN v_dias >= 1
           THEN 'Te quedan ' || v_dias || ' día' || CASE WHEN v_dias = 1 THEN '' ELSE 's' END || ' de prueba'
           ELSE 'Hoy es el último día de tu prueba' END,
      'Cuando termine la prueba no se borra nada: vas a seguir entrando y viendo '
      || 'tus ventas, tu stock y tus clientes. Lo que se apaga son los extras del '
      || 'plan. Elegí un plan desde Mi plan y vuelve todo.',
      'suscripcion', v_marca, NULL, true);
    v_avisados := v_avisados + 1;
  END LOOP;

  RETURN jsonb_build_object('avisados', v_avisados);
END $$;

REVOKE ALL ON FUNCTION public.avisar_trial_por_vencer() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.avisar_trial_por_vencer() TO service_role;

-- Corre una vez por día, a la mañana. Es un mail que hay que leer.
SELECT cron.unschedule('avisar-trial-por-vencer')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisar-trial-por-vencer');
SELECT cron.schedule('avisar-trial-por-vencer', '15 12 * * *',
  $$SELECT public.avisar_trial_por_vencer()$$);

-- Y el envío de los avisos marcados, cada media hora.
SELECT cron.unschedule('avisos-por-correo')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisos-por-correo');
SELECT cron.schedule('avisos-por-correo', '*/30 * * * *',
  $$SELECT public.invoke_edge_function('avisos-por-correo')$$);

-- ── Lo que el cron manda, y cómo se anota el resultado ────────────────────

CREATE OR REPLACE FUNCTION public.avisos_por_correo_pendientes()
RETURNS TABLE (id uuid, org_id uuid, titulo text, mensaje text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT n.id, n.org_id, n.title, n.message, u.email::text
    FROM public.notifications n
    JOIN auth.users u ON u.id = n.user_id
   WHERE n.enviar_por_correo
     AND n.email_enviado_at IS NULL
     AND u.email IS NOT NULL
     -- Un aviso de hace una semana que nunca salió ya no sirve: se manda lo
     -- reciente y lo viejo queda registrado sin reintentar para siempre.
     AND n.created_at > now() - interval '3 days'
   ORDER BY n.created_at
   LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.avisos_por_correo_pendientes() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisos_por_correo_pendientes() TO service_role;

CREATE OR REPLACE FUNCTION public.aviso_correo_registrar(
  p_id uuid, p_ok boolean, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE public.notifications
     SET email_enviado_at = CASE WHEN p_ok THEN now() ELSE email_enviado_at END,
         email_error = CASE WHEN p_ok THEN NULL ELSE p_error END
   WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.aviso_correo_registrar(uuid, boolean, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aviso_correo_registrar(uuid, boolean, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org uuid := gen_random_uuid();
  v_user uuid;
  v_r jsonb;
  v_n int;
  v_pend int;
  v_restos int;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;

  INSERT INTO public.organizations (id, name, slug, owner_user_id, trial_ends_at)
  VALUES (v_org, 'ZZ trial', 'zz-tr-'||substr(v_org::text,1,8), v_user,
          now() + interval '2 days');
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  -- ── a. Se avisa del trial por vencer ────────────────────────────────────
  v_r := public.avisar_trial_por_vencer();
  SELECT count(*) INTO v_n FROM public.notifications
   WHERE org_id = v_org AND entity_type = 'trial_3d';
  ASSERT v_n = 1, 'no se avisó que la prueba está por terminar';

  -- ── b. ⚠️ Y no se repite al día siguiente ───────────────────────────────
  -- Sin esta mitad, el comercio recibiría el mismo mail todos los días hasta
  -- que venza, que es la forma más rápida de que deje de leerlos.
  PERFORM public.avisar_trial_por_vencer();
  SELECT count(*) INTO v_n FROM public.notifications
   WHERE org_id = v_org AND entity_type = 'trial_3d';
  ASSERT v_n = 1, 'el aviso del trial se repitió: quedaron ' || v_n;

  -- ── c. Queda pendiente de correo ────────────────────────────────────────
  SELECT count(*) INTO v_pend FROM public.avisos_por_correo_pendientes() WHERE org_id = v_org;
  ASSERT v_pend = 1, 'el aviso del trial no salió a la cola de correo';

  -- ── d. Un envío fallido NO lo da por mandado ────────────────────────────
  PERFORM public.aviso_correo_registrar(
    (SELECT id FROM public.notifications WHERE org_id = v_org LIMIT 1), false, 'ZZ rechazo');
  SELECT count(*) INTO v_pend FROM public.avisos_por_correo_pendientes() WHERE org_id = v_org;
  ASSERT v_pend = 1, 'un envío fallido sacó el aviso de la cola: nadie lo recibió y nadie lo sabe';

  -- ── e. Y uno exitoso sí ─────────────────────────────────────────────────
  PERFORM public.aviso_correo_registrar(
    (SELECT id FROM public.notifications WHERE org_id = v_org LIMIT 1), true);
  SELECT count(*) INTO v_pend FROM public.avisos_por_correo_pendientes() WHERE org_id = v_org;
  ASSERT v_pend = 0, 'un aviso ya enviado sigue en la cola: se manda dos veces';

  -- ── f. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.notifications WHERE org_id = v_org;
  DELETE FROM public.memberships   WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_restos FROM public.organizations WHERE name = 'ZZ trial';
  ASSERT v_restos = 0, 'quedaron restos ZZ';

  RAISE NOTICE 'OK: avisa una vez, no repite, y un envío fallido no cuenta como enviado';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000230', 'los_avisos_importantes_llegan_por_correo')
ON CONFLICT DO NOTHING;
