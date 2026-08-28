-- Dos avisos que sólo vivían dentro de la app pasan a salir por correo
--
-- ── Lo que se midió el 2026-08-28 ─────────────────────────────────────────
--
-- La cadena «aviso marcado → cola → correo → constancia» **funciona**:
-- verificada de punta a punta creando un aviso ZZ, corriendo
-- `avisos-por-correo` y comprobando que devuelve `enviados: 1` y estampa
-- `email_enviado_at` para no reenviarlo. El aviso ZZ se borró.
--
-- ⚠️ Pero `notifications` tenía **0 filas** con `enviar_por_correo = true`, y
-- de las cuatro funciones que crean avisos sólo dos lo piden —acceso de
-- soporte y trial por vencer—, y ninguna de las dos se disparó nunca. O sea
-- que el mecanismo existía sin haberse usado una sola vez.
--
-- ── Los dos que faltaban, y por qué éstos ─────────────────────────────────
--
-- El criterio no es «qué es importante»: es **dónde la persona puede leerlo**.
--
--   1. `aplicar_limites_del_plan` avisa «suspendimos el acceso de N personas».
--      ⚠️ La persona suspendida **no puede entrar** a leer un aviso dentro de
--      la app — es literalmente lo que acaba de perder. Y el dueño puede tardar
--      días en abrirla.
--
--   2. `trg_avisar_cambio_de_precio` avisa un cambio de precio con 30 días de
--      preaviso. ⚠️ Un preaviso que sólo vive adentro **no es un preaviso**: si
--      el comercio no entra ese mes, se entera cuando ya le cobraron de más.
--      Y el preaviso de 30 días existe justamente para que pueda decidir antes.
--
-- 📌 **Lo que NO se manda por correo, y por qué.** Las alertas operativas
-- —stock bajo, cliente inactivo, margen— se quedan adentro. Son diarias y
-- repetitivas: mandarlas por mail convierte a Gestiona en algo que el comercio
-- filtra a la papelera, y ahí se pierden también las dos de arriba. Cuando haya
-- preferencias de notificación por comercio se puede revisar; hoy, elegir por
-- él sería elegir mal.

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
      'plan', 'plan_limit', NULL,
      -- ⚠️ Por correo: la persona que quedó suspendida NO PUEDE ENTRAR a leer
      -- un aviso dentro de la app, y el dueño puede tardar días en abrirla. Un
      -- aviso que sólo vive adentro no avisa.
      true);
  END IF;

  RETURN jsonb_build_object('max_users', v_max,
                            'suspendidos', v_suspendidos, 'liberados', v_liberados);
END $$;

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
    'suscripcion', 'price_change', NEW.id,
    -- ⚠️ Por correo: un preaviso de 30 días que sólo vive dentro de la app no
    -- es un preaviso. Si el comercio no entra ese mes, se entera cuando ya le
    -- cobraron de más.
    true);

  RETURN NEW;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_piden int;
BEGIN
  -- ── a. Las dos ahora piden correo ───────────────────────────────────────
  SELECT count(*) INTO v_piden
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('aplicar_limites_del_plan', 'trg_avisar_cambio_de_precio')
     AND pg_get_functiondef(p.oid) ~ 'avisar_a_los_que_mandan[^;]*true';
  ASSERT v_piden = 2,
    'sólo ' || v_piden || ' de 2 piden el envío por correo';

  -- ── b. ⚠️ Y las cuatro siguen llamando a la función que existe ──────────
  -- `CREATE OR REPLACE` no cambia una firma: si el argumento nuevo hubiera
  -- creado otra sobrecarga, la llamada quedaría ambigua y el trigger de
  -- `subscriptions` volvería a abortar el alta — que es como se rompió
  -- contratar un plan el 2026-08-27.
  SELECT count(*) INTO v_piden
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'avisar_a_los_que_mandan';
  ASSERT v_piden = 1,
    'quedaron ' || v_piden || ' firmas de avisar_a_los_que_mandan';

  -- ── c. Y aplicar_limites_del_plan sigue corriendo ───────────────────────
  PERFORM public.aplicar_limites_del_plan(
    (SELECT org_id FROM public.memberships LIMIT 1));

  RAISE NOTICE 'OK: la suspensión y el cambio de precio salen por correo';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000100', 'el_aviso_llega_donde_se_puede_leer')
ON CONFLICT DO NOTHING;
