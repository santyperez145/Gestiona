-- ═══════════════════════════════════════════════════════════════════════════
-- H2 — Eventos durables con outbox
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hoy, cuando se confirma una orden, quien la confirma tiene que acordarse de
-- avisarle a stock, al CRM, a marketing y a los emails. Cada consumidor nuevo
-- es una edición en el centro. Eso no escala ni en código ni en gente: la
-- función que crea la orden termina sabiendo de email, de WhatsApp y de
-- analítica, y cualquiera de esas cosas puede hacerla fallar.
--
-- ── Por qué outbox y no "mandar el evento después" ────────────────────────
--
-- Porque "después" tiene un agujero. Si se hace
--
--     COMMIT;        -- la orden ya está
--     notificar();   -- ← se cae acá
--
-- la orden existe y nadie se enteró, para siempre. Y si se hace al revés, se
-- notifica una orden que después no se guardó. **No hay orden de esas dos
-- operaciones que sea correcto**, porque son dos sistemas distintos sin una
-- transacción común.
--
-- El outbox lo resuelve moviendo el problema adentro de la base: el evento se
-- **persiste en la misma transacción** que el cambio. Si la orden se guardó, el
-- evento está. Si la transacción se cayó, no está ninguno de los dos. Después
-- un worker lo entrega, con reintentos, y eso ya puede fallar tranquilo.
--
-- Es el mismo principio que ya salvó al inventario: `stock_movements` es la
-- verdad y el stock se deriva. Acá `domain_events` es la verdad y las
-- notificaciones se derivan.
--
-- ── Las tres tablas y qué hace cada una ───────────────────────────────────
--
--   domain_events        qué pasó en el negocio. Append-only, es la verdad.
--   event_subscriptions  quién escucha qué. Un consumidor nuevo es una FILA.
--   outbox_events        qué falta entregar. Es una cola, se vacía.
--
-- La del medio es la que hace que esto escale: agregar "cuando se paga una
-- orden, avisale a este webhook" deja de ser una edición en el centro y pasa a
-- ser un INSERT.
--
-- ── Lo que este motor NO es ───────────────────────────────────────────────
--
-- No es event sourcing: el estado sigue viviendo en sus tablas y se lee
-- normalmente. `domain_events` registra lo que pasó, no es la fuente desde la
-- que se reconstruye todo. Cambiar eso sería reescribir el sistema, y
-- `docs/ARQUITECTURA.md` dice explícitamente que no autoriza una reescritura.
--
-- No garantiza entrega **exactamente una vez**: eso no existe sobre HTTP. Lo
-- que garantiza es **al menos una vez**, con orden por agregado, y por eso cada
-- entrega lleva el `event_id` — para que quien recibe pueda descartar
-- repetidos. Es lo mismo que hacen Stripe y MercadoPago con sus webhooks.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Qué pasó — el log, que es la verdad ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.domain_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL,
  -- Qué tipo de cosa cambió y cuál. Con esto se lee la historia de una orden
  -- sin saber nada del resto del sistema.
  aggregate_type text        NOT NULL,
  aggregate_id   uuid        NOT NULL,
  -- 'orden.creada', 'orden.pagada', 'stock.movido'. Dominio.acción, en pasado:
  -- un evento es algo que YA ocurrió. Si se lee como una orden —'crear.orden'—
  -- es un comando disfrazado, y un comando puede rechazarse; un evento no.
  event_type     text        NOT NULL,
  -- Versión dentro del agregado: 1, 2, 3… Da orden total por agregado y deja
  -- detectar un evento perdido, que si no es invisible.
  version        bigint      NOT NULL,
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Quién lo causó y por qué. `correlation_id` une todo lo que salió de la
  -- misma acción del usuario; `causation_id` dice qué evento provocó a éste.
  -- Sin esto, depurar una cadena de siete eventos es adivinar.
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  recorded_at    timestamptz NOT NULL DEFAULT now()
);

-- Dos eventos con la misma versión del mismo agregado significa que dos
-- transacciones creyeron ser la siguiente. Es exactamente la condición de
-- carrera que hay que detectar, no ignorar.
CREATE UNIQUE INDEX IF NOT EXISTS domain_events_version_unica
  ON public.domain_events (aggregate_type, aggregate_id, version);

CREATE INDEX IF NOT EXISTS domain_events_agregado_idx
  ON public.domain_events (aggregate_type, aggregate_id, version DESC);
CREATE INDEX IF NOT EXISTS domain_events_org_tiempo_idx
  ON public.domain_events (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS domain_events_tipo_idx
  ON public.domain_events (org_id, event_type, occurred_at DESC);

COMMENT ON TABLE public.domain_events IS
  'Que paso en el negocio. Append-only: la historia no se corrige, se agrega un evento que la compensa.';

-- ⚠️ Append-only de verdad, no por disciplina.
--
-- Un UPDATE sobre un evento reescribe la historia y un DELETE la borra. Las dos
-- cosas rompen todo lo que se derive de acá. Si algo se registró mal, se emite
-- un evento que lo compensa — igual que un contraasiento.
CREATE OR REPLACE FUNCTION public.trg_domain_events_solo_agregar()
RETURNS trigger LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION
    'domain_events es append-only: % no esta permitido. Para corregir, emitir un evento compensatorio.',
    TG_OP
    USING ERRCODE = '42501';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_domain_events_inmutable ON public.domain_events;
CREATE TRIGGER trg_domain_events_inmutable
  BEFORE UPDATE OR DELETE ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_domain_events_solo_agregar();

-- La historia del negocio es del comercio: la puede leer, nunca escribir.
-- Escribir es potestad de `emitir_evento`, que es SECURITY DEFINER.
ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS domain_events_lectura_org ON public.domain_events;
CREATE POLICY domain_events_lectura_org ON public.domain_events
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- ── 2. Quién escucha — el consumidor nuevo es una fila ─────────────────────

CREATE TABLE IF NOT EXISTS public.event_subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = escucha a todas las organizaciones. Sirve para lo de plataforma
  -- —métricas, antifraude— sin crear una fila por comercio.
  org_id       uuid,
  nombre       text        NOT NULL,
  -- Patrón LIKE sobre `event_type`: 'orden.%' escucha todo lo de órdenes. Un
  -- patrón y no una lista porque los tipos nuevos aparecen solos.
  patron       text        NOT NULL,
  destino      text        NOT NULL CHECK (destino IN ('edge_function', 'webhook', 'interno')),
  -- Nombre de la Edge Function, URL del webhook, o nombre de la función SQL.
  objetivo     text        NOT NULL,
  config       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_active    boolean     NOT NULL DEFAULT true,
  max_intentos int         NOT NULL DEFAULT 8 CHECK (max_intentos BETWEEN 1 AND 20),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_subscriptions_unica
  ON public.event_subscriptions
     (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), nombre);

CREATE INDEX IF NOT EXISTS event_subscriptions_activas_idx
  ON public.event_subscriptions (is_active) WHERE is_active;

COMMENT ON TABLE public.event_subscriptions IS
  'Quien escucha que. Agregar un consumidor es un INSERT, no una edicion en el centro del sistema.';

ALTER TABLE public.event_subscriptions ENABLE ROW LEVEL SECURITY;

-- Un comercio maneja sus propias suscripciones; las globales (org_id NULL) son
-- de plataforma y no se le muestran.
DROP POLICY IF EXISTS event_subscriptions_org ON public.event_subscriptions;
CREATE POLICY event_subscriptions_org ON public.event_subscriptions
  FOR ALL USING (org_id IS NOT NULL AND public.is_org_member(org_id, auth.uid()))
  WITH CHECK (org_id IS NOT NULL AND public.is_org_member(org_id, auth.uid()));

-- ── 3. Qué falta entregar — la cola ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.outbox_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL,
  event_id        uuid        NOT NULL REFERENCES public.domain_events(id) ON DELETE CASCADE,
  subscription_id uuid        REFERENCES public.event_subscriptions(id) ON DELETE CASCADE,
  event_type      text        NOT NULL,
  destino         text        NOT NULL,
  objetivo        text        NOT NULL,
  payload         jsonb       NOT NULL,
  estado          text        NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'en_curso', 'entregado', 'fallado', 'descartado')),
  intentos        int         NOT NULL DEFAULT 0,
  max_intentos    int         NOT NULL DEFAULT 8,
  -- Cuándo volver a intentar. El worker sólo mira lo que ya venció, así que el
  -- backoff no necesita que nadie duerma.
  proximo_intento timestamptz NOT NULL DEFAULT now(),
  ultimo_error    text,
  -- Quién lo tomó y cuándo. Sin esto, un worker que se muere deja la fila en
  -- `en_curso` para siempre — que es peor que el problema original.
  tomado_por      text,
  tomado_at       timestamptz,
  -- `request_id` de pg_net: la entrega HTTP es asincrónica, así que mandar no
  -- es lo mismo que entregar. La confirmación llega en una segunda pasada.
  request_id      bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  entregado_at    timestamptz
);

-- El índice que usa el worker en cada pasada. Parcial: lo entregado no se mira
-- nunca más y son la mayoría de las filas.
CREATE INDEX IF NOT EXISTS outbox_events_pendientes_idx
  ON public.outbox_events (proximo_intento, id)
  WHERE estado IN ('pendiente', 'fallado');

CREATE INDEX IF NOT EXISTS outbox_events_en_curso_idx
  ON public.outbox_events (tomado_at) WHERE estado = 'en_curso';

CREATE INDEX IF NOT EXISTS outbox_events_evento_idx
  ON public.outbox_events (event_id);

COMMENT ON TABLE public.outbox_events IS
  'Cola de entrega. Se escribe en la MISMA transaccion que el cambio: si el cambio se guardo, el evento esta.';

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

-- Sólo lectura para el comercio: le sirve para ver si sus webhooks andan. La
-- escritura es del worker, que corre como SECURITY DEFINER.
DROP POLICY IF EXISTS outbox_events_lectura_org ON public.outbox_events;
CREATE POLICY outbox_events_lectura_org ON public.outbox_events
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- ── 4. Emitir — lo único que escribe la historia ───────────────────────────
--
-- Se llama **adentro** de la transacción que hace el cambio. No después.
--
-- La versión la calcula esta función y no la manda quien llama: si la mandara,
-- dos transacciones concurrentes elegirían la misma y una fallaría por el
-- índice único. Con un candado por agregado, la segunda espera y toma la
-- siguiente.

CREATE OR REPLACE FUNCTION public.emitir_evento(
  p_org            uuid,
  p_aggregate_type text,
  p_aggregate_id   uuid,
  p_event_type     text,
  p_payload        jsonb DEFAULT '{}'::jsonb,
  p_metadata       jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_version bigint;
  v_id      uuid;
  v_sub     record;
  v_meta    jsonb;
BEGIN
  IF p_org IS NULL OR p_aggregate_id IS NULL OR btrim(COALESCE(p_event_type, '')) = '' THEN
    RAISE EXCEPTION 'emitir_evento: faltan organizacion, agregado o tipo de evento';
  END IF;

  -- Un evento se lee en pasado porque ya ocurrió. Se valida la forma para que
  -- el vocabulario no se degrade a mano: 'dominio.accion'.
  IF p_event_type !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'emitir_evento: el tipo "%" no tiene la forma dominio.accion', p_event_type;
  END IF;

  -- Candado por agregado. `hashtextextended` da un bigint estable desde el
  -- uuid; el candado se libera solo al terminar la transacción.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_aggregate_type || ':' || p_aggregate_id::text, 0));

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.domain_events
   WHERE aggregate_type = p_aggregate_type AND aggregate_id = p_aggregate_id;

  -- Quien no pase correlación arranca una nueva: el evento siempre pertenece a
  -- alguna cadena, aunque sea de un solo eslabón.
  v_meta := COALESCE(p_metadata, '{}'::jsonb);
  IF v_meta->>'correlation_id' IS NULL THEN
    v_meta := v_meta || jsonb_build_object('correlation_id', gen_random_uuid());
  END IF;
  IF auth.uid() IS NOT NULL AND v_meta->>'actor' IS NULL THEN
    v_meta := v_meta || jsonb_build_object('actor', auth.uid());
  END IF;

  INSERT INTO public.domain_events (
    org_id, aggregate_type, aggregate_id, event_type, version, payload, metadata)
  VALUES (
    p_org, p_aggregate_type, p_aggregate_id, p_event_type, v_version,
    COALESCE(p_payload, '{}'::jsonb), v_meta)
  RETURNING id INTO v_id;

  -- ── Fan-out ─────────────────────────────────────────────────────────────
  -- Una fila de cola por suscripción que matchee, acá y no al entregar. Así una
  -- suscripción creada mañana no recibe los eventos de ayer, que es lo
  -- predecible: quien se suscribe espera lo que pase de ahora en adelante.
  FOR v_sub IN
    SELECT s.* FROM public.event_subscriptions s
     WHERE s.is_active
       AND (s.org_id IS NULL OR s.org_id = p_org)
       AND p_event_type LIKE s.patron
  LOOP
    INSERT INTO public.outbox_events (
      org_id, event_id, subscription_id, event_type, destino, objetivo,
      payload, max_intentos)
    VALUES (
      p_org, v_id, v_sub.id, p_event_type, v_sub.destino, v_sub.objetivo,
      jsonb_build_object(
        'event_id',       v_id,
        'event_type',     p_event_type,
        'aggregate_type', p_aggregate_type,
        'aggregate_id',   p_aggregate_id,
        'version',        v_version,
        'org_id',         p_org,
        'occurred_at',    now(),
        'data',           COALESCE(p_payload, '{}'::jsonb),
        'metadata',       v_meta),
      v_sub.max_intentos);
  END LOOP;

  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.emitir_evento IS
  'Escribe el evento y encola su entrega en la MISMA transaccion que el cambio. Llamar adentro, nunca despues del commit.';

-- ── 5. El backoff ──────────────────────────────────────────────────────────
--
-- Exponencial con techo. Sin techo, el intento 15 caería dentro de un año; sin
-- exponencial, un destino caído recibe un martillazo por segundo justo cuando
-- menos lo aguanta.
--
-- Espejo de `esperaDeReintento` en src/lib/outbox.ts.

CREATE OR REPLACE FUNCTION public.outbox_espera(p_intentos int)
RETURNS interval LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT make_interval(secs =>
    LEAST(power(2, GREATEST(COALESCE(p_intentos, 0), 0))::numeric * 30, 3600)::double precision);
$fn$;

-- ── 6. Tomar trabajo ───────────────────────────────────────────────────────
--
-- `FOR UPDATE SKIP LOCKED` es lo que permite que corran varios workers sin
-- pisarse: cada uno se lleva filas distintas en vez de esperar al otro.

CREATE OR REPLACE FUNCTION public.outbox_tomar(
  p_limite int  DEFAULT 50,
  p_worker text DEFAULT 'cron'
) RETURNS SETOF public.outbox_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  -- Rescate de lo trabado: un worker que se murió con la fila tomada. Sin esto
  -- esa fila no se entrega nunca y nadie se entera.
  UPDATE public.outbox_events
     SET estado = 'fallado',
         ultimo_error = COALESCE(ultimo_error, 'el worker no confirmo en 5 minutos'),
         proximo_intento = now(),
         tomado_por = NULL, tomado_at = NULL
   WHERE estado = 'en_curso' AND tomado_at < now() - interval '5 minutes';

  RETURN QUERY
  WITH elegidas AS (
    SELECT o.id FROM public.outbox_events o
     WHERE o.estado IN ('pendiente', 'fallado')
       AND o.proximo_intento <= now()
     ORDER BY o.proximo_intento, o.id
     LIMIT GREATEST(COALESCE(p_limite, 50), 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outbox_events o
     SET estado = 'en_curso',
         intentos = o.intentos + 1,
         tomado_por = p_worker,
         tomado_at = now()
    FROM elegidas e
   WHERE o.id = e.id
  RETURNING o.*;
END;
$fn$;

-- ── 7. Confirmar o fallar ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.outbox_entregado(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $fn$
  UPDATE public.outbox_events
     SET estado = 'entregado', entregado_at = now(),
         ultimo_error = NULL, tomado_por = NULL, tomado_at = NULL
   WHERE id = p_id;
$fn$;

CREATE OR REPLACE FUNCTION public.outbox_fallado(p_id uuid, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_fila public.outbox_events;
BEGIN
  SELECT * INTO v_fila FROM public.outbox_events WHERE id = p_id;
  IF v_fila.id IS NULL THEN RETURN; END IF;

  -- Agotados los intentos pasa a `descartado` y **se queda ahí, con el error**.
  -- Borrarlo sería perder la única evidencia de que algo no llegó; reintentarlo
  -- para siempre sería tapar la cola con lo que nunca va a andar.
  IF v_fila.intentos >= v_fila.max_intentos THEN
    UPDATE public.outbox_events
       SET estado = 'descartado', ultimo_error = p_error,
           tomado_por = NULL, tomado_at = NULL
     WHERE id = p_id;
    RAISE WARNING 'outbox: evento % descartado tras % intentos: %',
      v_fila.event_type, v_fila.intentos, p_error;
    RETURN;
  END IF;

  UPDATE public.outbox_events
     SET estado = 'fallado', ultimo_error = p_error,
         proximo_intento = now() + public.outbox_espera(v_fila.intentos),
         tomado_por = NULL, tomado_at = NULL
   WHERE id = p_id;
END;
$fn$;

-- Reintento manual desde el panel: devuelve a la cola algo descartado, con los
-- intentos en cero. Es la salida cuando se arregló el destino.
CREATE OR REPLACE FUNCTION public.outbox_reintentar(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.outbox_events WHERE id = p_id;
  IF v_org IS NULL THEN RETURN false; END IF;
  IF NOT public.is_org_member(v_org, auth.uid()) AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre ese evento';
  END IF;

  UPDATE public.outbox_events
     SET estado = 'pendiente', intentos = 0, proximo_intento = now(),
         ultimo_error = NULL, tomado_por = NULL, tomado_at = NULL
   WHERE id = p_id;
  RETURN true;
END;
$fn$;

-- ── 8. Observabilidad — principio 11 ───────────────────────────────────────
--
-- Una cola sin tablero es una cola que se tapa en silencio. Lo que importa no
-- es cuántas hay pendientes sino **hace cuánto está la más vieja**: mil
-- pendientes de hace dos segundos es un pico normal; una sola de hace seis
-- horas es un incidente.

CREATE OR REPLACE VIEW public.outbox_salud AS
SELECT
  o.org_id,
  count(*) FILTER (WHERE o.estado = 'pendiente')  AS pendientes,
  count(*) FILTER (WHERE o.estado = 'en_curso')   AS en_curso,
  count(*) FILTER (WHERE o.estado = 'fallado')    AS fallados,
  count(*) FILTER (WHERE o.estado = 'descartado') AS descartados,
  count(*) FILTER (WHERE o.estado = 'entregado')  AS entregados,
  max(EXTRACT(epoch FROM now() - o.created_at) / 60)
    FILTER (WHERE o.estado IN ('pendiente', 'fallado', 'en_curso')) AS minutos_del_mas_viejo,
  max(o.entregado_at) AS ultima_entrega
FROM public.outbox_events o
WHERE public.is_org_member(o.org_id, auth.uid())
GROUP BY o.org_id;

COMMENT ON VIEW public.outbox_salud IS
  'Estado de la cola por organizacion. Lo que importa es minutos_del_mas_viejo: una sola fila de hace seis horas es un incidente.';

GRANT SELECT ON public.outbox_salud TO authenticated;

-- ── 9. Retención ───────────────────────────────────────────────────────────
--
-- Lo entregado no se mira nunca más y son la mayoría de las filas. Lo
-- descartado se conserva mucho más: es evidencia de algo que no llegó.

CREATE OR REPLACE FUNCTION public.outbox_limpiar()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_n int;
BEGIN
  DELETE FROM public.outbox_events
   WHERE estado = 'entregado' AND entregado_at < now() - interval '7 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM public.outbox_events
   WHERE estado = 'descartado' AND created_at < now() - interval '90 days';

  RETURN v_n;
END;
$fn$;
