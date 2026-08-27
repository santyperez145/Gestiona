-- Lo que el staff hace sobre un comercio, el comercio se entera
--
-- ── Por qué ───────────────────────────────────────────────────────────────
--
-- ⚠️ `support_diagnostic_access_requests` (que la consola lee por la vista
-- `platform_support_diagnostic_requests`) registra cuándo el staff de la
-- plataforma pide acceso al diagnóstico de un comercio, lo aprueba y lo mira.
-- Existe la tabla, existe la pantalla del staff y existe una auditoría en
-- Ajustes del comercio. **Lo que no existía era el aviso.**
--
-- O sea: alguien de afuera del negocio entra a mirar los datos, y el dueño se
-- entera sólo si se le ocurre abrir una pantalla de auditoría que nadie abre.
-- Un registro que hay que ir a buscar no es transparencia: es una constancia
-- para después.
--
-- 📌 Este es el patrón general que faltaba, y no sólo para soporte: **cuando
-- algo pasa sobre el negocio de otro, se avisa donde esa persona está
-- mirando**, no en una pantalla de configuración. La campanita ya existe
-- (`notifications`, 132 filas), sólo que nadie la usaba para esto.
--
-- ⚠️ Y el aviso va a los DUEÑOS Y ADMINISTRADORES, no a todo el equipo: que un
-- vendedor vea «el soporte está mirando tus datos» no le sirve y agrega ruido a
-- la única campanita que tiene.

CREATE OR REPLACE FUNCTION public.avisar_a_los_que_mandan(
  p_org uuid, p_titulo text, p_mensaje text, p_tipo text,
  p_entidad text DEFAULT NULL, p_entidad_id uuid DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
  SELECT m.user_id, p_org, p_titulo, p_mensaje, p_tipo, p_entidad, p_entidad_id
    FROM public.memberships m
   WHERE m.org_id = p_org
     AND m.role IN ('owner', 'admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

COMMENT ON FUNCTION public.avisar_a_los_que_mandan(uuid, text, text, text, text, uuid) IS
  'Deja un aviso en la campanita de los dueños y administradores de un '
  'comercio. Para hechos que afectan al negocio y que hoy sólo quedaban '
  'registrados en una pantalla que nadie abre.';

REVOKE ALL ON FUNCTION public.avisar_a_los_que_mandan(uuid, text, text, text, text, uuid)
  FROM public, anon;

-- ── El aviso de acceso de soporte ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_avisar_acceso_de_soporte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Se pide acceso: el comercio se entera en el momento, no después.
  IF TG_OP = 'INSERT' THEN
    PERFORM public.avisar_a_los_que_mandan(
      NEW.org_id,
      'El soporte de Gestiona pidió acceso a tu diagnóstico',
      'Un integrante del equipo de soporte solicitó ver el estado técnico de tu '
      || 'negocio para ayudarte. No incluye tus contraseñas ni tus medios de cobro. '
      || 'Podés ver el detalle y el historial en Ajustes.',
      'soporte', 'support_access', NEW.id);
    RETURN NEW;
  END IF;

  -- Y cuando efectivamente entra a mirar, también. ⚠️ Avisar sólo el pedido y
  -- no el acceso dejaría el hecho más importante sin avisar.
  IF TG_OP = 'UPDATE'
     AND NEW.approved_at IS NOT NULL AND OLD.approved_at IS NULL THEN
    PERFORM public.avisar_a_los_que_mandan(
      NEW.org_id,
      'El soporte ya puede ver tu diagnóstico',
      'El acceso quedó habilitado'
      || COALESCE(' hasta el ' || to_char(NEW.expires_at, 'DD/MM/YYYY'), '')
      || '. Podés revocarlo cuando quieras desde Ajustes.',
      'soporte', 'support_access', NEW.id);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_avisar_acceso_de_soporte
  ON public.support_diagnostic_access_requests;
CREATE TRIGGER trg_avisar_acceso_de_soporte
  AFTER INSERT OR UPDATE ON public.support_diagnostic_access_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_avisar_acceso_de_soporte();

-- ── El aviso de cambio de precio ──────────────────────────────────────────
--
-- 📌 El mail es el aviso formal, pero un mail se pierde: cae en promociones o
-- lo recibe una casilla que nadie mira. La campanita es donde el comercio está
-- cuando trabaja.

CREATE OR REPLACE FUNCTION public.trg_avisar_cambio_de_precio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_desde date; v_sube boolean;
BEGIN
  SELECT c.vigente_desde INTO v_desde
    FROM public.plan_price_changes c WHERE c.id = NEW.cambio_id;
  v_sube := NEW.precio_nuevo > COALESCE(NEW.precio_anterior, 0);

  PERFORM public.avisar_a_los_que_mandan(
    NEW.org_id,
    CASE WHEN v_sube THEN 'Tu suscripción cambia de precio'
         ELSE 'Tu suscripción baja de precio' END,
    'Desde el ' || to_char(v_desde, 'DD/MM/YYYY') || ' vas a pagar $'
    || trim(to_char(NEW.precio_nuevo, 'FM999G999G999'))
    || '. Podés ver el detalle, cambiar de plan o darte de baja en Mi plan.',
    'suscripcion', 'price_change', NEW.id);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_avisar_cambio_de_precio ON public.plan_price_change_targets;
CREATE TRIGGER trg_avisar_cambio_de_precio
  AFTER INSERT ON public.plan_price_change_targets
  FOR EACH ROW EXECUTE FUNCTION public.trg_avisar_cambio_de_precio();

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_user  uuid;
  v_otro  uuid;
  v_staff uuid;
  v_sol   uuid := gen_random_uuid();
  v_avisos int;
  v_al_vendedor int;
  v_restos int;
BEGIN
  SELECT user_id INTO v_user  FROM public.memberships LIMIT 1;
  SELECT user_id INTO v_staff FROM public.platform_admins LIMIT 1;
  -- Un segundo usuario para el rol vendedor: tiene que quedar SIN aviso.
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_user LIMIT 1;

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ avisos', 'zz-av-'||substr(v_org::text,1,8), v_user);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  IF v_otro IS NOT NULL THEN
    INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_otro, 'vendedor');
  END IF;

  -- ── a. Pedir acceso avisa ───────────────────────────────────────────────
  INSERT INTO public.support_diagnostic_access_requests
    (id, org_id, requested_by, reason_code)
  VALUES (v_sol, v_org, v_staff, 'incident');

  SELECT count(*) INTO v_avisos FROM public.notifications
   WHERE org_id = v_org AND entity_type = 'support_access';
  ASSERT v_avisos >= 1,
    'el comercio no se entera de que el soporte pidió ver sus datos';

  -- ── b. ⚠️ Y al vendedor NO le llega ─────────────────────────────────────
  -- Sin esta mitad, un aviso demasiado ancho pasaria (a) igual y llenaría de
  -- ruido la única campanita que tiene quien atiende el mostrador.
  IF v_otro IS NOT NULL THEN
    SELECT count(*) INTO v_al_vendedor FROM public.notifications
     WHERE org_id = v_org AND user_id = v_otro;
    ASSERT v_al_vendedor = 0,
      'el aviso de soporte le llegó también al vendedor';
  END IF;

  -- ── c. Aprobar avisa de nuevo ───────────────────────────────────────────
  UPDATE public.support_diagnostic_access_requests
     SET approved_at = now(), approved_by = v_staff,
         expires_at = now() + interval '2 days'
   WHERE id = v_sol;

  SELECT count(*) INTO v_avisos FROM public.notifications
   WHERE org_id = v_org AND entity_type = 'support_access';
  ASSERT v_avisos >= 2, 'no se avisó cuando el acceso quedó habilitado';

  -- ── d. ⚠️ Y un UPDATE que no aprueba nada NO avisa ──────────────────────
  UPDATE public.support_diagnostic_access_requests
     SET view_count = COALESCE(view_count, 0) + 1 WHERE id = v_sol;
  SELECT count(*) INTO v_al_vendedor FROM public.notifications
   WHERE org_id = v_org AND entity_type = 'support_access';
  ASSERT v_al_vendedor = v_avisos,
    'cada vez que el staff mira, el comercio recibe un aviso nuevo: eso es ruido';

  -- ── e. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.notifications WHERE org_id = v_org;
  DELETE FROM public.support_diagnostic_access_requests WHERE id = v_sol;
  DELETE FROM public.memberships   WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_restos FROM public.organizations WHERE name = 'ZZ avisos';
  ASSERT v_restos = 0, 'quedaron restos ZZ';

  RAISE NOTICE 'OK: avisa al pedir y al aprobar, no al vendedor, y no en cada vista';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000210', 'lo_que_el_staff_hace_se_avisa')
ON CONFLICT DO NOTHING;
