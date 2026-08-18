-- H1 — idempotencia en las mutaciones críticas.
--
-- ── El problema, que todavía no se vio pero está ─────────────────────────
--
-- Un checkout puede llegar dos veces: reintento del navegador, timeout que en
-- realidad completó, doble clic, un proxy que reintenta, la app móvil, un
-- webhook duplicado. Hoy nada impide que eso cree dos órdenes y cobre dos
-- veces.
--
-- No es hipotético en este repo: el descuento de stock duplicado —vender 3 y
-- que bajaran 6— vivió meses sin que nadie lo viera. La forma del bug es
-- exactamente ésta: una operación que corre dos veces y produce un número
-- plausible.
--
-- ── Las tres decisiones que hacen que esto sirva ─────────────────────────
--
-- **1. La misma clave con distinto contenido es un ERROR, no un acierto.**
-- Es la parte contraintuitiva. Si alguien manda la clave `abc` con un carrito
-- y después la misma clave `abc` con otro carrito, devolver calladamente la
-- respuesta vieja sería cobrarle lo que no pidió. Se guarda un hash del pedido
-- y se compara: si difiere, se rechaza. Un cliente que reusa claves tiene un
-- bug, y hay que decírselo.
--
-- **2. `en_curso` existe para frenar la carrera, no para informar.** Entre que
-- empieza el primer checkout y termina, el segundo llega. Sin un estado
-- intermedio los dos ven "no hay nada" y los dos ejecutan. La fila se inserta
-- ANTES de hacer el trabajo, así que el segundo choca contra la PK.
--
-- **3. Las claves vencen.** Sin vencimiento la tabla crece para siempre y una
-- clave de hace un año bloquearía una operación legítima. 24 horas cubre de
-- sobra cualquier reintento real.
--
-- ── Lo que NO hace ───────────────────────────────────────────────────────
--
-- No serializa operaciones distintas: la clave es por (organización, operación,
-- clave). Dos checkouts genuinamente distintos tienen claves distintas y corren
-- en paralelo.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  org_id       uuid        NOT NULL,
  operacion    text        NOT NULL,
  clave        text        NOT NULL,
  request_hash text        NOT NULL,
  estado       text        NOT NULL DEFAULT 'en_curso'
                 CHECK (estado IN ('en_curso', 'completada', 'fallida')),
  respuesta    jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (org_id, operacion, clave)
);

COMMENT ON TABLE public.idempotency_keys IS
  'Evita que una mutacion critica se ejecute dos veces. La misma clave con distinto request_hash es un error, no un acierto: devolver la respuesta vieja seria cobrar lo que el cliente no pidio.';

CREATE INDEX IF NOT EXISTS idempotency_keys_vencidas_idx
  ON public.idempotency_keys(expires_at);

-- RLS habilitada y sin policies: esta tabla la tocan funciones SECURITY
-- DEFINER, nunca el cliente. Es el mismo criterio que las tablas de
-- credenciales.
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- ── Reservar la clave ────────────────────────────────────────────────────
--
-- Devuelve `{ejecutar:true}` cuando hay que hacer el trabajo, o
-- `{ejecutar:false, respuesta:...}` cuando ya se hizo.
CREATE OR REPLACE FUNCTION public.idempotencia_reservar(
  p_org       uuid,
  p_operacion text,
  p_clave     text,
  p_payload   jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_fila public.idempotency_keys;
BEGIN
  -- Sin clave no hay idempotencia y se ejecuta como siempre. Es deliberado:
  -- obligar a mandarla rompería todos los caminos existentes de una vez.
  IF p_clave IS NULL OR btrim(p_clave) = '' THEN
    RETURN jsonb_build_object('ejecutar', true, 'protegida', false);
  END IF;

  -- md5 y no sha256: `digest` vive en el esquema `extensions` y no esta en el
  -- search_path de una funcion SECURITY DEFINER. Aca el hash sirve para
  -- detectar que el pedido es otro, no para proteger nada, asi que alcanza.
  v_hash := md5(COALESCE(p_payload, '{}'::jsonb)::text);

  -- Se limpia lo vencido de paso: barato y evita un cron sólo para esto.
  DELETE FROM public.idempotency_keys
   WHERE org_id = p_org AND operacion = p_operacion AND expires_at < now();

  SELECT * INTO v_fila FROM public.idempotency_keys
   WHERE org_id = p_org AND operacion = p_operacion AND clave = p_clave;

  IF v_fila.clave IS NOT NULL THEN
    -- Misma clave, distinto pedido: es un bug del que llama y hay que decirlo.
    IF v_fila.request_hash <> v_hash THEN
      RAISE EXCEPTION
        'La clave de idempotencia % ya se usó para otra operación distinta', p_clave
        USING ERRCODE = '23505';
    END IF;

    IF v_fila.estado = 'completada' THEN
      RETURN jsonb_build_object(
        'ejecutar', false, 'protegida', true, 'respuesta', v_fila.respuesta);
    END IF;

    IF v_fila.estado = 'en_curso' THEN
      RAISE EXCEPTION
        'Esa operación ya está en curso. Esperá a que termine antes de reintentar.'
        USING ERRCODE = '55006';
    END IF;

    -- Falló antes: se permite reintentar, reusando la fila.
    UPDATE public.idempotency_keys
       SET estado = 'en_curso', error = NULL, completed_at = NULL,
           expires_at = now() + interval '24 hours'
     WHERE org_id = p_org AND operacion = p_operacion AND clave = p_clave;
    RETURN jsonb_build_object('ejecutar', true, 'protegida', true);
  END IF;

  INSERT INTO public.idempotency_keys (org_id, operacion, clave, request_hash)
  VALUES (p_org, p_operacion, p_clave, v_hash);

  RETURN jsonb_build_object('ejecutar', true, 'protegida', true);
END;
$$;

COMMENT ON FUNCTION public.idempotencia_reservar IS
  'Reserva una clave de idempotencia. Devuelve ejecutar=false con la respuesta guardada si ya se hizo. Sin clave, ejecuta como siempre.';

-- ── Guardar el resultado ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.idempotencia_completar(
  p_org       uuid,
  p_operacion text,
  p_clave     text,
  p_respuesta jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.idempotency_keys
     SET estado = 'completada', respuesta = p_respuesta, completed_at = now()
   WHERE org_id = p_org AND operacion = p_operacion
     AND clave = p_clave AND NULLIF(btrim(p_clave), '') IS NOT NULL;
$$;

COMMENT ON FUNCTION public.idempotencia_completar IS
  'Guarda el resultado de una operacion idempotente para que el reintento lo devuelva sin re-ejecutar.';

-- ── Marcarla fallida ─────────────────────────────────────────────────────
--
-- Importa que exista: sin esto, una operación que falla deja la clave en
-- `en_curso` para siempre y el cliente no puede reintentar nunca más.
CREATE OR REPLACE FUNCTION public.idempotencia_fallar(
  p_org       uuid,
  p_operacion text,
  p_clave     text,
  p_error     text
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.idempotency_keys
     SET estado = 'fallida', error = left(COALESCE(p_error, ''), 500),
         completed_at = now()
   WHERE org_id = p_org AND operacion = p_operacion
     AND clave = p_clave AND NULLIF(btrim(p_clave), '') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.idempotencia_reservar(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.idempotencia_completar(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.idempotencia_fallar(uuid, text, text, text) FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_org    uuid;
  v_r      jsonb;
  v_restos int;
  v_error  text;
BEGIN
  SELECT id INTO v_org FROM public.organizations LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'H1: sin organizaciones, no se puede verificar'; RETURN;
  END IF;

  -- 1. Sin clave se ejecuta siempre, como antes.
  v_r := public.idempotencia_reservar(v_org, 'zz_test', NULL, '{"a":1}'::jsonb);
  ASSERT (v_r->>'ejecutar')::boolean AND NOT (v_r->>'protegida')::boolean,
    'sin clave deberia ejecutar sin proteccion';

  -- 2. Primera vez con clave: ejecuta.
  v_r := public.idempotencia_reservar(v_org, 'zz_test', 'k1', '{"a":1}'::jsonb);
  ASSERT (v_r->>'ejecutar')::boolean, 'la primera vez tiene que ejecutar';

  -- 3. Mientras está en curso, el segundo choca en vez de duplicar.
  BEGIN
    v_r := public.idempotencia_reservar(v_org, 'zz_test', 'k1', '{"a":1}'::jsonb);
    RAISE EXCEPTION 'ZZ_FALLO: en_curso deberia frenar el segundo intento';
  EXCEPTION WHEN sqlstate '55006' THEN NULL;
  END;

  -- 4. Completada: el reintento devuelve la respuesta sin re-ejecutar.
  PERFORM public.idempotencia_completar(v_org, 'zz_test', 'k1', '{"orden":"ZZ-1"}'::jsonb);
  v_r := public.idempotencia_reservar(v_org, 'zz_test', 'k1', '{"a":1}'::jsonb);
  ASSERT NOT (v_r->>'ejecutar')::boolean, 'ya completada no deberia re-ejecutar';
  ASSERT v_r->'respuesta'->>'orden' = 'ZZ-1',
    format('deberia devolver la respuesta guardada y devolvio %s', v_r->>'respuesta');

  -- 5. LA IMPORTANTE: misma clave, distinto pedido = error, no respuesta vieja.
  BEGIN
    v_r := public.idempotencia_reservar(v_org, 'zz_test', 'k1', '{"a":999}'::jsonb);
    RAISE EXCEPTION 'ZZ_FALLO: misma clave con otro payload deberia fallar';
  EXCEPTION WHEN sqlstate '23505' THEN NULL;
  END;

  -- 6. Una operacion fallida se puede reintentar.
  v_r := public.idempotencia_reservar(v_org, 'zz_test', 'k2', '{"b":1}'::jsonb);
  PERFORM public.idempotencia_fallar(v_org, 'zz_test', 'k2', 'se cayo el proveedor');
  v_r := public.idempotencia_reservar(v_org, 'zz_test', 'k2', '{"b":1}'::jsonb);
  ASSERT (v_r->>'ejecutar')::boolean, 'una fallida tiene que poder reintentarse';

  DELETE FROM public.idempotency_keys WHERE org_id = v_org AND operacion = 'zz_test';
  SELECT count(*) INTO v_restos FROM public.idempotency_keys WHERE operacion = 'zz_test';
  RAISE NOTICE 'H1 OK. restos: %', v_restos;
  ASSERT v_restos = 0, 'quedaron restos de la prueba';
END;
$verif$;
