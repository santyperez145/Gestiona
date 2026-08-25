-- API pública — la key deja de vivir en texto plano y de nacer en el navegador.
--
-- ── El estado que encontró la auditoría del 2026-08-24, verificado ───────
--
-- Había TRES sistemas de API keys desconectados:
--
--   settings.api_key   texto plano. El ÚNICO que autenticaba. La tabla
--                      `settings` tiene policy SELECT para todos los miembros:
--                      cualquier empleado leía la key y con ella podía crear
--                      ventas, ajustar stock y rotarla. Es el mismo antipatrón
--                      que este repo ya erradicó para AFIP y MercadoPago.
--   org_api_keys       hash SHA-256 correcto. Cero filas, sin backend.
--   api_keys           `key_hash = btoa(key)` — base64, REVERSIBLE con atob().
--                      Cero filas, sin backend. Si algún día autenticaba, nacía
--                      comprometida.
--
-- Y la key se generaba EN EL NAVEGADOR (IntegrationsPage) y se upserteaba a
-- `settings` desde el cliente — contra la regla de que ninguna credencial pasa
-- por el navegador.
--
-- Medido antes de tocar: settings.api_key tiene 0 keys activas y las dos
-- tablas tienen 0 filas. No hay nada que migrar ni nadie que se rompa.
--
-- ── El diseño, como lo hacen los que ya funcionan ────────────────────────
--
-- Stripe y GitHub: la key se emite EN EL SERVIDOR, se muestra UNA sola vez,
-- se guarda sólo el hash, y el prefijo (`gst_live_a1b2…`) permite identificarla
-- en la UI y en un leak sin exponerla.
--
--   · Canónica: `api_keys` (ya tiene prefix, hash, scopes, expiración).
--   · Emisión: `api_key_emitir()` — SECURITY DEFINER, sólo owner/admin.
--   · La key: gst_live_ + 48 hex (192 bits). El hash: sha256 built-in de
--     Postgres (pg_catalog, no depende del esquema extensions).
--   · `org_api_keys` queda deprecada; `settings.api_key` deja de autenticar.
--
-- Idempotente.

-- ── Deprecar los caminos muertos ─────────────────────────────────────────
COMMENT ON TABLE public.org_api_keys IS
  'DEPRECADA (2026-08-24). Nunca autentico nada; la canonica es api_keys. No escribir aca.';

COMMENT ON COLUMN public.settings.api_key IS
  'DEPRECADA (2026-08-24). La API publica autentica contra api_keys.key_hash. Esta columna vivia en texto plano en una tabla que todo miembro lee. Se conserva por compatibilidad de esquema; no se escribe mas.';

-- 0 keys activas medidas; si apareciera alguna entre la medición y la
-- aplicación, se anula igual: el camino viejo deja de autenticar con este
-- deploy y una key vieja colgada sería una llave que abre una puerta tapiada.
UPDATE public.settings SET api_key = NULL WHERE api_key IS NOT NULL;

-- ── Índice de búsqueda por hash ──────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_idx
  ON public.api_keys(key_hash);

-- ── Emisión server-side ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_key_emitir(
  p_org     uuid,
  p_name    text,
  p_scopes  text[] DEFAULT ARRAY['products:read','stock:read','sales:read','customers:read'],
  p_expires timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key    text;
  v_hash   text;
  v_prefix text;
  v_id     uuid;
  v_scope  text;
  v_validos text[] := ARRAY[
    'products:read','stock:read','stock:write',
    'sales:read','sales:write','customers:read','costs:read'];
BEGIN
  -- Sólo el dueño o un admin emiten keys: una key es una sesión sin vencimiento.
  IF NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden emitir API keys';
  END IF;

  IF COALESCE(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'La key necesita un nombre: sin él, nadie sabe cuál revocar';
  END IF;

  -- Scopes contra lista blanca: un scope inventado hoy sería un permiso
  -- fantasma mañana, cuando alguien lo implemente con otro significado.
  IF p_scopes IS NULL OR array_length(p_scopes, 1) IS NULL THEN
    RAISE EXCEPTION 'La key necesita al menos un scope';
  END IF;
  FOREACH v_scope IN ARRAY p_scopes LOOP
    IF NOT v_scope = ANY(v_validos) THEN
      RAISE EXCEPTION 'Scope desconocido: %', v_scope;
    END IF;
  END LOOP;

  -- 48 hex = 192 bits. Dos gen_random_uuid() en vez de gen_random_bytes
  -- porque pgcrypto vive en el esquema extensions y esta función fija
  -- search_path = public; gen_random_uuid es built-in.
  v_key := 'gst_live_' || left(
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 48);
  v_hash   := encode(sha256(convert_to(v_key, 'UTF8')), 'hex');
  v_prefix := left(v_key, 14);  -- "gst_live_" + 5 chars: identificable, no adivinable

  INSERT INTO public.api_keys (org_id, name, key_prefix, key_hash, scopes, expires_at)
  VALUES (p_org, btrim(p_name), v_prefix, v_hash, p_scopes, p_expires)
  RETURNING id INTO v_id;

  -- La key completa sale UNA vez y no se puede volver a pedir: no está
  -- guardada en ningún lado, sólo su hash.
  RETURN jsonb_build_object(
    'id', v_id, 'key', v_key, 'prefix', v_prefix, 'scopes', p_scopes,
    'aviso', 'Guardala ahora. No se vuelve a mostrar.');
END;
$$;

COMMENT ON FUNCTION public.api_key_emitir IS
  'Emite una API key server-side: la devuelve UNA vez y guarda solo el SHA-256. Antes la key se generaba en el navegador y se guardaba en texto plano en settings, que todo miembro lee.';

REVOKE ALL ON FUNCTION public.api_key_emitir(uuid, text, text[], timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_key_emitir(uuid, text, text[], timestamptz) TO authenticated;

-- ── Revocación ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_key_revocar(p_org uuid, p_key_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden revocar API keys';
  END IF;
  -- Revocar es marcar, no borrar: el historial de qué key existió y cuándo
  -- murió es parte de la auditoría.
  UPDATE public.api_keys
     SET revoked_at = COALESCE(revoked_at, now())
   WHERE id = p_key_id AND org_id = p_org;
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_revocar(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_key_revocar(uuid, uuid) TO authenticated;

-- ── Registro de uso, llamado por la Edge Function ────────────────────────
-- Fire-and-forget desde el edge: que falle el contador no puede frenar la
-- request que ya autenticó.
CREATE OR REPLACE FUNCTION public.api_key_tocar(p_key_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.api_keys
     SET last_used_at = now(), request_count = COALESCE(request_count, 0) + 1
   WHERE id = p_key_id;
$$;

REVOKE ALL ON FUNCTION public.api_key_tocar(uuid) FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_org  uuid;
  v_user uuid;
  v_r    jsonb;
  v_fila record;
BEGIN
  SELECT m.org_id, m.user_id INTO v_org, v_user
    FROM public.memberships m WHERE m.role IN ('owner','admin') LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'api_keys: sin membresía owner/admin, no se puede verificar';
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  v_r := public.api_key_emitir(v_org, 'ZZ prueba', ARRAY['products:read']);

  -- 1. La key sale con el formato esperado y el hash guardado es su SHA-256.
  ASSERT (v_r->>'key') LIKE 'gst_live_%', 'formato de key inesperado';
  ASSERT length(v_r->>'key') = 57, format('largo %s, esperado 57', length(v_r->>'key'));

  SELECT * INTO v_fila FROM public.api_keys WHERE id = (v_r->>'id')::uuid;
  ASSERT v_fila.key_hash = encode(sha256(convert_to(v_r->>'key','UTF8')),'hex'),
    'el hash guardado no corresponde a la key emitida';
  -- 2. Y NO es reversible: el hash no contiene la key ni es su base64.
  ASSERT v_fila.key_hash <> (v_r->>'key'), 'guardo la key en claro';
  ASSERT v_fila.key_hash <> encode(convert_to(v_r->>'key','UTF8'),'base64'),
    'guardo base64, que es reversible';

  -- 3. Un scope inventado se rechaza.
  BEGIN
    PERFORM public.api_key_emitir(v_org, 'ZZ mala', ARRAY['superpoderes:all']);
    RAISE EXCEPTION 'ZZ_FALLO: acepto un scope desconocido';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ZZ_FALLO%' THEN RAISE; END IF;
  END;

  -- 4. Revocar marca, no borra.
  PERFORM public.api_key_revocar(v_org, (v_r->>'id')::uuid);
  SELECT * INTO v_fila FROM public.api_keys WHERE id = (v_r->>'id')::uuid;
  ASSERT v_fila.revoked_at IS NOT NULL, 'no se revoco';

  -- 5. Un usuario sin rol no emite.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.api_key_emitir(v_org, 'ZZ intrusa', ARRAY['products:read']);
    RAISE EXCEPTION 'ZZ_FALLO: un extraño emitio una key';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ZZ_FALLO%' THEN RAISE; END IF;
  END;

  -- Limpieza (la fila de prueba, revocada, se borra: nunca autenticó nada).
  DELETE FROM public.api_keys WHERE org_id = v_org AND name LIKE 'ZZ %';
  ASSERT (SELECT count(*) FROM public.api_keys WHERE name LIKE 'ZZ %') = 0,
    'quedaron restos';
  RAISE NOTICE 'api_keys endurecidas: 5 propiedades verificadas, restos 0';
END;
$verif$;
